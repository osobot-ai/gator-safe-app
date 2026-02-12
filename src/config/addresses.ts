import { type Address } from 'viem'

export interface ChainAddresses {
  delegationManager: Address
  delegatorModuleFactory: Address
  nativeTokenPeriodTransferEnforcer: Address
  erc20PeriodTransferEnforcer: Address
  nativeTokenTransferAmountEnforcer: Address
  erc20TransferAmountEnforcer: Address
  erc20MultiOperationIncreaseBalanceEnforcer: Address
  valueLteEnforcer: Address
  timestampEnforcer: Address
  allowedTargetsEnforcer: Address
  allowedMethodsEnforcer: Address
  limitedCallsEnforcer: Address
  argsEqualityCheckEnforcer: Address
  redeemerEnforcer: Address
  delegationMetaSwapAdapter: Address
}

// DelegationManager from the Delegation Framework v1.3.0
// Same across all chains (deterministic deployment)
const DELEGATION_MANAGER: Address = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'

// Enforcer addresses (same on Base Sepolia and Base Mainnet)
const SHARED_ENFORCERS = {
  nativeTokenPeriodTransferEnforcer: '0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9' as Address,
  erc20PeriodTransferEnforcer: '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB' as Address,
  nativeTokenTransferAmountEnforcer: '0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320' as Address,
  erc20TransferAmountEnforcer: '0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc' as Address,
  erc20MultiOperationIncreaseBalanceEnforcer: '0xeaa1be91f0ea417820a765df9c5be542286bffdc' as Address,
  valueLteEnforcer: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F' as Address,
  timestampEnforcer: '0x1046bb45C8d673d4ea75321280DB34899413c069' as Address,
  allowedTargetsEnforcer: '0x7F20f61b1f09b08D970938F6fa563634d65c4EeB' as Address,
  allowedMethodsEnforcer: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5' as Address,
  limitedCallsEnforcer: '0x04658B29F6b82ed55274221a06Fc97D318E25416' as Address,
  argsEqualityCheckEnforcer: '0x44b8c6aE3C304213C3e298495E12497eD3e56e41' as Address,
  redeemerEnforcer: '0xE144b0b2618071B4E56f746313528a669c7E65c5' as Address,
  delegationMetaSwapAdapter: '0x5e4b49156D23D890e7DC264c378a443C2d22A80E' as Address,
}

export const addresses: Record<number, ChainAddresses> = {
  // Base Sepolia (84532)
  84532: {
    delegationManager: DELEGATION_MANAGER,
    delegatorModuleFactory: '0x0000000000000000000000000000000000000000' as Address, // Deploy via test:setup
    ...SHARED_ENFORCERS,
  },
  // Base Mainnet (8453)
  8453: {
    delegationManager: DELEGATION_MANAGER,
    delegatorModuleFactory: '0x0D0421e43057bf850e243EcDA2AD8966C8D5877B' as Address,
    ...SHARED_ENFORCERS,
  },
  // Localhost / Anvil (forked Base Sepolia, uses same chain ID)
  // When running locally, the factory address comes from test/deployment.json
  31337: {
    delegationManager: DELEGATION_MANAGER,
    delegatorModuleFactory: '0x0000000000000000000000000000000000000000' as Address, // Set from deployment.json
    ...SHARED_ENFORCERS,
  },
}

export function getAddresses(chainId: number): ChainAddresses {
  const addrs = addresses[chainId]
  if (!addrs) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return addrs
}
