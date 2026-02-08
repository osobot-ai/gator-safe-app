import { type Address } from 'viem'

// TODO: Replace with actual deployed addresses once confirmed
// These are placeholder addresses that need to be filled in

export interface ChainAddresses {
  delegationManager: Address
  delegatorModuleFactory: Address
  nativeTokenPeriodTransferEnforcer: Address
  erc20PeriodTransferEnforcer: Address
  valueLteEnforcer: Address
  timestampEnforcer: Address
}

// DelegationManager from the Delegation Framework v1.3.0
// This address is the same across all chains (deterministic deployment)
const DELEGATION_MANAGER: Address = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'

export const addresses: Record<number, ChainAddresses> = {
  // Base Sepolia (84532)
  84532: {
    delegationManager: DELEGATION_MANAGER,
    // TODO: Get actual DeleGatorModuleFactory address for Base Sepolia
    delegatorModuleFactory: '0x0000000000000000000000000000000000000000' as Address,
    // TODO: Get actual enforcer addresses for Base Sepolia
    nativeTokenPeriodTransferEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    erc20PeriodTransferEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    valueLteEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    timestampEnforcer: '0x0000000000000000000000000000000000000000' as Address,
  },
  // Base Mainnet (8453)
  8453: {
    delegationManager: DELEGATION_MANAGER,
    // TODO: Get actual DeleGatorModuleFactory address for Base Mainnet
    delegatorModuleFactory: '0x0000000000000000000000000000000000000000' as Address,
    // TODO: Get actual enforcer addresses for Base Mainnet
    nativeTokenPeriodTransferEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    erc20PeriodTransferEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    valueLteEnforcer: '0x0000000000000000000000000000000000000000' as Address,
    timestampEnforcer: '0x0000000000000000000000000000000000000000' as Address,
  },
}

export function getAddresses(chainId: number): ChainAddresses {
  const addrs = addresses[chainId]
  if (!addrs) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return addrs
}
