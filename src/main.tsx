import React from 'react'
import ReactDOM from 'react-dom/client'
import SafeProvider from '@safe-global/safe-apps-react-sdk'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
