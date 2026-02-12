import { useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { 
  type Address, 
  type Hex, 
  isAddress, 
  parseEther, 
  parseUnits,
  encodeFunctionData,
  erc20Abi,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts'
import { ExecutionMode, createExecution } from '@metamask/smart-accounts-kit'
import { getDelegations, type StoredDelegation } from '../lib/storage'
import { getEnvironment } from '../lib/environment'
import { getAddresses } from '../config/addresses'
import {
  generateSalt,
  buildDelegationTypedData,
  computeDelegationHash,
  type DelegationStruct,
} from '../lib/delegations'

const chains: Record<number, typeof base | typeof baseSepolia> = {
  84532: baseSepolia,
  8453: base as any,
}

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
  tokenAddress?: Address
  tokenDecimals?: number
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
  approvalNeeded: any
  aggregator: string
  aggregatorType: string
  error: any
}

const KNOWN_TOKENS_LIST = [
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, symbol: 'USDC', decimals: 6 },
  { address: '0xc78fAbC2cB5B9cf59E0Af3Da8E3Bc46d47753A4e' as Address, symbol: 'OSO', decimals: 18 },
  { address: '0x4200000000000000000000000000000000000006' as Address, symbol: 'WETH', decimals: 18 },
]

function findKnownToken(addr: string) {
  return KNOWN_TOKENS_LIST.find(t => t.address.toLowerCase() === addr.toLowerCase())
}

