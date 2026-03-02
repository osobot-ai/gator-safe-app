import { type Address, type Hex, encodePacked, parseEther, parseUnits } from 'viem'
import { getAddresses } from '../config/addresses'
import type { Caveat } from './storage'

export type PeriodType = 'hourly' | 'daily' | 'weekly' | 'monthly'

export function periodToSeconds(period: PeriodType): bigint {
  switch (period) {
    case 'hourly':
      return 3600n
    case 'daily':
      return 86400n
    case 'weekly':
      return 604800n
    case 'monthly':
      return 2592000n // 30 days
  }
}

export function periodLabel(period: PeriodType): string {
  switch (period) {
    case 'hourly': return 'per hour'
    case 'daily': return 'per day'
    case 'weekly': return 'per week'
    case 'monthly': return 'per month'
  }
}

/**
 * Build caveats for an ETH spending limit delegation
 */
export function buildEthSpendingCaveats(
  chainId: number,
  amountEth: string,
  period: PeriodType,
  expiryTimestamp?: number,
): Caveat[] {
  const addrs = getAddresses(chainId)
  const caveats: Caveat[] = []

  // NativeTokenPeriodTransferEnforcer
  // terms: amount (uint256) + period (uint256) + startDate (uint256)
  const amountWei = parseEther(amountEth)
  const periodSeconds = periodToSeconds(period)
  const startDate = BigInt(Math.floor(Date.now() / 1000))

  caveats.push({
    enforcer: addrs.nativeTokenPeriodTransferEnforcer,
    terms: encodePacked(
      ['uint256', 'uint256', 'uint256'],
      [amountWei, periodSeconds, startDate]
    ),
  })

  // Optional: TimestampEnforcer
  if (expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000)
    caveats.push({
      enforcer: addrs.timestampEnforcer,
      terms: encodePacked(
        ['uint256', 'uint256'],
        [BigInt(now), BigInt(expiryTimestamp)]
      ),
    })
  }

  return caveats
}

/**
 * Build caveats for an ERC-20 spending limit delegation
 */
export function buildErc20SpendingCaveats(
  chainId: number,
  tokenAddress: Address,
  amount: string,
  decimals: number,
  period: PeriodType,
  expiryTimestamp?: number,
): Caveat[] {
  const addrs = getAddresses(chainId)
  const caveats: Caveat[] = []

  // ERC20PeriodTransferEnforcer
  // terms: token (address) + amount (uint256) + period (uint256) + startDate (uint256)
  const amountUnits = parseUnits(amount, decimals)
  const periodSeconds = periodToSeconds(period)
  const startDate = BigInt(Math.floor(Date.now() / 1000))

  caveats.push({
    enforcer: addrs.erc20PeriodTransferEnforcer,
    terms: encodePacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [tokenAddress, amountUnits, periodSeconds, startDate]
    ),
  })

  // ValueLteEnforcer — set to 0 (no ETH transfers allowed)
  caveats.push({
    enforcer: addrs.valueLteEnforcer,
    terms: encodePacked(['uint256'], [0n]),
  })

  // Optional: TimestampEnforcer
  if (expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000)
    caveats.push({
      enforcer: addrs.timestampEnforcer,
      terms: encodePacked(
        ['uint256', 'uint256'],
        [BigInt(now), BigInt(expiryTimestamp)]
      ),
    })
  }

  return caveats
}

export function buildCustomActionCaveats(
  chainId: number,
  targetAddress: Address,
  methodSelector: Hex,
  encodedCalldata: Hex,
  maxValueEth: string,
  maxCalls?: number,
  expiryTimestamp?: number,
): Caveat[] {
  const addrs = getAddresses(chainId)
  const caveats: Caveat[] = []

  caveats.push({
    enforcer: addrs.allowedTargetsEnforcer,
    terms: encodePacked(['address'], [targetAddress]),
  })

  caveats.push({
    enforcer: addrs.allowedMethodsEnforcer,
    terms: encodePacked(['bytes4'], [methodSelector as `0x${string}`]),
  })

  caveats.push({
    enforcer: addrs.argsEqualityCheckEnforcer,
    terms: encodedCalldata,
  })

  caveats.push({
    enforcer: addrs.valueLteEnforcer,
    terms: encodePacked(['uint256'], [parseEther(maxValueEth)]),
  })

  if (maxCalls !== undefined) {
    caveats.push({
      enforcer: addrs.limitedCallsEnforcer,
      terms: encodePacked(['uint256'], [BigInt(maxCalls)]),
    })
  }

  if (expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000)
    caveats.push({
      enforcer: addrs.timestampEnforcer,
      terms: encodePacked(
        ['uint256', 'uint256'],
        [BigInt(now), BigInt(expiryTimestamp)]
      ),
    })
  }

  return caveats
}
