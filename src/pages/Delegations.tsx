import { useState, useEffect } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { type Address, encodeFunctionData } from 'viem'
import { getDelegations, updateDelegationStatus, removeDelegation, type StoredDelegation } from '../lib/storage'
import { DelegationManagerABI } from '../config/abis'
import { getAddresses } from '../config/addresses'

export default function Delegations() {
  const { sdk, safe } = useSafeAppsSDK()
  const [delegations, setDelegations] = useState<StoredDelegation[]>([])
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    loadDelegations()
  }, [])

  function loadDelegations() {
    const all = getDelegations().filter(
      (d) => d.meta.safeAddress.toLowerCase() === safe.safeAddress.toLowerCase()
    )
    setDelegations(all)
  }

  async function handleRevoke(d: StoredDelegation) {
    setRevoking(d.meta.delegationHash)
    try {
      const addrs = getAddresses(safe.chainId)
      const txs = [
        {
          to: addrs.delegationManager,
          value: '0',
          data: encodeFunctionData({
            abi: DelegationManagerABI,
            functionName: 'disableDelegation',
            args: [
              {
                delegate: d.delegation.delegate,
                delegator: d.delegation.delegator,
                authority: d.delegation.authority,
                caveats: d.delegation.caveats,
                salt: BigInt(d.delegation.salt),
                signature: d.delegation.signature,
              },
            ],
          }),
        },
      ]

      await sdk.txs.send({ txs })
      updateDelegationStatus(d.meta.delegationHash, 'revoked')
      loadDelegations()
    } catch (err: any) {
      console.error('Revoke failed:', err)
    } finally {
      setRevoking(null)
    }
  }

  function copyDelegation(d: StoredDelegation) {
    navigator.clipboard.writeText(JSON.stringify(d, null, 2))
  }

  if (delegations.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 bg-white/[0.02] text-center">
        <div className="text-4xl mb-4">📋</div>
        <h2 className="text-lg font-semibold text-white mb-2">No Delegations Yet</h2>
        <p className="text-sm text-gray-400">
          Create a delegation to get started. Delegations will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">
        Active Delegations ({delegations.length})
      </h2>

      {delegations.map((d) => (
        <div
          key={d.meta.delegationHash}
          className="border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-3"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    d.meta.status === 'signed'
                      ? 'bg-green-500'
                      : d.meta.status === 'revoked'
                      ? 'bg-red-500'
                      : 'bg-yellow-500'
                  }`}
                />
                <span className="text-sm font-medium text-white">{d.meta.label}</span>
              </div>
              <p className="text-xs text-gray-500 font-mono">
                → {d.delegation.delegate}
              </p>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded ${
                d.meta.status === 'signed'
                  ? 'bg-green-500/10 text-green-400'
                  : d.meta.status === 'revoked'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {d.meta.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Type: </span>
              <span className="text-gray-300">
                {d.meta.scopeType === 'ethSpendingLimit' ? 'ETH' : 'ERC-20'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Chain: </span>
              <span className="text-gray-300">
                {d.meta.chainId === 84532 ? 'Base Sepolia' : d.meta.chainId === 8453 ? 'Base' : d.meta.chainId}
              </span>
            </div>
            {d.meta.expiryDate && (
              <div className="col-span-2">
                <span className="text-gray-500">Expires: </span>
                <span className="text-gray-300">{new Date(d.meta.expiryDate).toLocaleString()}</span>
              </div>
            )}
            <div className="col-span-2">
              <span className="text-gray-500">Created: </span>
              <span className="text-gray-300">{new Date(d.meta.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => copyDelegation(d)}
              className="text-xs bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              📋 Copy
            </button>
            {d.meta.status === 'signed' && (
              <button
                onClick={() => handleRevoke(d)}
                disabled={revoking === d.meta.delegationHash}
                className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {revoking === d.meta.delegationHash ? 'Revoking...' : '🗑 Revoke'}
              </button>
            )}
            <button
              onClick={() => removeDelegation(d.meta.delegationHash)}
              className="text-xs bg-white/5 hover:bg-white/10 text-gray-500 px-3 py-1.5 rounded-lg transition-colors ml-auto"
              title="Remove from local storage"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
