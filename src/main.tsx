import React from 'react'
import ReactDOM from 'react-dom/client'
import SafeProvider from '@safe-global/safe-apps-react-sdk'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './config/chains'
import App from './App'
import StandaloneRedeem from './pages/StandaloneRedeem'
import './index.css'

const queryClient = new QueryClient()

// Check if we're on the standalone /redeem route
const isStandalone = window.location.pathname === '/redeem'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {isStandalone ? (
          <StandaloneRedeem />
        ) : (
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
        )}
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
