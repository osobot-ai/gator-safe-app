import { useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import { createPublicClient, http, type Address, type Hex, isAddress, parseEther, parseUnits, encodePacked } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import { createDelegation } from '@metamask/smart-accounts-kit'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { DEFAULT_SALT } from '../lib/module'
import {
  generateSalt,
  buildDelegationTypedData,
  computeDelegationHash,
  type DelegationStruct,
} from '../lib/delegations'
import {
  type PeriodType,
  periodLabel,
  periodToSeconds,
} from '../lib/enforcers'
import { getEnvironment } from '../lib/environment'
import { saveDelegation, type StoredDelegation } from '../lib/storage'

type Step = 1 | 2 | 3 | 4 | 5
type PermissionCategory = 'spendingLimit' | 'transferIntent'
type PermissionType = 'eth' | 'erc20'
type TokenOption = 'usdc' | 'oso' | 'custom'

const KNOWN_TOKENS: Record<string, { address: Address; decimals: number; symbol: string }> = {
  usdc: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    symbol: 'USDC',
  },
  oso: {
    address: '0xc78fabc2cb5b9cf59e0af3da8e3bc46d47753a4e',
    decimals: 18,
    symbol: 'OSO',
  },
}

const chains: Record<number, (typeof baseSepolia) | (typeof base)> = {
  84532: baseSepolia,
  8453: base as any,
}

function TokenSelector({
  selected,
  onSelect,
  customAddress,
  onCustomAddressChange,
  customDecimals,
  onCustomDecimalsChange,
  label,
}: {
  selected: TokenOption
  onSelect: (opt: TokenOption) => void
  customAddress: string
  onCustomAddressChange: (v: string) => void
  customDecimals: number
  onCustomDecimalsChange: (v: number) => void
  label: string
}) {
  return (
    <div className="space-y-3">
      <label className="text-sm text-gray-400 block">{label}</label>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onSelect('usdc')}
          className={`p-3 rounded-lg border text-center transition-colors ${
            selected === 'usdc'
              ? 'border-amber-500/50 bg-amber-500/10'
              : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
          }`}
        >
          <div className="text-lg mb-1">💵</div>
          <div className="text-sm font-medium text-white">USDC</div>
          <div className="text-[10px] text-gray-500 mt-0.5">6 decimals</div>
        </button>
        <button
          onClick={() => onSelect('oso')}
          className={`p-3 rounded-lg border text-center transition-colors ${
            selected === 'oso'
              ? 'border-amber-500/50 bg-amber-500/10'
              : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
          }`}
        >
          <div className="text-lg mb-1">🐻</div>
          <div className="text-sm font-medium text-white">OSO</div>
          <div className="text-[10px] text-gray-500 mt-0.5">18 decimals</div>
        </button>
        <button
          onClick={() => onSelect('custom')}
          className={`p-3 rounded-lg border text-center transition-colors ${
            selected === 'custom'
              ? 'border-amber-500/50 bg-amber-500/10'
              : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
          }`}
        >
          <div className="text-lg mb-1">⚙️</div>
          <div className="text-sm font-medium text-white">Custom</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Any ERC-20</div>
        </button>
      </div>

      {selected === 'custom' && (
        <div className="space-y-2">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Token Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={customAddress}
              onChange={(e) => onCustomAddressChange(e.target.value)}
            />
            {customAddress && !isAddress(customAddress) && (
              <p className="text-xs text-red-400 mt-1">Invalid token address</p>
            )}
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Token Decimals</label>
            <input
              type="number"
              value={customDecimals}
              onChange={(e) => onCustomDecimalsChange(parseInt(e.target.value) || 18)}
              min={0}
              max={24}
            />
          </div>
        </div>
      )}

      {selected !== 'custom' && (
        <div className="bg-white/5 rounded-lg p-2 text-xs text-gray-400 font-mono">
          {KNOWN_TOKENS[selected]?.address}
        </div>
      )}
    </div>
  )
}

function getTokenAddress(option: TokenOption, customAddr: string): string {
  return option === 'custom' ? customAddr : KNOWN_TOKENS[option]?.address || ''
}

function getTokenDecimals(option: TokenOption, customDec: number): number {
  return option === 'custom' ? customDec : KNOWN_TOKENS[option]?.decimals || 18
}

