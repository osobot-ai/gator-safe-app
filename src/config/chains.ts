import { http, createConfig } from 'wagmi'
import { baseSepolia, base } from 'wagmi/chains'
import { safe } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [baseSepolia, base],
  connectors: [safe()],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
})