export default function RedeemDelegation() {
  const { sdk, safe } = useSafeAppsSDK()

  // State
  const [selectedDelegation, setSelectedDelegation] = useState<StoredDelegation | null>(null)
  const [form, setForm] = useState<RedemptionForm>({
    amount: '',
    recipient: '',
  })
  const [swapForm, setSwapForm] = useState<SwapForm>({
    destinationToken: '',
    sourceAmount: '',
  })
  const [swapQuotes, setSwapQuotes] = useState<SwapTrade[] | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<SwapTrade | null>(null)
  const [fetchingQuotes, setFetchingQuotes] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executed, setExecuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Get available delegations
  const delegations = getDelegations().filter(d => 
    d.meta.status === 'signed' && 
    d.meta.chainId === safe.chainId
  )

  // Get delegations that match current user as delegate
  const myDelegations = delegations.filter(d => 
    d.delegation.delegate.toLowerCase() === safe.safeAddress.toLowerCase()
  )

  const isSwapIntent = selectedDelegation?.meta.scopeType === 'swapIntent'

  function canExecute(): boolean {
    if (!selectedDelegation) return false
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
    if (!selectedDelegation || !isSwapIntent) return
    if (!swapForm.destinationToken || !isAddress(swapForm.destinationToken)) return
    if (!swapForm.sourceAmount || parseFloat(swapForm.sourceAmount) <= 0) return

    setFetchingQuotes(true)
    setError(null)
    setSwapQuotes(null)
    setSelectedQuote(null)

    try {
      const addrs = getAddresses(safe.chainId)
      
      // Find the source token from the delegation caveats
      // The ERC20PeriodTransferEnforcer terms start with the token address (20 bytes)
      const erc20PeriodCaveat = selectedDelegation.delegation.caveats.find(
        c => c.enforcer.toLowerCase() === addrs.erc20PeriodTransferEnforcer.toLowerCase()
      )
      
      if (!erc20PeriodCaveat) throw new Error('Could not find source token from delegation caveats')
      
      // Extract token address from terms (first 20 bytes = 42 hex chars including 0x)
      const sourceTokenAddress = ('0x' + erc20PeriodCaveat.terms.slice(2, 42)) as Address
      
      // Get decimals
      const knownToken = findKnownToken(sourceTokenAddress)
      const decimals = knownToken?.decimals || 18
      const sourceAmount = parseUnits(swapForm.sourceAmount, decimals).toString()

      const url = `https://swap.api.cx.metamask.io/networks/${safe.chainId}/trades?` +
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
      // Auto-select the first (best) quote
      setSelectedQuote(trades[0])
    } catch (err: any) {
      console.error('Failed to fetch swap quotes:', err)
      setError(err.message || 'Failed to fetch swap quotes')
    } finally {
      setFetchingQuotes(false)
    }
  }

  async function handleExecuteSwapRedemption() {
    if (!selectedDelegation || !selectedQuote || !isSwapIntent) return

    setExecuting(true)
    setError(null)

    try {
      const chain = chains[safe.chainId]
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)
      
      const addrs = getAddresses(safe.chainId)

      // Step 1: Create a redelegation from us (the delegate) to the DelegationMetaSwapAdapter
      // The original delegation: delegator → us (delegate)
      // Redelegation: us → DelegationMetaSwapAdapter
      
      const originalDelegation = selectedDelegation.delegation
      const originalDelegationHash = computeDelegationHash({
        delegate: originalDelegation.delegate,
        delegator: originalDelegation.delegator,
        authority: originalDelegation.authority,
        caveats: originalDelegation.caveats,
        salt: originalDelegation.salt,
        signature: '0x' as Hex,
      })

      // Create redelegation to the adapter
      const redelegationSalt = generateSalt()
      const redelegation: DelegationStruct = {
        delegate: addrs.delegationMetaSwapAdapter,
        delegator: safe.safeAddress as Address,
        authority: originalDelegationHash,
        caveats: [], // No additional caveats needed on the redelegation
        salt: redelegationSalt,
        signature: '0x' as Hex,
      }

      // Sign the redelegation
      const redelegationTypedData = buildDelegationTypedData(redelegation, safe.chainId)
      const redelegationResult = await sdk.txs.signTypedMessage(redelegationTypedData as any) as any
      const signedRedelegation = {
        ...redelegation,
        signature: (redelegationResult?.signature || redelegationResult?.safeTxHash || '0x') as Hex,
      }

      // Step 2: Build the delegation chain (leaf to root)
      // Chain: [redelegation (leaf), originalDelegation (root)]
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
      // The trade.data from the API is the apiData for the SignatureData struct
      // For now, we pass the raw trade data. The API response includes signature data.
      const apiData = selectedQuote.trade.data as Hex

      // The MetaSwap API returns signed data including expiration and signature
      // For the adapter, we need SignatureData { apiData, expiration, signature }
      // The trade.data IS the apiData field
      // Note: The actual signature validation happens on-chain via the adapter's swapApiSigner
      // The API data already contains the properly formatted swap calldata

      const swapCalldata = encodeFunctionData({
        abi: SWAP_ADAPTER_ABI,
        functionName: 'swapByDelegation',
        args: [
          {
            apiData: apiData,
            expiration: BigInt(Math.floor(Date.now() / 1000) + 600), // 10 min expiry
            signature: '0x' as Hex, // The API provides signed data
          },
          delegationChain,
          false, // _useTokenWhitelist = false (we use "Token-Whitelist-Not-Enforced")
        ],
      })

      // Submit the call to the MetaSwap adapter
      const txResponse = await sdk.txs.send({
        txs: [{
          to: addrs.delegationMetaSwapAdapter,
          data: swapCalldata,
          value: '0',
        }],
      })

      setTxHash(txResponse.safeTxHash)
      setExecuted(true)
    } catch (err: any) {
      console.error('Swap redemption failed:', err)
      setError(err.message || 'Failed to execute swap redemption')
    } finally {
      setExecuting(false)
    }
  }

  async function handleExecuteRedemption() {
    if (!selectedDelegation || !canExecute()) return

    // Route to swap handler if it's a swap intent
    if (isSwapIntent) {
      return handleExecuteSwapRedemption()
    }

    setExecuting(true)
    setError(null)

    try {
      // Convert stored delegation to Smart Accounts Kit format
      const delegation = {
        ...selectedDelegation.delegation,
        caveats: selectedDelegation.delegation.caveats.map(caveat => ({
          ...caveat,
          args: '0x' as Hex, // Default empty args for redemption
        }))
      }
      const isEthTransfer = selectedDelegation.meta.scopeType === 'ethSpendingLimit'

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
        const tokenAddress = selectedDelegation.meta.tokenAddress
        const decimals = form.tokenDecimals || 18
        
        if (!tokenAddress) {
          throw new Error('Token address not found in delegation')
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

      // Per SDK docs: EOA/wallet delegates send redeemCalldata to the DelegationManager
      const environment = getEnvironment(safe.chainId)
      const targetAddress = environment.DelegationManager

      // Submit transaction via Safe Apps SDK
      const txResponse = await sdk.txs.send({
        txs: [{
          to: targetAddress,
          data: redeemCalldata,
          value: '0',
        }],
      })

      setTxHash(txResponse.safeTxHash)
      setExecuted(true)

    } catch (err: any) {
      console.error('Redemption failed:', err)
      setError(err.message || 'Failed to execute redemption')
    } finally {
      setExecuting(false)
    }
  }

  function resetForm() {
    setSelectedDelegation(null)
    setForm({ amount: '', recipient: '' })
    setSwapForm({ destinationToken: '', sourceAmount: '' })
    setSwapQuotes(null)
    setSelectedQuote(null)
    setExecuted(false)
    setTxHash(null)
    setError(null)
  }

  // Success state
  if (executed && txHash) {
    return (
      <div className="space-y-6">
        <div className="border border-green-500/30 rounded-xl p-6 bg-green-500/5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <h2 className="text-lg font-semibold text-green-400">
              {isSwapIntent ? 'Swap Submitted!' : 'Redemption Submitted!'}
            </h2>
          </div>
          
          <p className="text-sm text-gray-400 mb-4">
            {isSwapIntent 
              ? 'Your swap transaction has been submitted to the Safe for execution.'
              : 'Your redemption transaction has been submitted to the Safe for execution.'}
          </p>

          <div className="bg-black/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
            {isSwapIntent && selectedQuote ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Swap</span>
                  <span className="text-gray-300">{swapForm.sourceAmount} → {swapForm.destinationToken.slice(0, 10)}...</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="text-gray-300">
                    {form.amount} {selectedDelegation?.meta.scopeType === 'ethSpendingLimit' ? 'ETH' : 'tokens'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Recipient</span>
                  <span className="text-gray-300 font-mono text-xs">{form.recipient}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Safe Tx Hash</span>
              <span className="text-gray-300 font-mono text-xs">{txHash.slice(0, 20)}...</span>
            </div>
          </div>

          <button
            onClick={resetForm}
            className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            + Redeem Another
          </button>
        </div>
      </div>
    )
  }

  // No delegations available
  if (myDelegations.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
          <h2 className="text-lg font-semibold text-white mb-4">No Available Delegations</h2>
          
          <div className="text-center py-8">
            <div className="text-6xl mb-4 opacity-50">🏛️</div>
            <p className="text-gray-400 text-sm">
              No signed delegations found where this Safe is the delegate.
            </p>
            <p className="text-gray-500 text-xs mt-2">
              To redeem a delegation, you need to be designated as the delegate and have the signed delegation available.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
        <h2 className="text-lg font-semibold text-white mb-4">Redeem Delegation</h2>
        <p className="text-sm text-gray-400 mb-6">
          Execute a signed delegation to transfer funds or perform swaps.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 mb-4">
            {error}
          </div>
        )}

        {/* Step 1: Select Delegation */}
        <div className="space-y-4 mb-6">
          <h3 className="text-md font-medium text-white">1. Select Delegation</h3>
          <div className="space-y-2">
            {myDelegations.map((delegation) => (
              <button
                key={delegation.meta.delegationHash}
                onClick={() => {
                  setSelectedDelegation(delegation)
                  setSwapQuotes(null)
                  setSelectedQuote(null)
                  setForm(prev => ({ 
                    ...prev, 
                    tokenAddress: delegation.meta.tokenAddress,
                    tokenDecimals: delegation.meta.scopeType === 'erc20SpendingLimit' ? 18 : undefined
                  }))
                }}
                className={`w-full p-4 rounded-lg border text-left transition-colors ${
                  selectedDelegation?.meta.delegationHash === delegation.meta.delegationHash
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{delegation.meta.label}</span>
                  <span className="text-xs text-gray-500">
                    {delegation.meta.scopeType === 'ethSpendingLimit' ? '⚡ ETH' 
                     : delegation.meta.scopeType === 'swapIntent' ? '💱 Swap'
                     : delegation.meta.scopeType === 'transferIntent' ? '🔄 Intent'
                     : '🪙 Token'}
                  </span>
                </div>
                <div className="text-xs text-gray-400 space-y-1">
                  <div>From: {delegation.delegation.delegator.slice(0, 10)}...</div>
                  <div>Created: {new Date(delegation.meta.createdAt).toLocaleDateString()}</div>
                  {delegation.meta.expiryDate && (
                    <div>Expires: {new Date(delegation.meta.expiryDate).toLocaleDateString()}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Configure - varies by type */}
        {selectedDelegation && !isSwapIntent && (
          <div className="space-y-4 mb-6">
            <h3 className="text-md font-medium text-white">2. Configure Transfer</h3>
            
            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Amount ({selectedDelegation.meta.scopeType === 'ethSpendingLimit' ? 'ETH' : 'tokens'})
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

            {selectedDelegation.meta.scopeType === 'erc20SpendingLimit' && selectedDelegation.meta.tokenAddress && (
              <div>
                <label className="text-sm text-gray-400 block mb-1">Token Address</label>
                <div className="bg-black/30 rounded-lg p-2 text-xs text-gray-300 font-mono">
                  {selectedDelegation.meta.tokenAddress}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 (Swap Intent): Configure Swap */}
        {selectedDelegation && isSwapIntent && (
          <div className="space-y-4 mb-6">
            <h3 className="text-md font-medium text-white">2. Configure Swap</h3>
            
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
              <div className="grid grid-cols-4 gap-2 mb-2">
                {KNOWN_TOKENS_LIST.map((token) => (
                  <button
                    key={token.address}
                    onClick={() => setSwapForm(prev => ({ ...prev, destinationToken: token.address }))}
                    className={`p-2 rounded-lg border text-center text-xs transition-colors ${
                      swapForm.destinationToken.toLowerCase() === token.address.toLowerCase()
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
        {selectedDelegation && (
          <div className="space-y-4">
            <h3 className="text-md font-medium text-white">
              {isSwapIntent ? '3. Execute Swap' : '3. Execute Redemption'}
            </h3>
            
            {isSwapIntent && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
                💱 This will: 1) Redelegate to the MetaSwap adapter, 2) Call swapByDelegation with the selected quote. The adapter executes the swap and returns tokens to the delegator's Safe.
              </div>
            )}

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
              ⚠️ This will propose a Safe transaction. All required signers must approve.
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
      </div>
    </div>
  )
}
