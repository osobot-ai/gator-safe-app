import { useState, useEffect, useCallback } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import {
  type Address,
  type Hex,
  encodeFunctionData,
  formatEther,
  formatUnits,
  createPublicClient,
  http,
  parseAbi,
  encodePacked,
  pad,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { DeleGatorModuleFactoryABI } from '../config/abis'
import { getAddresses } from '../config/addresses'
import { DEFAULT_SALT } from '../lib/module'

// Known tokens to check balances for
const KNOWN_TOKENS: { address: Address; symbol: string; decimals: number; icon: string }[] = [
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, icon: '💵' },
  { address: '0xc78fAbC2cB5B9cf59E0Af3Da8E3Bc46d47753A4e', symbol: 'OSO', decimals: 18, icon: '🐻' },
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, icon: '💎' },
]

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
])

// ModeCode encoding for ERC-7579 execute
// CallType.Single = 0x00, ExecType.Default = 0x00, rest padding
const SINGLE_DEFAULT_MODE: Hex = pad('0x00', { size: 32 })

// DelegatorSafeModule execute ABI
const MODULE_EXECUTE_ABI = parseAbi([
  'function execute(bytes32 mode, bytes calldata executionCalldata) payable',
])

const chains: Record<number, typeof baseSepolia | typeof base> = {
  84532: baseSepolia,
  8453: base as any,
}

interface TokenBalance {
  symbol: string
  address: Address | 'native'
  decimals: number
  icon: string
  balance: bigint
  formatted: string
}

