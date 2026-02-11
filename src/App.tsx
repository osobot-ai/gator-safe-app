import { useState } from 'react'
import { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk'
import Home from './pages/Home'
import CreateDelegation from './pages/CreateDelegation'
import Delegations from './pages/Delegations'
import ImportDelegation from './pages/ImportDelegation'
import RedeemDelegation from './pages/RedeemDelegation'

type Page = 'home' | 'create' | 'delegations' | 'import' | 'redeem'

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  )
}

function AppInner() {
  const { safe } = useSafeAppsSDK()
  const [page, setPage] = useState<Page>('home')

  return (
    <div className="min-h-screen bg-[#0c0c0c]">
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2">
        <p className="max-w-4xl mx-auto text-xs text-amber-400/80 text-center">
          ⚠️ This app was built by an AI agent. It is experimental and unaudited. Use at your own risk.
        </p>
      </div>

      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🐊</span>
            <div>
              <h1 className="text-lg font-semibold text-white">Gator Delegations</h1>
              <p className="text-xs text-gray-500 font-mono">
                {safe.safeAddress.slice(0, 6)}...{safe.safeAddress.slice(-4)} · Chain {safe.chainId}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b border-white/5 px-6 py-3">
        <div className="max-w-4xl mx-auto flex gap-2">
          <NavButton active={page === 'home'} onClick={() => setPage('home')}>
            Home
          </NavButton>
          <NavButton active={page === 'create'} onClick={() => setPage('create')}>
            Create
          </NavButton>
          <NavButton active={page === 'delegations'} onClick={() => setPage('delegations')}>
            Delegations
          </NavButton>
          <NavButton active={page === 'import'} onClick={() => setPage('import')}>
            Import
          </NavButton>
          <NavButton active={page === 'redeem'} onClick={() => setPage('redeem')}>
            Redeem
          </NavButton>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {page === 'home' && <Home onNavigate={setPage} />}
        {page === 'create' && <CreateDelegation />}
        {page === 'delegations' && <Delegations />}
        {page === 'import' && <ImportDelegation />}
        {page === 'redeem' && <RedeemDelegation />}
      </main>
    </div>
  )
}

export default function App() {
  return <AppInner />
}
