import { type Address, type Hex } from 'viem'

export interface RecipeParam {
  name: string
  type: string
  value: string
  locked: boolean
  required: boolean
  description: string
}

export interface Recipe {
  id: string
  name: string
  description: string
  icon: string
  targetAddress: Address
  methodSignature: string
  methodSelector: Hex
  params: RecipeParam[]
  defaultValue: string
  defaultMaxCalls?: number
  defaultExpirationSeconds?: number // Auto-set TimestampEnforcer relative to creation time (e.g., 604800 = 1 week)
}

export const recipes: Recipe[] = [
  {
    id: 'flaunch-claim-fees',
    name: 'Flaunch Claim Fees',
    description: 'Claim accumulated trading fees from Flaunch revenue stream. Fees are unwrapped to ETH and sent to the specified recipient.',
    icon: '\uD83D\uDCB0',
    targetAddress: '0x72e6f7948b1B1A343B477F39aAbd2E35E6D27dde' as Address,
    methodSignature: 'withdrawFees(address,bool)',
    methodSelector: '0x4c2d94c0' as Hex,
    params: [
      {
        name: 'recipient',
        type: 'address',
        value: '',
        locked: false,
        required: true,
        description: 'Address to receive the claimed ETH fees',
      },
      {
        name: 'unwrap',
        type: 'bool',
        value: 'true',
        locked: true,
        required: true,
        description: 'Unwrap flETH to native ETH',
      },
    ],
    defaultValue: '0',
  },
]