function getTokenSymbol(option: TokenOption): string {
  return option === 'custom' ? 'tokens' : KNOWN_TOKENS[option]?.symbol || 'tokens'
}

export default function CreateDelegation() {
  const { sdk, safe } = useSafeAppsSDK()

  // Step 1 - Delegate
  const [delegate, setDelegate] = useState('')
  // Step 2 - Category
  const [category, setCategory] = useState<PermissionCategory>('spendingLimit')
  // Step 3 - Spending Limit: Type selection
  const [permType, setPermType] = useState<PermissionType>('eth')
  // Step 3 - Spending Limit: Limits
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [tokenOption, setTokenOption] = useState<TokenOption>('usdc')
  const [customTokenAddress, setCustomTokenAddress] = useState('')
  const [customTokenDecimals, setCustomTokenDecimals] = useState(18)
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')

  // Step 3 - Transfer Intent
  const [sendType, setSendType] = useState<PermissionType>('eth')
  const [sendAmount, setSendAmount] = useState('')
  const [sendTokenOption, setSendTokenOption] = useState<TokenOption>('usdc')
  const [sendCustomAddress, setSendCustomAddress] = useState('')
  const [sendCustomDecimals, setSendCustomDecimals] = useState(18)
  const [receiveTokenOption, setReceiveTokenOption] = useState<TokenOption>('usdc')
  const [receiveCustomAddress, setReceiveCustomAddress] = useState('')
  const [receiveCustomDecimals, setReceiveCustomDecimals] = useState(18)
  const [receiveAmount, setReceiveAmount] = useState('')

  // UI state
  const [step, setStep] = useState<Step>(1)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [signedDelegation, setSignedDelegation] = useState<StoredDelegation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedCreate, setCopiedCreate] = useState(false)

  // Derived token values for spending limit
  const tokenAddress = getTokenAddress(tokenOption, customTokenAddress)
  const tokenDecimals = getTokenDecimals(tokenOption, customTokenDecimals)

  // Total steps depends on category
  const totalSteps = category === 'spendingLimit' ? 5 : 4
  const reviewStep = category === 'spendingLimit' ? 5 : 4
  // configStep not used directly but kept for reference

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return isAddress(delegate)
      case 2:
        return true
      case 3:
        if (category === 'spendingLimit') return true // This is just type selection
        // Transfer intent config
        if (!sendAmount || parseFloat(sendAmount) <= 0) return false
        if (!receiveAmount || parseFloat(receiveAmount) <= 0) return false
        if (sendType === 'erc20' && !isAddress(getTokenAddress(sendTokenOption, sendCustomAddress))) return false
        if (!isAddress(getTokenAddress(receiveTokenOption, receiveCustomAddress))) return false
        return true
      case 4:
        if (category === 'spendingLimit') {
          // Config step
          if (!amount || parseFloat(amount) <= 0) return false
          if (permType === 'erc20' && !isAddress(tokenAddress)) return false
          if (expiryEnabled && !expiryDate) return false
          return true
        }
        return true // Review step for intent
      case 5:
        return true // Review step for spending limit
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

      const environment = getEnvironment(safe.chainId)
      const now = Math.floor(Date.now() / 1000)
      const salt = generateSalt()

      let sdkDelegation: any
      let metaLabel: string
      let scopeType: 'ethSpendingLimit' | 'erc20SpendingLimit' | 'transferIntent'

      if (category === 'spendingLimit') {
        // === SPENDING LIMIT ===
        const expiryTs = expiryEnabled && expiryDate
          ? Math.floor(new Date(expiryDate).getTime() / 1000)
          : undefined

        const scope = permType === 'eth'
          ? {
              type: 'nativeTokenPeriodTransfer' as const,
              periodAmount: parseEther(amount),
              periodDuration: Number(periodToSeconds(period)),
              startDate: now,
            }
          : {
              type: 'erc20PeriodTransfer' as const,
              tokenAddress: tokenAddress as Address,
              periodAmount: parseUnits(amount, tokenDecimals),
              periodDuration: Number(periodToSeconds(period)),
              startDate: now,
            }

        const additionalCaveats: Array<any> = []
        if (expiryTs) {
          additionalCaveats.push({
            type: 'timestamp' as const,
            afterThreshold: now,
            beforeThreshold: expiryTs,
          })
        }

        sdkDelegation = createDelegation({
          to: delegate as Address,
          from: moduleAddress,
          environment: environment as any,
          scope: scope as any,
          caveats: additionalCaveats.length > 0 ? additionalCaveats : undefined,
          salt,
        })

        metaLabel = permType === 'eth'
          ? `${amount} ETH ${periodLabel(period)}`
          : `${amount} ${getTokenSymbol(tokenOption)} ${periodLabel(period)}`
        scopeType = permType === 'eth' ? 'ethSpendingLimit' : 'erc20SpendingLimit'

      } else {
        // === TRANSFER INTENT ===
        // "Let delegate spend X, but delegator must receive Y"
        //
        // Caveats:
        // 1. Spending side: NativeTokenTransferAmount or ERC20TransferAmount (limits what goes out)
        // 2. Receive side: ERC20MultiOperationIncreaseBalanceEnforcer (ensures what comes back)

        const sendTokenAddr = getTokenAddress(sendTokenOption, sendCustomAddress) as Address
        const sendTokenDec = getTokenDecimals(sendTokenOption, sendCustomDecimals)
        const receiveTokenAddr = getTokenAddress(receiveTokenOption, receiveCustomAddress) as Address
        const receiveTokenDec = getTokenDecimals(receiveTokenOption, receiveCustomDecimals)

        // Build caveats manually since we need a custom enforcer
        const caveats: Array<{enforcer: Address; terms: Hex}> = []

        // Spending caveat
        if (sendType === 'eth') {
          // NativeTokenTransferAmount: terms = uint256 amount
          caveats.push({
            enforcer: addrs.nativeTokenTransferAmountEnforcer,
            terms: encodePacked(['uint256'], [parseEther(sendAmount)]),
          })
        } else {
          // ERC20TransferAmount: terms = address token + uint256 amount
          caveats.push({
            enforcer: addrs.erc20TransferAmountEnforcer,
            terms: encodePacked(
              ['address', 'uint256'],
              [sendTokenAddr, parseUnits(sendAmount, sendTokenDec)]
            ),
          })
          // Block ETH transfers
          caveats.push({
            enforcer: addrs.valueLteEnforcer,
            terms: encodePacked(['uint256'], [0n]),
          })
        }

        // Receive caveat: ERC20MultiOperationIncreaseBalanceEnforcer
        // terms: address token (20) + address recipient (20) + uint256 amount (32) = 72 bytes
        // recipient = the delegator (moduleAddress) — they must receive the tokens
        caveats.push({
          enforcer: addrs.erc20MultiOperationIncreaseBalanceEnforcer,
          terms: encodePacked(
            ['address', 'address', 'uint256'],
            [receiveTokenAddr, moduleAddress, parseUnits(receiveAmount, receiveTokenDec)]
          ),
        })

        // Build delegation with raw caveats (can't use SDK scope for custom enforcer)
        const { ROOT_AUTHORITY } = await import('@metamask/smart-accounts-kit')

        sdkDelegation = {
          delegate: delegate as Address,
          delegator: moduleAddress,
          authority: ROOT_AUTHORITY,
          caveats: caveats.map(c => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: '0x' as Hex,
          })),
          salt: salt,
          signature: '0x' as Hex,
        }

        const sendSymbol = sendType === 'eth' ? 'ETH' : getTokenSymbol(sendTokenOption)
        const receiveSymbol = getTokenSymbol(receiveTokenOption)
        metaLabel = `Intent: ${sendAmount} ${sendSymbol} → ${receiveAmount} ${receiveSymbol}`
        scopeType = 'transferIntent'
      }

      // Convert to DelegationStruct for storage/signing
      const delegation: DelegationStruct = {
        delegate: sdkDelegation.delegate as Address,
        delegator: sdkDelegation.delegator as Address,
        authority: sdkDelegation.authority as Hex,
        caveats: sdkDelegation.caveats.map((c: any) => ({
          enforcer: c.enforcer as Address,
          terms: c.terms as Hex,
        })),
        salt: sdkDelegation.salt as Hex,
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
          label: metaLabel,
          scopeType,
          createdAt: new Date().toISOString(),
          chainId: safe.chainId,
          safeAddress: safe.safeAddress as Address,
          moduleAddress,
          status: 'signed',
          delegationHash,
          amount: category === 'spendingLimit' ? amount : sendAmount,
          period: category === 'spendingLimit' ? period : undefined,
          tokenAddress: category === 'spendingLimit'
            ? (permType === 'erc20' ? (tokenAddress as Address) : undefined)
            : undefined,
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

  async function copyToClipboard() {
    if (!signedDelegation) return
    const text = JSON.stringify(signedDelegation, null, 2)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopiedCreate(true)
    setTimeout(() => setCopiedCreate(false), 2000)
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
              {copiedCreate ? '✅ Copied!' : '📋 Copy JSON'}
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
                setSendAmount('')
                setReceiveAmount('')
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

  // Step labels
  function getStepLabel(s: number): string {
    if (s === 1) return 'Delegate'
    if (s === 2) return 'Category'
    if (category === 'spendingLimit') {
      if (s === 3) return 'Asset Type'
      if (s === 4) return 'Configure'
      if (s === 5) return 'Review & Sign'
    } else {
      if (s === 3) return 'Configure Intent'
      if (s === 4) return 'Review & Sign'
    }
    return ''
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
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
            {s < totalSteps && <div className={`w-8 h-px ${s < step ? 'bg-amber-500/30' : 'bg-white/10'}`} />}
          </div>
        ))}
        <span className="text-xs text-gray-500 ml-2">
          {getStepLabel(step)}
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
            Enter the Ethereum address of the delegate — the account that will be able to act on behalf of your Safe.
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

      {/* Step 2: Category */}
      {step === 2 && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Permission Category</h2>
          <p className="text-sm text-gray-400">What kind of permission do you want to create?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setCategory('spendingLimit')}
              className={`p-5 rounded-lg border text-left transition-colors ${
                category === 'spendingLimit'
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              <div className="text-2xl mb-2">💰</div>
              <div className="font-medium text-white">Spending Limit</div>
              <div className="text-xs text-gray-400 mt-1">
                Recurring allowance to spend ETH or ERC-20 tokens
              </div>
            </button>
            <button
              onClick={() => setCategory('transferIntent')}
              className={`p-5 rounded-lg border text-left transition-colors ${
                category === 'transferIntent'
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              <div className="text-2xl mb-2">🔄</div>
              <div className="font-medium text-white">Transfer Intent</div>
              <div className="text-xs text-gray-400 mt-1">
                Allow transfers out only if you receive tokens in return
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Step 3 (Spending Limit): Asset Type */}
      {step === 3 && category === 'spendingLimit' && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Asset Type</h2>
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

      {/* Step 4 (Spending Limit): Configure Limits */}
      {step === 4 && category === 'spendingLimit' && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Configure Limits</h2>

          {permType === 'erc20' && (
            <TokenSelector
              selected={tokenOption}
              onSelect={setTokenOption}
              customAddress={customTokenAddress}
              onCustomAddressChange={setCustomTokenAddress}
              customDecimals={customTokenDecimals}
              onCustomDecimalsChange={setCustomTokenDecimals}
              label="Select Token"
            />
          )}

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Amount per period {permType === 'eth' ? '(ETH)' : `(${getTokenSymbol(tokenOption)})`}
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

      {/* Step 3 (Transfer Intent): Configure Intent */}
      {step === 3 && category === 'transferIntent' && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-6">
          <h2 className="text-lg font-semibold text-white">Configure Transfer Intent</h2>
          <p className="text-sm text-gray-400">
            Define what the delegate can send out and what you must receive in return.
          </p>

          {/* SEND SIDE */}
          <div className="border border-white/10 rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-sm font-medium">📤 Delegate Can Send</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSendType('eth')}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  sendType === 'eth'
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                <div className="text-lg">Ξ</div>
                <div className="text-xs font-medium text-white">ETH</div>
              </button>
              <button
                onClick={() => setSendType('erc20')}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  sendType === 'erc20'
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                <div className="text-lg">🪙</div>
                <div className="text-xs font-medium text-white">ERC-20</div>
              </button>
            </div>

            {sendType === 'erc20' && (
              <TokenSelector
                selected={sendTokenOption}
                onSelect={setSendTokenOption}
                customAddress={sendCustomAddress}
                onCustomAddressChange={setSendCustomAddress}
                customDecimals={sendCustomDecimals}
                onCustomDecimalsChange={setSendCustomDecimals}
                label="Token to send"
              />
            )}

            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Max amount {sendType === 'eth' ? '(ETH)' : `(${getTokenSymbol(sendTokenOption)})`}
              </label>
              <input
                type="number"
                placeholder="1.0"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                min={0}
                step="any"
              />
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <div className="text-2xl text-gray-500">⇅</div>
          </div>

          {/* RECEIVE SIDE */}
          <div className="border border-green-500/20 rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-sm font-medium">📥 You Must Receive</span>
            </div>

            <TokenSelector
              selected={receiveTokenOption}
              onSelect={setReceiveTokenOption}
              customAddress={receiveCustomAddress}
              onCustomAddressChange={setReceiveCustomAddress}
              customDecimals={receiveCustomDecimals}
              onCustomDecimalsChange={setReceiveCustomDecimals}
              label="Token to receive"
            />

            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Min amount ({getTokenSymbol(receiveTokenOption)})
              </label>
              <input
                type="number"
                placeholder="100"
                value={receiveAmount}
                onChange={(e) => setReceiveAmount(e.target.value)}
                min={0}
                step="any"
              />
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400">
            ℹ️ The delegate can only transfer out the specified amount if your Safe's balance of the receive token increases by at least the minimum amount. This is enforced atomically on-chain.
          </div>
        </div>
      )}

      {/* Review Step (Spending Limit: step 5, Transfer Intent: step 4) */}
      {step === reviewStep && (
        <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
          <h2 className="text-lg font-semibold text-white">Review & Sign</h2>

          <div className="bg-black/30 rounded-lg p-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Delegate</span>
              <span className="text-gray-300 font-mono text-xs">{delegate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Category</span>
              <span className="text-gray-300">
                {category === 'spendingLimit' ? '💰 Spending Limit' : '🔄 Transfer Intent'}
              </span>
            </div>

            {category === 'spendingLimit' && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="text-gray-300">
                    {permType === 'eth' ? 'ETH Spending Limit' : 'ERC-20 Spending Limit'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="text-gray-300">
                    {amount} {permType === 'eth' ? 'ETH' : getTokenSymbol(tokenOption)} {periodLabel(period)}
                  </span>
                </div>
                {permType === 'erc20' && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Token</span>
                    <span className="text-gray-300 font-mono text-xs">
                      {getTokenSymbol(tokenOption)} — {tokenAddress}
                    </span>
                  </div>
                )}
                {expiryEnabled && expiryDate && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Expires</span>
                    <span className="text-gray-300">{new Date(expiryDate).toLocaleString()}</span>
                  </div>
                )}
              </>
            )}

            {category === 'transferIntent' && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">📤 Send (max)</span>
                  <span className="text-gray-300">
                    {sendAmount} {sendType === 'eth' ? 'ETH' : getTokenSymbol(sendTokenOption)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">📥 Receive (min)</span>
                  <span className="text-gray-300">
                    {receiveAmount} {getTokenSymbol(receiveTokenOption)}
                  </span>
                </div>
                {sendType === 'erc20' && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Send Token</span>
                    <span className="text-gray-300 font-mono text-xs">
                      {getTokenAddress(sendTokenOption, sendCustomAddress)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Receive Token</span>
                  <span className="text-gray-300 font-mono text-xs">
                    {getTokenAddress(receiveTokenOption, receiveCustomAddress)}
                  </span>
                </div>
              </>
            )}
          </div>

          {category === 'transferIntent' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
              🔄 This delegation says: "I will let you transfer {sendAmount} {sendType === 'eth' ? 'ETH' : getTokenSymbol(sendTokenOption)} out, if and only if I receive {receiveAmount} {getTokenSymbol(receiveTokenOption)} in return."
            </div>
          )}

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
        {step < reviewStep && (
          <button
            onClick={() => setStep((s) => Math.min(reviewStep, s + 1) as Step)}
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