export default function ModuleTransfer() {
  const { sdk, safe } = useSafeAppsSDK()
  const [moduleAddress, setModuleAddress] = useState<Address | null>(null)
  const [loading, setLoading] = useState(true)
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')

  const chainId = safe.chainId
  const chain = chains[chainId]

  const getClient = useCallback(() => {
    if (!chain) return null
    return createPublicClient({
      chain,
      transport: http(),
    })
  }, [chain])

  // Predict module address
  useEffect(() => {
    async function predictModule() {
      const client = getClient()
      if (!client) return

      try {
        const addrs = getAddresses(chainId)
        const predicted = await client.readContract({
          address: addrs.delegatorModuleFactory,
          abi: DeleGatorModuleFactoryABI,
          functionName: 'predictAddress',
          args: [safe.safeAddress as Address, DEFAULT_SALT],
        }) as Address

        setModuleAddress(predicted)
      } catch (err) {
        console.error('Failed to predict module address:', err)
        setError('Failed to predict module address')
      } finally {
        setLoading(false)
      }
    }

    predictModule()
  }, [chainId, safe.safeAddress, getClient])

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    const client = getClient()
    if (!client || !moduleAddress) return

    setRefreshing(true)
    try {
      const results: TokenBalance[] = []

      // ETH balance
      const ethBalance = await client.getBalance({ address: moduleAddress })
      if (ethBalance > 0n) {
        results.push({
          symbol: 'ETH',
          address: 'native',
          decimals: 18,
          icon: 'Ξ',
          balance: ethBalance,
          formatted: formatEther(ethBalance),
        })
      }

      // ERC-20 balances
      for (const token of KNOWN_TOKENS) {
        try {
          const balance = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [moduleAddress],
          })
          if (balance > 0n) {
            results.push({
              symbol: token.symbol,
              address: token.address,
              decimals: token.decimals,
              icon: token.icon,
              balance,
              formatted: formatUnits(balance, token.decimals),
            })
          }
        } catch {
          // Token might not exist on this chain
        }
      }

      setBalances(results)
      // Auto-select all assets with balance
      setSelectedAssets(new Set(results.map(b => b.address)))
    } catch (err) {
      console.error('Failed to fetch balances:', err)
      setError('Failed to fetch module balances')
    } finally {
      setRefreshing(false)
    }
  }, [getClient, moduleAddress])

  useEffect(() => {
    if (moduleAddress) {
      fetchBalances()
    }
  }, [moduleAddress, fetchBalances])

  // Toggle asset selection
  function toggleAsset(address: string) {
    setSelectedAssets(prev => {
      const next = new Set(prev)
      if (next.has(address)) {
        next.delete(address)
      } else {
        next.add(address)
      }
      return next
    })
  }

  // Build the Safe transaction to call module.execute() for each selected asset
  async function handleTransfer() {
    if (!moduleAddress || selectedAssets.size === 0) return

    setSending(true)
    setError('')
    setTxHash('')

    try {
      const safeAddr = safe.safeAddress as Address
      const txs: { to: string; value: string; data: string }[] = []

      for (const asset of balances) {
        if (!selectedAssets.has(asset.address)) continue

        let executionCalldata: Hex

        if (asset.address === 'native') {
          // Single execution: transfer ETH to Safe
          // encodeSingle = abi.encodePacked(target, value, calldata)
          executionCalldata = encodePacked(
            ['address', 'uint256', 'bytes'],
            [safeAddr, asset.balance, '0x']
          )
        } else {
          // Single execution: call ERC20.transfer(safe, balance)
          const transferData = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [safeAddr, asset.balance],
          })
          executionCalldata = encodePacked(
            ['address', 'uint256', 'bytes'],
            [asset.address, 0n, transferData]
          )
        }

        // Build the Safe tx that calls module.execute(mode, executionCalldata)
        const executeData = encodeFunctionData({
          abi: MODULE_EXECUTE_ABI,
          functionName: 'execute',
          args: [SINGLE_DEFAULT_MODE, executionCalldata],
        })

        txs.push({
          to: moduleAddress,
          value: '0',
          data: executeData,
        })
      }

      const result = await sdk.txs.send({ txs })
      setTxHash(result.safeTxHash)
    } catch (err: any) {
      console.error('Transfer failed:', err)
      setError(err?.message || 'Transfer failed')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">📦 Module Withdraw</h2>
        <p className="text-sm text-gray-400">
          Transfer assets from your Delegator Safe Module back to your Safe. When swap intents are executed, 
          the output tokens are sent to the module (the root delegator). Use this to withdraw them.
        </p>
      </div>

      {/* Module Address */}
      <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">Delegator Safe Module</p>
            <p className="text-sm text-gray-300 font-mono">
              {moduleAddress || 'Not deployed'}
            </p>
          </div>
          <button
            onClick={fetchBalances}
            disabled={refreshing || !moduleAddress}
            className="text-sm text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
          >
            {refreshing ? '⟳ Loading...' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Balances */}
      {balances.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-8 bg-white/[0.02] text-center">
          <p className="text-gray-500 text-sm">
            {refreshing ? 'Fetching balances...' : 'No assets found in the module.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300">Module Assets</h3>
            <button
              onClick={() => {
                if (selectedAssets.size === balances.length) {
                  setSelectedAssets(new Set())
                } else {
                  setSelectedAssets(new Set(balances.map(b => b.address)))
                }
              }}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              {selectedAssets.size === balances.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {balances.map(asset => (
            <button
              key={asset.address}
              onClick={() => toggleAsset(asset.address)}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-colors ${
                selectedAssets.has(asset.address)
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{asset.icon}</span>
                <div className="text-left">
                  <p className="text-sm font-medium text-white">{asset.symbol}</p>
                  {asset.address !== 'native' && (
                    <p className="text-xs text-gray-500 font-mono">
                      {(asset.address as string).slice(0, 6)}...{(asset.address as string).slice(-4)}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-white">{Number(asset.formatted).toFixed(6)}</p>
                <p className="text-xs text-gray-500">
                  {selectedAssets.has(asset.address) ? '✓ Selected' : 'Click to select'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Transfer Info */}
      {selectedAssets.size > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400">
          ℹ️ This will create a Safe transaction that calls <code className="bg-black/30 px-1 rounded">execute()</code> on your 
          Delegator Module for each selected asset, transferring them back to your Safe.
          All Safe signers must approve.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
          ❌ {error}
        </div>
      )}

      {/* Success */}
      {txHash && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-400">
          ✅ Transaction submitted! Safe TX hash: <span className="font-mono">{txHash.slice(0, 10)}...</span>
        </div>
      )}

      {/* Transfer Button */}
      <button
        onClick={handleTransfer}
        disabled={sending || selectedAssets.size === 0}
        className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-lg transition-colors"
      >
        {sending
          ? 'Submitting Transaction...'
          : selectedAssets.size === 0
          ? 'Select assets to withdraw'
          : `Withdraw ${selectedAssets.size} asset${selectedAssets.size > 1 ? 's' : ''} to Safe`}
      </button>
    </div>
  )
}
