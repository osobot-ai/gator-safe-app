import { useState } from 'react'
import { 
  useAccount, 
  useConnect, 
  useDisconnect, 
  useWalletClient, 
  usePublicClient,
  useChainId 
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { 
  type Address, 
  type Hex, 
  isAddress, 
  parseEther, 
  parseUnits, 
  encodeFunctionData,
  erc20Abi
} from 'viem'
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts'
import { ExecutionMode, createExecution } from '@metamask/smart-accounts-kit'
import { getAddresses } from '../config/addresses'
import type { StoredDelegation } from '../lib/storage'
import {
  generateSalt,
  buildDelegationTypedData,
  computeDelegationHash,
  type DelegationStruct,
} from '../lib/delegations'

// DelegationMetaSwapAdapter ABI (only what we need)
const SWAP_ADAPTER_ABI = [
  {
    name: 'swapByDelegation',
    type: 'function',
    inputs: [
      {
        name: '_signatureData',
        type: 'tuple',
        components: [
          { name: 'apiData', type: 'bytes' },
          { name: 'expiration', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      {
        name: '_delegations',
        type: 'tuple[]',
        components: [
          { name: 'delegate', type: 'address' },
          { name: 'delegator', type: 'address' },
          { name: 'authority', type: 'bytes32' },
          {
            name: 'caveats',
            type: 'tuple[]',
            components: [
              { name: 'enforcer', type: 'address' },
              { name: 'terms', type: 'bytes' },
              { name: 'args', type: 'bytes' },
            ],
          },
          { name: 'salt', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: '_useTokenWhitelist', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

interface RedemptionForm {
  amount: string
  recipient: string
  delegationJson: string
}

interface SwapForm {
  destinationToken: string
  sourceAmount: string
}

interface SwapTrade {
  trade: {
    data: string
    to: string
    value: string
    from: string
  }
  sourceAmount: string
  destinationAmount: string
  sourceToken: string
  destinationToken: string
  approvalNeeded: unknown
  aggregator: string
  aggregatorType: string
  error: unknown
}

const KNOWN_TOKENS: Record<string, { address: Address; symbol: string; decimals: number }> = {
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  '0xc78fAbC2cB5B9cf59E0Af3Da8E3Bc46d47753A4e': { address: '0xc78fAbC2cB5B9cf59E0Af3Da8E3Bc46d47753A4e', symbol: 'OSO', decimals: 18 },
  '0x4200000000000000000000000000000000000006': { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
}

export default function StandaloneRedeem() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const chainId = useChainId()

  // State
  const [form, setForm] = useState<RedemptionForm>({
    amount: '',
    recipient: '',
    delegationJson: '',
  })
  const [swapForm, setSwapForm] = useState<SwapForm>({
    destinationToken: '',
    sourceAmount: '',
  })
  const [swapQuotes, setSwapQuotes] = useState<SwapTrade[] | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<SwapTrade | null>(null)
  const [fetchingQuotes, setFetchingQuotes] = useState(false)
  const [parsedDelegation, setParsedDelegation] = useState<StoredDelegation | null>(null)
  const [executing, setExecuting] = useState(false)
  const [executed, setExecuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const isSwapIntent = parsedDelegation?.meta.scopeType === 'swapIntent'

  // Parse delegation JSON
  function parseDelegationJson(json: string) {
    try {
      const parsed = JSON.parse(json)
      
      // Check if it's a single delegation
      if (parsed.delegation && parsed.meta) {
        setParsedDelegation(parsed as StoredDelegation)
        setError(null)
        return
      }
      
      // Check if it's an export format
      if (parsed.delegations && Array.isArray(parsed.delegations) && parsed.delegations.length > 0) {
        setParsedDelegation(parsed.delegations[0] as StoredDelegation)
        setError(null)
        return
      }
      
      throw new Error('Invalid delegation format')
    } catch (err: unknown) {
      setParsedDelegation(null)
      setError(err instanceof Error ? err.message : 'Invalid JSON format')
    }
  }

  function handleDelegationJsonChange(value: string) {
    setForm(prev => ({ ...prev, delegationJson: value }))
    if (value.trim()) {
      parseDelegationJson(value.trim())
    } else {
      setParsedDelegation(null)
      setError(null)
    }
  }

  function canExecute(): boolean {
    if (!isConnected || !parsedDelegation) return false
    if (parsedDelegation.delegation.delegate.toLowerCase() !== address?.toLowerCase()) return false
    if (isSwapIntent) {
      if (!swapForm.destinationToken || !isAddress(swapForm.destinationToken)) return false
      if (!swapForm.sourceAmount || parseFloat(swapForm.sourceAmount) <= 0) return false
      return true
    }
    if (!form.amount || !form.recipient) return false
    if (!isAddress(form.recipient)) return false
    if (parseFloat(form.amount) <= 0) return false
    return true
  }

  async function fetchSwapQuotes() {
    if (!parsedDelegation || !isSwapIntent) return
    if (!swapForm.destinationToken || !isAddress(swapForm.destinationToken)) return
    if (!swapForm.sourceAmount || parseFloat(swapForm.sourceAmount) <= 0) return

    setFetchingQuotes(true)
    setError(null)
    setSwapQuotes(null)
    setSelectedQuote(null)

    try {
      const addrs = getAddresses(chainId)

      // Find the source token from the delegation caveats
      const erc20PeriodCaveat = parsedDelegation.delegation.caveats.find(
        c => c.enforcer.toLowerCase() === addrs.erc20PeriodTransferEnforcer.toLowerCase()
      )

      if (!erc20PeriodCaveat) throw new Error('Could not find source token from delegation caveats')

      // Extract token address from terms (first 20 bytes = 42 hex chars including 0x)
      const sourceTokenAddress = ('0x' + erc20PeriodCaveat.terms.slice(2, 42)) as Address

      // Get decimals
      const knownToken = KNOWN_TOKENS[sourceTokenAddress.toLowerCase() as keyof typeof KNOWN_TOKENS] ||
                         KNOWN_TOKENS[sourceTokenAddress as keyof typeof KNOWN_TOKENS]
      const decimals = knownToken?.decimals || 18
      const sourceAmount = parseUnits(swapForm.sourceAmount, decimals).toString()

      const url = `https://swap.api.cx.metamask.io/networks/${chainId}/trades?` +
        `sourceAmount=${sourceAmount}` +
        `&sourceToken=${sourceTokenAddress}` +
        `&destinationToken=${swapForm.destinationToken}` +
        `&slippage=2` +
        `&walletAddress=${addrs.delegationMetaSwapAdapter}` +
        `&timeout=10000` +
        `&enableDirectWrapping=true` +
        `&includeRoute=true` +
        `&enableGasEstimation=true`

      const response = await fetch(url)
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`MetaSwap API error: ${response.status} - ${text}`)
      }

      const trades: SwapTrade[] = await response.json()
      if (!trades || trades.length === 0) {
        throw new Error('No swap quotes available for this pair')
      }

      setSwapQuotes(trades)
      setSelectedQuote(trades[0])
    } catch (err: unknown) {
      console.error('Failed to fetch swap quotes:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch swap quotes')
    } finally {
      setFetchingQuotes(false)
    }
  }

  async function handleExecuteSwapRedemption() {
    if (!parsedDelegation || !selectedQuote || !isSwapIntent || !walletClient || !address) return

    setExecuting(true)
    setError(null)

    try {
      const addrs = getAddresses(chainId)

      // Step 1: Create a redelegation from us (the delegate) to the DelegationMetaSwapAdapter
      const originalDelegation = parsedDelegation.delegation
      const originalDelegationHash = computeDelegationHash({
        delegate: originalDelegation.delegate,
        delegator: originalDelegation.delegator,
        authority: originalDelegation.authority,
        caveats: originalDelegation.caveats,
        salt: originalDelegation.salt,
        signature: '0x' as Hex,
      })

      const redelegationSalt = generateSalt()
      const redelegation: DelegationStruct = {
        delegate: addrs.delegationMetaSwapAdapter,
        delegator: address,
        authority: originalDelegationHash,
        caveats: [],
        salt: redelegationSalt,
        signature: '0x' as Hex,
      }

      // Sign the redelegation with EOA wallet (EIP-712)
      const typedData = buildDelegationTypedData(redelegation, chainId)
      const redelegationSignature = await walletClient.signTypedData({
        domain: {
          name: typedData.domain.name,
          version: typedData.domain.version,
          chainId: BigInt(typedData.domain.chainId),
          verifyingContract: typedData.domain.verifyingContract,
        },
        types: {
          Delegation: typedData.types.Delegation,
          Caveat: typedData.types.Caveat,
        },
        primaryType: 'Delegation',
        message: {
          ...typedData.message,
          salt: BigInt(typedData.message.salt),
        },
      })

      const signedRedelegation = {
        ...redelegation,
        signature: redelegationSignature,
      }

      // Step 2: Build the delegation chain (leaf to root)
      const delegationChain = [
        {
          delegate: signedRedelegation.delegate,
          delegator: signedRedelegation.delegator,
          authority: signedRedelegation.authority,
          caveats: signedRedelegation.caveats.map(c => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: '0x' as Hex,
          })),
          salt: BigInt(signedRedelegation.salt),
          signature: signedRedelegation.signature,
        },
        {
          delegate: originalDelegation.delegate,
          delegator: originalDelegation.delegator,
          authority: originalDelegation.authority,
          caveats: originalDelegation.caveats.map(c => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: '0x' as Hex,
          })),
          salt: BigInt(originalDelegation.salt),
          signature: originalDelegation.signature,
        },
      ]

      // Step 3: Call swapByDelegation on the adapter
      const apiData = selectedQuote.trade.data as Hex

      const swapCalldata = encodeFunctionData({
        abi: SWAP_ADAPTER_ABI,
        functionName: 'swapByDelegation',
        args: [
          {
            apiData: apiData,
            expiration: BigInt(Math.floor(Date.now() / 1000) + 600),
            signature: '0x' as Hex,
          },
          delegationChain,
          false,
        ],
      })

      // Send transaction directly from EOA
      const tx = await walletClient.sendTransaction({
        to: addrs.delegationMetaSwapAdapter,
        data: swapCalldata,
      })

      setTxHash(tx)
      setExecuted(true)
    } catch (err: unknown) {
      console.error('Swap redemption failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to execute swap redemption')
    } finally {
      setExecuting(false)
    }
  }

  async function handleExecuteRedemption() {
    if (!parsedDelegation || !walletClient || !publicClient) return

    // Route to swap handler if it's a swap intent
    if (isSwapIntent) {
      return handleExecuteSwapRedemption()
    }

    if (!canExecute()) return

    setExecuting(true)
    setError(null)

    try {
      // Convert stored delegation to Smart Accounts Kit format
      const delegation = {
        ...parsedDelegation.delegation,
        caveats: parsedDelegation.delegation.caveats.map(caveat => ({
          ...caveat,
          args: '0x' as Hex, // Default empty args
        }))
      }
      const isEthTransfer = parsedDelegation.meta.scopeType === 'ethSpendingLimit'
      const addresses = getAddresses(chainId)

      let execution
      
      if (isEthTransfer) {
        // ETH transfer — use SDK's createExecution
        execution = createExecution({
          target: form.recipient as Address,
          value: parseEther(form.amount),
          callData: '0x' as Hex,
        })
      } else {
        // ERC-20 transfer
        const tokenAddress = parsedDelegation.meta.tokenAddress
        if (!tokenAddress) {
          throw new Error('Token address not found in delegation')
        }

        // Get token decimals (default to 18 if not specified)
        let decimals = 18
        try {
          const result = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'decimals',
          })
          decimals = result
        } catch {
          // Use default decimals
        }

        const transferCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [form.recipient as Address, parseUnits(form.amount, decimals)],
        })

        execution = createExecution({
          target: tokenAddress,
          value: 0n,
          callData: transferCalldata,
        })
      }

      // Encode the redemption calldata
      const redeemCalldata = DelegationManager.encode.redeemDelegations({
        delegations: [[delegation]], // Array of delegation chains
        modes: [ExecutionMode.SingleDefault],
        executions: [[execution]],
      })

      // Send transaction directly to DelegationManager
      const tx = await walletClient.sendTransaction({
        to: addresses.delegationManager,
        data: redeemCalldata,
      })

      setTxHash(tx)
      setExecuted(true)

    } catch (err: unknown) {
      console.error('Redemption failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to execute redemption')
    } finally {
      setExecuting(false)
    }
  }

  function resetForm() {
    setForm({ amount: '', recipient: '', delegationJson: '' })
    setSwapForm({ destinationToken: '', sourceAmount: '' })
    setSwapQuotes(null)
    setSelectedQuote(null)
    setParsedDelegation(null)
    setExecuted(false)
    setTxHash(null)
    setError(null)
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      handleDelegationJsonChange(content)
    }
    reader.readAsText(file)
  }

  // Success state
  if (executed && txHash) {
    return (
      <div className="min-h-screen bg-[#0c0c0c] p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center mb-8">
            <span className="text-4xl">🐊</span>
            <h1 className="text-2xl font-bold text-white mt-2">
              {isSwapIntent ? 'Swap Executed!' : 'Delegation Redeemed!'}
            </h1>
          </div>

          <div className="border border-green-500/30 rounded-xl p-6 bg-green-500/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h2 className="text-lg font-semibold text-green-400">Transaction Submitted</h2>
            </div>
            
            <p className="text-sm text-gray-400 mb-4">
              {isSwapIntent
                ? 'Your swap transaction has been submitted to the blockchain.'
                : 'Your redemption transaction has been submitted to the blockchain.'}
            </p>

            <div className="bg-black/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
              {isSwapIntent && selectedQuote ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Swap</span>
                    <span className="text-gray-300">{swapForm.sourceAmount} → {swapForm.destinationToken.slice(0, 10)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Aggregator</span>
                    <span className="text-gray-300">{selectedQuote.aggregator}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Amount</span>
                    <span className="text-gray-300">
                      {form.amount} {parsedDelegation?.meta.scopeType === 'ethSpendingLimit' ? 'ETH' : 'tokens'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Recipient</span>
                    <span className="text-gray-300 font-mono text-xs">{form.recipient}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Transaction Hash</span>
                <span className="text-gray-300 font-mono text-xs">{txHash}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetForm}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-4 py-2 rounded-lg text-sm transition-colors"
              >
                + Redeem Another
              </button>
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                View on Explorer 🔗
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0c0c0c] p-6">
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 mb-4 max-w-2xl mx-auto">
        <p className="text-xs text-amber-400/80 text-center">
          ⚠️ This app was built by an AI agent (<a href="https://x.com/Osobotai" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">Osobot</a>). The smart contracts are all audited, but this app was made by an AI agent bro — use at your own risk.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-4xl">🐊</span>
          <h1 className="text-2xl font-bold text-white mt-2">Redeem Delegation</h1>
          <p className="text-gray-400 text-sm mt-1">Execute a signed delegation from your wallet</p>
        </div>

        {/* Wallet Connection */}
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
          {!isConnected ? (
            <div className="text-center">
              <h3 className="text-lg font-medium text-white mb-4">Connect Your Wallet</h3>
              <button
                onClick={() => connect({ connector: injected() })}
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                Connect MetaMask
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-medium">✅ Wallet Connected</div>
                <div className="text-xs text-gray-400 font-mono">{address}</div>
              </div>
              <button
                onClick={() => disconnect()}
                className="text-gray-400 hover:text-white text-sm transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {isConnected && (
          <>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Step 1: Upload Delegation */}
            <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
              <h3 className="text-lg font-medium text-white">1. Load Delegation</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-2">Upload JSON File</label>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-500/20 file:text-amber-400 hover:file:bg-amber-500/30"
                  />
                </div>
                
                <div className="text-center text-gray-500 text-xs">OR</div>
                
                <div>
                  <label className="text-sm text-gray-400 block mb-2">Paste JSON</label>
                  <textarea
                    value={form.delegationJson}
                    onChange={(e) => handleDelegationJsonChange(e.target.value)}
                    placeholder='{"delegation": {...}, "meta": {...}}'
                    rows={6}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none font-mono text-xs"
                  />
                </div>
              </div>

              {parsedDelegation && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="text-green-400 font-medium mb-2">✅ Delegation Loaded</div>
                  <div className="space-y-1 text-sm text-gray-300">
                    <div>Label: {parsedDelegation.meta.label}</div>
                    <div>From: {parsedDelegation.delegation.delegator}</div>
                    <div>To: {parsedDelegation.delegation.delegate}</div>
                    <div>Type: {parsedDelegation.meta.scopeType}
                      {isSwapIntent && <span className="ml-2 text-blue-400">💱 Swap Intent</span>}
                    </div>
                  </div>
                  
                  {parsedDelegation.delegation.delegate.toLowerCase() !== address?.toLowerCase() && (
                    <div className="mt-3 text-xs text-yellow-400">
                      ⚠️ Warning: This delegation is not for your wallet address
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Configure Transfer (non-swap) */}
            {parsedDelegation && !isSwapIntent && (
              <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
                <h3 className="text-lg font-medium text-white">2. Configure Transfer</h3>
                
                <div>
                  <label className="text-sm text-gray-400 block mb-1">
                    Amount ({parsedDelegation.meta.scopeType === 'ethSpendingLimit' ? 'ETH' : 'tokens'})
                  </label>
                  <input
                    type="number"
                    placeholder="0.1"
                    value={form.amount}
                    onChange={(e) => setForm(prev => ({ ...prev, amount: e.target.value }))}
                    min={0}
                    step="any"
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-400 block mb-1">Recipient Address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={form.recipient}
                    onChange={(e) => setForm(prev => ({ ...prev, recipient: e.target.value }))}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none"
                  />
                  {form.recipient && !isAddress(form.recipient) && (
                    <p className="text-xs text-red-400 mt-1">Invalid Ethereum address</p>
                  )}
                </div>

                {parsedDelegation.meta.scopeType === 'erc20SpendingLimit' && parsedDelegation.meta.tokenAddress && (
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Token Address</label>
                    <div className="bg-black/30 rounded-lg p-2 text-xs text-gray-300 font-mono">
                      {parsedDelegation.meta.tokenAddress}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2 (Swap Intent): Configure Swap */}
            {parsedDelegation && isSwapIntent && (
              <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
                <h3 className="text-lg font-medium text-white">2. Configure Swap</h3>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400 mb-4">
                  ℹ️ This delegation allows periodic token swaps via the MetaSwap adapter. Enter the destination token and amount to swap.
                </div>

                <div>
                  <label className="text-sm text-gray-400 block mb-1">Source Amount</label>
                  <input
                    type="number"
                    placeholder="100"
                    value={swapForm.sourceAmount}
                    onChange={(e) => setSwapForm(prev => ({ ...prev, sourceAmount: e.target.value }))}
                    min={0}
                    step="any"
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-400 block mb-1">Destination Token Address</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {Object.entries(KNOWN_TOKENS).map(([addr, token]) => (
                      <button
                        key={addr}
                        onClick={() => setSwapForm(prev => ({ ...prev, destinationToken: addr }))}
                        className={`p-2 rounded-lg border text-center text-xs transition-colors ${
                          swapForm.destinationToken.toLowerCase() === addr.toLowerCase()
                            ? 'border-amber-500/50 bg-amber-500/10'
                            : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <div className="font-medium text-white">{token.symbol}</div>
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="0x... (or select above)"
                    value={swapForm.destinationToken}
                    onChange={(e) => setSwapForm(prev => ({ ...prev, destinationToken: e.target.value }))}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-amber-500/50 focus:outline-none"
                  />
                  {swapForm.destinationToken && !isAddress(swapForm.destinationToken) && (
                    <p className="text-xs text-red-400 mt-1">Invalid token address</p>
                  )}
                </div>

                <button
                  onClick={fetchSwapQuotes}
                  disabled={fetchingQuotes || !swapForm.destinationToken || !isAddress(swapForm.destinationToken) || !swapForm.sourceAmount}
                  className="w-full bg-blue-500/20 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-blue-400 font-medium px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {fetchingQuotes ? 'Fetching Quotes...' : '🔍 Get Swap Quotes'}
                </button>

                {/* Swap Quotes */}
                {swapQuotes && swapQuotes.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">Available Quotes</label>
                    {swapQuotes.map((quote, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedQuote(quote)}
                        className={`w-full p-3 rounded-lg border text-left transition-colors ${
                          selectedQuote === quote
                            ? 'border-green-500/50 bg-green-500/10'
                            : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">
                            {quote.aggregator}
                          </span>
                          <span className="text-xs text-green-400">
                            → {quote.destinationAmount ?
                              (Number(quote.destinationAmount) / 1e18).toFixed(6) :
                              'N/A'
                            }
                          </span>
                        </div>
                        {quote.error && (
                          <div className="text-xs text-red-400 mt-1">{JSON.stringify(quote.error)}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Execute */}
            {parsedDelegation && (
              <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
                <h3 className="text-lg font-medium text-white">
                  {isSwapIntent ? '3. Execute Swap' : '3. Execute Redemption'}
                </h3>

                {isSwapIntent && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
                    💱 This will: 1) Redelegate to the MetaSwap adapter, 2) Call swapByDelegation with the selected quote. The adapter executes the swap and returns tokens to the delegator.
                  </div>
                )}
                
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                  ⚠️ This will send a transaction from your wallet to execute the delegation.
                </div>

                <button
                  onClick={handleExecuteRedemption}
                  disabled={isSwapIntent ? (!selectedQuote || executing) : (!canExecute() || executing)}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-lg transition-colors"
                >
                  {executing ? 'Executing...' : isSwapIntent ? 'Execute Swap' : 'Execute Redemption'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-500 border-t border-white/10 pt-6">
          <p>This is a standalone redemption interface for ERC-7710 delegations.</p>
          <p>For Safe multisig integration, use the <a href="/" className="text-amber-400 hover:text-amber-300">main app</a>.</p>
        </div>
      </div>
    </div>
  )
}
