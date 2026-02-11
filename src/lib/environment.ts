import { getSmartAccountsEnvironment } from '@metamask/smart-accounts-kit'

/**
 * Get the SmartAccountsEnvironment for the current chain.
 * This resolves all contract addresses (DelegationManager, enforcers, etc.)
 * from the SDK's built-in deployment registry.
 */
export function getEnvironment(chainId: number) {
  return getSmartAccountsEnvironment(chainId)
}
