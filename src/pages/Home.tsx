import { useState, useEffect } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, type Address } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import { DeleGatorModuleFactoryABI, SafeABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { buildModuleInstallTxs, DEFAULT_SALT } from '../lib/module'

const chains: Record<number, (typeof baseSepolia) | (typeof base)> = {
  84532: baseSepolia,
  8453: base as any,
}

interface HomeProps {
  onNavigate: (page: 'home' | 'create' | 'delegations' | 'import') => void
}

export default function Home({ onNavigate }: HomeProps) {
  const { sdk, safe } = useSafeAppsSDK()
  const [moduleStatus, setModuleStatus] = useState<'loading' | 'installed' | 'not-installed' | 'error'>('loading')
  const [moduleAddress, setModuleAddress] = useState<Address | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [safeInfo, setSafeInfo] = useState<{ owners: string[]; threshold: number } | null>(null)

  useEffect(() => {
    checkModuleStatus()
  }, [safe.safeAddress, safe.chainId])

  async function checkModuleStatus() {
    try {
      setModuleStatus('loading')
      const chain = chains[safe.chainId]
      if (!chain) {
        setError(`Unsupported chain: ${safe.chainId}`)
        setModuleStatus('error')
        return
      }

      const client = createPublicClient({ chain, transport: http() })
      const addrs = getAddresses(safe.chainId)

      // Predict module address
      const predicted = await client.readContract({
        address: addrs.delegatorModuleFactory,
        abi: DeleGatorModuleFactoryABI,
        functionName: 'predictAddress',
        args: [safe.safeAddress as Address, DEFAULT_SALT],
      }) as Address

      setModuleAddress(predicted)

      // Check if module is enabled
      const isEnabled = await client.readContract({
        address: safe.safeAddress as Address,
        abi: SafeABI,
        functionName: 'isModuleEnabled',
        args: [predicted],
      })

      // Get safe info
      try {
        const owners = await client.readContract({
          address: safe.safeAddress as Address,
          abi: SafeABI,
          functionName: 'getOwners',
        }) as string[]
        const threshold = await client.readContract({
          address: safe.safeAddress as Address,
          abi: SafeABI,
          functionName: 'getThreshold',
        }) as bigint
        setSafeInfo({ owners, threshold: Number(threshold) })
      } catch {
        // Non-critical
      }

      setModuleStatus(isEnabled ? 'installed' : 'not-installed')
    } catch (err: any) {
      console.error('Module check failed:', err)
      // If factory address is zero, show not-installed with a note
      if (err.message?.includes('0x0000000000000000000000000000000000000000')) {
        setError('Factory contract not yet deployed on this chain. Contract addresses need to be configured.')
        setModuleStatus('error')
      } else {
        setError(err.message || 'Failed to check module status')
        setModuleStatus('error')
      }
    }
  }

  async function installModule() {
    if (!moduleAddress) return
    setInstalling(true)
    setError(null)

    try {
      const txs = buildModuleInstallTxs(
        safe.safeAddress as Address,
        safe.chainId,
        moduleAddress,
      )

      await sdk.txs.send({ txs })
      // Transaction proposed — it'll need multisig approval
      setModuleStatus('installed')
    } catch (err: any) {
      setError(err.message || 'Failed to propose module installation')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Module Status Card */}
      <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
        <h2 className="text-lg font-semibold text-white mb-4">Gator Module Status</h2>

        {moduleStatus === 'loading' && (
          <div className="flex items-center gap-3 text-gray-400">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-amber-500 rounded-full animate-spin" />
            Checking module status...
          </div>
        )}

        {moduleStatus === 'installed' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-green-400 font-medium">Module Active ✅</span>
            </div>
            {moduleAddress && (
              <p className="text-xs text-gray-500 font-mono">
                Module: {moduleAddress}
              </p>
            )}
            <button
              onClick={() => onNavigate('create')}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Create Permission →
            </button>
          </div>
        )}

        {moduleStatus === 'not-installed' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-red-400 font-medium">Module Not Installed</span>
            </div>
            <p className="text-sm text-gray-400">
              Your Safe doesn't have the Gator (ERC-7710) module enabled yet.
              Install it to start creating delegated permissions.
            </p>
            {moduleAddress && (
              <p className="text-xs text-gray-500 font-mono">
                Predicted module address: {moduleAddress}
              </p>
            )}
            <button
              onClick={installModule}
              disabled={installing}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              {installing ? 'Proposing Transaction...' : 'Install Gator Module'}
            </button>
            <p className="text-xs text-gray-500">
              This will propose a transaction to deploy and enable the DeleGator module.
              All Safe signers will need to approve.
            </p>
          </div>
        )}

        {moduleStatus === 'error' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-yellow-400 font-medium">Configuration Needed</span>
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Safe Info Card */}
      {safeInfo && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
          <h2 className="text-lg font-semibold text-white mb-4">Safe Details</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Address</span>
              <span className="text-gray-200 font-mono text-xs">
                {safe.safeAddress}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Chain</span>
              <span className="text-gray-200">
                {safe.chainId === 84532 ? 'Base Sepolia' : safe.chainId === 8453 ? 'Base' : `Chain ${safe.chainId}`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Threshold</span>
              <span className="text-gray-200">
                {safeInfo.threshold} of {safeInfo.owners.length}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-gray-400">Owners</span>
              <div className="mt-2 space-y-1">
                {safeInfo.owners.map((owner) => (
                  <p key={owner} className="text-xs text-gray-300 font-mono bg-white/5 rounded px-2 py-1">
                    {owner}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How It Works */}
      <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
        <h2 className="text-lg font-semibold text-white mb-4">How It Works</h2>
        <div className="space-y-3 text-sm text-gray-400">
          <div className="flex gap-3">
            <span className="text-amber-500 font-bold">1.</span>
            <span>Install the Gator module on your Safe (one-time setup)</span>
          </div>
          <div className="flex gap-3">
            <span className="text-amber-500 font-bold">2.</span>
            <span>Create a delegation — define who can spend, how much, and how often</span>
          </div>
          <div className="flex gap-3">
            <span className="text-amber-500 font-bold">3.</span>
            <span>Sign the delegation with your Safe's multisig</span>
          </div>
          <div className="flex gap-3">
            <span className="text-amber-500 font-bold">4.</span>
            <span>Share the signed delegation with the delegate — they can redeem it within the limits</span>
          </div>
        </div>
      </div>
    </div>
  )
}
