import { useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, type Address, type Hex, isAddress } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { DEFAULT_SALT } from '../lib/module'
import {
  ROOT_AUTHORITY,
  generateSalt,
  buildDelegationTypedData,
  computeDelegationHash,
  type DelegationStruct,
} from '../lib/delegations'
import {
  buildEthSpendingCaveats,
  buildErc20SpendingCaveats,
  type PeriodType,
  periodLabel,
} from '../lib/enforcers'
import { saveDelegation, type StoredDelegation } from '../lib/storage'

type Step = 1 | 2 | 3 | 4
type PermissionType = 'eth' | 'erc20'

const chains: Record<number, (typeof baseSepolia) | (typeof base)> = {
  84532: baseSepolia,
  8453: base as any,
}

export default function CreateDelegation() {
  const { sdk, safe } = useSafeAppsSDK()

  // Step 1 - Delegate
  const [delegate, setDelegate] = useState('')
  // Step 2 - Type
  const [permType, setPermType] = useState<PermissionType>('eth')
  // Step 3 - Limits
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState(18)
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')

  // UI state
  const [step, setStep] = useState<Step>(1)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [signedDelegation, setSignedDelegation] = useState<StoredDelegation | null>(null)
  const [error, setError] = useState<string | null>(null)

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return isAddress(delegate)
      case 2:
        return true
      case 3:
        if (!amount || parseFloat(amount) <= 0) return false
        if (permType === 'erc20' && !isAddress(tokenAddress)) return false
        if (expiryEnabled && !expiryDate) return false
        return true
      default:
        return true
    }
  }

  async function handleGrant() {
    setSigning(true)
    setError(null)

    try {
      const chain = chains[safe.chainId]
      if (!chain) throw new Error(`Unsupported chain: ${safe.chainId}`)

      const client = createPublicClient({ chain, transport: http() })
      const addrs = getAddresses(safe.chainId)

      // Get module address (the delegator)
      const moduleAddress = await client.readContract({
        address: addrs.delegatorModuleFactory,
        abi: DeleGatorModuleFactoryABI,
        functionName: 'predictAddress',
        args: [safe.safeAddress as Address, DEFAULT_SALT],
      }) as Address

      // Build caveats
      const expiryTs = expiryEnabled && expiryDate
        ? Math.floor(new Date(expiryDate).getTime() / 1000)
        : undefined

      const caveats = permType === 'eth'
        ? buildEthSpendingCaveats(safe.chainId, amount, period, expiryTs)
        : buildErc20SpendingCaveats(
            safe.chainId,
            tokenAddress as Address,
            amount,
            tokenDecimals,
            period,
            expiryTs,
          )

      // Build delegation
      const salt = generateSalt()
      const delegation: DelegationStruct = {
        delegate: delegate as Address,
        delegator: moduleAddress,
        authority: ROOT_AUTHORITY,
        caveats,
        salt,
        signature: '0x' as Hex,
      }

      // Build EIP-712 typed data
      const typedData = buildDelegationTypedData(delegation, safe.chainId)

      // Request signature via Safe SDK
      const result = await sdk.txs.signTypedMessage(typedData as any) as any

      // Store the delegation
      const delegationHash = computeDelegationHash(delegation)
      const stored: StoredDelegation = {
        delegation: {
          ...delegation,
          signature: (result?.signature || result?.safeTxHash || '0x') as Hex,
        },
        meta: {
          label: permType === 'eth'
            ? `${amount} ETH ${periodLabel(period)}`
            : `${amount} tokens ${periodLabel(period)}`,
          scopeType: permType === 'eth' ? 'ethSpendingLimit' : 'erc20SpendingLimit',
          createdAt: new Date().toISOString(),
          chainId: safe.chainId,
          safeAddress: safe.safeAddress as Address,
          moduleAddress,
          status: 'signed',
          delegationHash,
          amount,
          period,
          tokenAddress: permType === 'erc20' ? (tokenAddress as Address) : undefined,
          expiryDate: expiryEnabled ? expiryDate : undefined,
        },
      }

      saveDelegation(stored)
      setSignedDelegation(stored)
      setSigned(true)
    } catch (err: any) {
      console.error('Signing failed:', err)
      setError(err.message || 'Failed to sign delegation')
    } finally {
      setSigning(false)
    }
  }

  function copyToClipboard() {
    if (!signedDelegation) return
    navigator.clipboard.writeText(JSON.stringify(signedDelegation, null, 2))
  }

  function downloadJson() {
    if (!signedDelegation) return
    const blob = new Blob([JSON.stringify(signedDelegation, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `delegation-${signedDelegation.meta.delegationHash.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Signed state
  if (signed && signedDelegation) {
    return (
      <div className="space-y-6">
        <div className="border border-green-500/30 rounded-xl p-6 bg-green-500/5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <h2 className="text-lg font-semibold text-green-400">Delegation Ready!</h2>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            The delegation has been signed and is ready to share with the delegate.
          </p>

          <div className="bg-black/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Delegate</span>
              <span className="text-gray-300 font-mono text-xs">{signedDelegation.delegation.delegate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="text-gray-300">{signedDelegation.meta.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Hash</span>
              <span className="text-gray-300 font-mono text-xs">
                {signedDelegation.meta.delegationHash.slice(0, 20)}...
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={copyToClipboard}
              className="bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              📋 Copy JSON
            </button>
            <button
              onClick={downloadJson}
              className="bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              💾 Download JSON
            </button>
            <button
              onClick={() => {
                setSigned(false)
                setSignedDelegation(null)
                setStep(1)
                setDelegate('')
                setAmount('')
              }}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Create Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === step
                  ? 'bg-amber-500 text-black'
                  : s < step
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-white/5 text-gray-600'
              }`}
            >
              {s < step ? '✓' : s}
            </div>
            {s < 4 && <div className={`w-8 h-px ${s < step ? 'bg-amber-500/30' : 'bg-white/10'}`} />}
          </div>
        ))}
        <span className="text-xs text-gray-500 ml-2">
          {step === 1 && 'Delegate'}
          {step === 2 && 'Permission Type'}
          {step === 3 && 'Configure Limits'}
          {step === 4 && 'Review & Sign'}
        </span>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Delegate */}
      {step === 1 && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Who gets the permission?</h2>
          <p className="text-sm text-gray-400">
            Enter the Ethereum address of the delegate — the account that will be able to spend from your Safe.
          </p>
          <input
            type="text"
            placeholder="0x..."
            value={delegate}
            onChange={(e) => setDelegate(e.target.value)}
          />
          {delegate && !isAddress(delegate) && (
            <p className="text-xs text-red-400">Invalid Ethereum address</p>
          )}
        </div>
      )}

      {/* Step 2: Permission Type */}
      {step === 2 && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Permission Type</h2>
          <p className="text-sm text-gray-400">What kind of spending limit?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPermType('eth')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                permType === 'eth'
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              <div className="text-2xl mb-2">Ξ</div>
              <div className="font-medium text-white">ETH Spending Limit</div>
              <div className="text-xs text-gray-400 mt-1">Recurring ETH allowance</div>
            </button>
            <button
              onClick={() => setPermType('erc20')}
              className={`p-4 rounded-lg border text-left transition-colors ${
                permType === 'erc20'
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              <div className="text-2xl mb-2">🪙</div>
              <div className="font-medium text-white">ERC-20 Spending Limit</div>
              <div className="text-xs text-gray-400 mt-1">Recurring token allowance</div>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Configure Limits */}
      {step === 3 && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Configure Limits</h2>

          {permType === 'erc20' && (
            <div>
              <label className="text-sm text-gray-400 block mb-1">Token Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
              />
              {tokenAddress && !isAddress(tokenAddress) && (
                <p className="text-xs text-red-400 mt-1">Invalid token address</p>
              )}
              <div className="mt-2">
                <label className="text-sm text-gray-400 block mb-1">Token Decimals</label>
                <input
                  type="number"
                  value={tokenDecimals}
                  onChange={(e) => setTokenDecimals(parseInt(e.target.value) || 18)}
                  min={0}
                  max={24}
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Amount per period {permType === 'eth' ? '(ETH)' : '(tokens)'}
            </label>
            <input
              type="number"
              placeholder="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step="any"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodType)}>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={expiryEnabled}
                onChange={(e) => setExpiryEnabled(e.target.checked)}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm text-gray-400">Set expiry date</span>
            </label>
            {expiryEnabled && (
              <input
                type="datetime-local"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {permType === 'erc20' && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400">
              ℹ️ ETH transfers will be blocked for this delegation (ValueLteEnforcer set to 0).
            </div>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Review & Sign</h2>

          <div className="bg-black/30 rounded-lg p-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Delegate</span>
              <span className="text-gray-300 font-mono text-xs">{delegate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="text-gray-300">
                {permType === 'eth' ? 'ETH Spending Limit' : 'ERC-20 Spending Limit'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="text-gray-300">
                {amount} {permType === 'eth' ? 'ETH' : 'tokens'} {periodLabel(period)}
              </span>
            </div>
            {permType === 'erc20' && (
              <div className="flex justify-between">
                <span className="text-gray-500">Token</span>
                <span className="text-gray-300 font-mono text-xs">{tokenAddress}</span>
              </div>
            )}
            {expiryEnabled && expiryDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">Expires</span>
                <span className="text-gray-300">{new Date(expiryDate).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
            ⚠️ This will request an EIP-712 signature from your Safe. All required signers must approve.
          </div>

          <button
            onClick={handleGrant}
            disabled={signing}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            {signing ? 'Requesting Signature...' : 'Grant Permission'}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
          disabled={step === 1}
          className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors"
        >
          ← Back
        </button>
        {step < 4 && (
          <button
            onClick={() => setStep((s) => Math.min(4, s + 1) as Step)}
            disabled={!canProceed()}
            className="bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-amber-400 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  )
}
