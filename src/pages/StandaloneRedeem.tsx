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

interface RedemptionForm {
  amount: string
  recipient: string
  delegationJson: string
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
  const [parsedDelegation, setParsedDelegation] = useState<StoredDelegation | null>(null)
  const [executing, setExecuting] = useState(false)
  const [executed, setExecuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

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
    } catch (err: any) {
      setParsedDelegation(null)
      setError(err.message || 'Invalid JSON format')
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
    if (!isConnected || !parsedDelegation || !form.amount || !form.recipient) return false
    if (!isAddress(form.recipient)) return false
    if (parseFloat(form.amount) <= 0) return false
    if (parsedDelegation.delegation.delegate.toLowerCase() !== address?.toLowerCase()) return false
    return true
  }

  async function handleExecuteRedemption() {
    if (!canExecute() || !walletClient || !publicClient || !parsedDelegation) return

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

    } catch (err: any) {
      console.error('Redemption failed:', err)
      setError(err.message || 'Failed to execute redemption')
    } finally {
      setExecuting(false)
    }
  }

  function resetForm() {
    setForm({ amount: '', recipient: '', delegationJson: '' })
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
            <h1 className="text-2xl font-bold text-white mt-2">Delegation Redeemed!</h1>
          </div>

          <div className="border border-green-500/30 rounded-xl p-6 bg-green-500/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h2 className="text-lg font-semibold text-green-400">Transaction Submitted</h2>
            </div>
            
            <p className="text-sm text-gray-400 mb-4">
              Your redemption transaction has been submitted to the blockchain.
            </p>

            <div className="bg-black/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
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
                    <div>Type: {parsedDelegation.meta.scopeType}</div>
                  </div>
                  
                  {parsedDelegation.delegation.delegate.toLowerCase() !== address?.toLowerCase() && (
                    <div className="mt-3 text-xs text-yellow-400">
                      ⚠️ Warning: This delegation is not for your wallet address
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Configure Transfer */}
            {parsedDelegation && (
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

            {/* Step 3: Execute */}
            {parsedDelegation && (
              <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
                <h3 className="text-lg font-medium text-white">3. Execute Redemption</h3>
                
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                  ⚠️ This will send a transaction from your wallet to execute the delegation.
                </div>

                <button
                  onClick={handleExecuteRedemption}
                  disabled={!canExecute() || executing}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-lg transition-colors"
                >
                  {executing ? 'Executing...' : 'Execute Redemption'}
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