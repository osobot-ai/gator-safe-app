import { http, createConfig } from 'wagmi'
import { type Chain } from 'viem'
import { baseSepolia, base, foundry } from 'wagmi/chains'
import { safe } from 'wagmi/connectors'

// Anvil local chain (Base Sepolia fork)
export const anvilLocal: Chain = {
  ...foundry,
  id: 31337,
  name: 'Anvil (Local)',
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
}

export const wagmiConfig = createConfig({
  chains: [baseSepolia, base, anvilLocal],
  connectors: [safe()],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
    [anvilLocal.id]: http('http://127.0.0.1:8545'),
  },
})
