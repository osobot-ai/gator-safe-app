import { type Address, type Hex, encodeFunctionData } from 'viem'
import { DeleGatorModuleFactoryABI, SafeABI } from '../config/abis'
import { getAddresses } from '../config/addresses'

// Default salt for module deployment
const DEFAULT_SALT: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000001'

/**
 * Build transactions to deploy and enable the DeleGator module
 */
export function buildModuleInstallTxs(
  safeAddress: Address,
  chainId: number,
  predictedModuleAddress: Address,
) {
  const addrs = getAddresses(chainId)

  return [
    {
      to: addrs.delegatorModuleFactory,
      value: '0',
      data: encodeFunctionData({
        abi: DeleGatorModuleFactoryABI,
        functionName: 'deploy',
        args: [safeAddress, DEFAULT_SALT],
      }),
    },
    {
      to: safeAddress,
      value: '0',
      data: encodeFunctionData({
        abi: SafeABI,
        functionName: 'enableModule',
        args: [predictedModuleAddress],
      }),
    },
  ]
}

export { DEFAULT_SALT }
