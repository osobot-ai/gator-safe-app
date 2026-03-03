import { type Address, type Hex, encodePacked, parseEther, parseUnits, encodeAbiParameters } from 'viem'
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

export interface CustomParam {
  type: string
  value: string
  name: string
  locked: boolean
  required: boolean
  enforced: boolean
  description: string
}

/**
 * Encode a single parameter value as 32-byte ABI encoding
 */
function encodeParamValue(type: string, value: string): Hex {
  if (type === 'address') {
    return encodeAbiParameters([{ type: 'address' }], [value as Address])
  } else if (type === 'uint256') {
    return encodeAbiParameters([{ type: 'uint256' }], [BigInt(value)])
  } else if (type === 'bool') {
    return encodeAbiParameters([{ type: 'bool' }], [value === 'true'])
  } else if (type === 'bytes32') {
    return encodeAbiParameters([{ type: 'bytes32' }], [value as Hex])
  }
  // Default: encode as bytes
  return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
}

/**
 * Encode full function calldata (selector + encoded args)
 */
function encodeFunctionCalldata(selector: Hex, params: CustomParam[]): Hex {
  const types = params.map(p => ({ type: p.type }))
  const values = params.map(p => {
    if (p.type === 'address') return p.value as Address
    if (p.type === 'uint256') return BigInt(p.value)
    if (p.type === 'bool') return p.value === 'true'
    if (p.type === 'bytes32') return p.value as Hex
    return p.value
  })
  const encodedArgs = encodeAbiParameters(types as any, values as any)
  return (selector + encodedArgs.slice(2)) as Hex
}

export function buildCustomActionCaveats(
  chainId: number,
  targetAddress: Address,
  methodSelector: Hex,
  customParams: CustomParam[],
  maxValueEth: string,
  maxCalls?: number,
  expiryTimestamp?: number,
): Caveat[] {
  const addrs = getAddresses(chainId)
  const caveats: Caveat[] = []

  // AllowedTargetsEnforcer
  caveats.push({
    enforcer: addrs.allowedTargetsEnforcer,
    terms: encodePacked(['address'], [targetAddress]),
  })

  // AllowedMethodsEnforcer
  caveats.push({
    enforcer: addrs.allowedMethodsEnforcer,
    terms: encodePacked(['bytes4'], [methodSelector as `0x${string}`]),
  })

  // Determine which params are enforced
  // All listed params are enforced — if count matches method arity, use ExactCalldata
  // If fewer params than method takes, use AllowedCalldata per param
  const allParamsProvided = customParams.length > 0 && customParams.every(p => p.value)

  if (allParamsProvided) {
    // ALL params enforced → use ExactCalldataEnforcer
    // terms = the full calldata (selector + abi-encoded args)
    const fullCalldata = encodeFunctionCalldata(methodSelector, customParams)
    caveats.push({
      enforcer: addrs.exactCalldataEnforcer,
      terms: fullCalldata,
    })
  } else if (customParams.some(p => p.value)) {
    // SOME params enforced → use AllowedCalldataEnforcer (one per enforced param)
    // ABI encoding: selector is 4 bytes, each param is 32 bytes
    // Param 0 starts at byte 4, param 1 at byte 36, param 2 at byte 68, etc.
    for (let i = 0; i < customParams.length; i++) {
      if (customParams[i].value) {
        const startIndex = 4 + (i * 32)
        const encodedValue = encodeParamValue(customParams[i].type, customParams[i].value)
        caveats.push({
          enforcer: addrs.allowedCalldataEnforcer,
          terms: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            [BigInt(startIndex), encodedValue]
          ),
        })
      }
    }
  }
  // If NO params enforced, no calldata caveat (only target + method restrictions)

  // ValueLteEnforcer
  caveats.push({
    enforcer: addrs.valueLteEnforcer,
    terms: encodePacked(['uint256'], [parseEther(maxValueEth)]),
  })

  // Optional: LimitedCallsEnforcer
  if (maxCalls !== undefined) {
    caveats.push({
      enforcer: addrs.limitedCallsEnforcer,
      terms: encodePacked(['uint256'], [BigInt(maxCalls)]),
    })
  }

  // Optional: TimestampEnforcer
  if (expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000)
    caveats.push({
      enforcer: addrs.timestampEnforcer,
      terms: encodePacked(
        ['uint128', 'uint128'],
        [BigInt(now), BigInt(expiryTimestamp)]
      ),
    })
  }

  return caveats
}
