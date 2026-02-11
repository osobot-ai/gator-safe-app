import { type Address } from 'viem'
import { getAddresses } from '../config/addresses'

/**
 * Build a SmartAccountsEnvironment object compatible with the SDK's
 * createDelegation(), createCaveatBuilder(), etc.
 * 
 * The SDK expects this shape from getSmartAccountsEnvironment(),
 * but since the beta doesn't support Base chain yet, we construct it manually
 * from our known contract addresses.
 */
export function getEnvironment(chainId: number) {
  const addrs = getAddresses(chainId)

  return {
    DelegationManager: addrs.delegationManager,
    EntryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    SimpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c' as Address,
    implementations: {
      MultiSigDeleGatorImpl: '0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7' as Address,
      HybridDeleGatorImpl: '0x48dBe696A4D990079e039489bA2053B36E8FFEC4' as Address,
    },
    caveatEnforcers: {
      NativeTokenPeriodTransferEnforcer: addrs.nativeTokenPeriodTransferEnforcer,
      ERC20PeriodTransferEnforcer: addrs.erc20PeriodTransferEnforcer,
      ValueLteEnforcer: addrs.valueLteEnforcer,
      TimestampEnforcer: addrs.timestampEnforcer,
      AllowedTargetsEnforcer: addrs.allowedTargetsEnforcer,
      AllowedMethodsEnforcer: addrs.allowedMethodsEnforcer,
      LimitedCallsEnforcer: addrs.limitedCallsEnforcer,
    },
  }
}
