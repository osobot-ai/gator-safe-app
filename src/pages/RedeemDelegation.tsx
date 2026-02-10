import { useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
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
import { ExecutionMode } from '@metamask/smart-accounts-kit'
import { getDelegations, type StoredDelegation } from '../lib/storage'

interface RedemptionForm {
  amount: string
  recipient: string
  tokenAddress?: Address
  tokenDecimals?: number
}

export default function RedeemDelegation() {
  const { sdk, safe } = useSafeAppsSDK()

  // State
  const [selectedDelegation, setSelectedDelegation] = useState<StoredDelegation | null>(null)
  const [form, setForm] = useState<RedemptionForm>({
    amount: '',
    recipient: '',
  })
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

  function canExecute(): boolean {
    if (!selectedDelegation || !form.amount || !form.recipient) return false
    if (!isAddress(form.recipient)) return false
    if (parseFloat(form.amount) <= 0) return false
    return true
  }

  async function handleExecuteRedemption() {
    if (!selectedDelegation || !canExecute()) return

    setExecuting(true)
    setError(null)

    try {
      // Convert stored delegation to Smart Accounts Kit format
      const delegation = {
        ...selectedDelegation.delegation,
        caveats: selectedDelegation.delegation.caveats.map(caveat => ({
          ...caveat,
          args: '0x' as Hex, // Default empty args
        }))
      }
      const isEthTransfer = selectedDelegation.meta.scopeType === 'ethSpendingLimit'

      let execution
      
      if (isEthTransfer) {
        // ETH transfer
        execution = {
          target: form.recipient as Address,
          value: parseEther(form.amount),
          callData: '0x' as Hex,
        }
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

        execution = {
          target: tokenAddress,
          value: 0n,
          callData: transferCalldata,
        }
      }

      // Encode the redemption calldata
      const redeemCalldata = DelegationManager.encode.redeemDelegations({
        delegations: [[delegation]], // Array of delegation chains
        modes: [ExecutionMode.SingleDefault],
        executions: [[execution]],
      })

      // Get the DelegationManager address from the environment
      // This should target the delegator's smart account (module address)
      const targetAddress = delegation.delegator

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
            <h2 className="text-lg font-semibold text-green-400">Redemption Submitted!</h2>
          </div>
          
          <p className="text-sm text-gray-400 mb-4">
            Your redemption transaction has been submitted to the Safe for execution.
          </p>

          <div className="bg-black/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
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
          Execute a signed delegation to transfer funds from the delegator to a recipient.
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
                    {delegation.meta.scopeType === 'ethSpendingLimit' ? '⚡ ETH' : '🪙 Token'}
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

        {/* Step 2: Configure Redemption */}
        {selectedDelegation && (
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

        {/* Step 3: Execute */}
        {selectedDelegation && (
          <div className="space-y-4">
            <h3 className="text-md font-medium text-white">3. Execute Redemption</h3>
            
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
              ⚠️ This will propose a Safe transaction to execute the delegation. All required signers must approve.
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
      </div>
    </div>
  )
}