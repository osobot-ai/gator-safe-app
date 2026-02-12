import React from 'react'
import ReactDOM from 'react-dom/client'
import SafeProvider from '@safe-global/safe-apps-react-sdk'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Web3AuthProvider } from '@web3auth/modal/react'
import { WagmiProvider as Web3AuthWagmiProvider } from '@web3auth/modal/react/wagmi'
import { wagmiConfig } from './config/chains'
import web3AuthContextConfig from './web3authContext'
import App from './App'
import StandaloneRedeem from './pages/StandaloneRedeem'
import './index.css'

const queryClient = new QueryClient()

// Check if we're on the standalone /redeem route
const isStandalone = window.location.pathname === '/redeem'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isStandalone ? (
      <Web3AuthProvider config={web3AuthContextConfig}>
        <Web3AuthWagmiProvider>
          <QueryClientProvider client={queryClient}>
            <StandaloneRedeem />
          </QueryClientProvider>
        </Web3AuthWagmiProvider>
      </Web3AuthProvider>
    ) : (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <SafeProvider
            loader={
              <div className="flex items-center justify-center min-h-screen bg-[#0c0c0c]">
                <div className="text-center">
                  <div className="text-4xl mb-4">🐊</div>
                  <p className="text-gray-400 text-sm">Connecting to Safe...</p>
                </div>
              </div>
            }
          >
            <App />
          </SafeProvider>
        </QueryClientProvider>
      </WagmiProvider>
    )}
  </React.StrictMode>,
)
