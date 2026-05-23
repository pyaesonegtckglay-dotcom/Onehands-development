import React, { useEffect, Component } from 'react'
import { Toaster } from 'react-hot-toast'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import AgentPanel from './components/AgentPanel'
import ExecutePanel from './components/ExecutePanel'
import MemoryPanel from './components/MemoryPanel'
import SettingsPanel from './components/SettingsPanel'
import HealthPanel from './components/HealthPanel'
import Header from './components/Header'
import DevPanel from './components/DevPanel'
import Phase10Panel from './components/Phase10Panel'
import { conversationsApi } from './api'

// ─── Error Boundary ───────────────────────────────────────────────────────────
interface EBState { hasError: boolean; error?: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(err: Error): EBState {
    return { hasError: true, error: err.message }
  }
  componentDidCatch(err: Error, info: any) {
    console.error('App crash caught:', err, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen bg-dark-950 items-center justify-center">
          <div className="card max-w-md text-center space-y-4">
            <div className="text-red-400 text-4xl">⚠️</div>
            <h2 className="text-white font-bold text-lg">Something went wrong</h2>
            <p className="text-dark-400 text-sm">{this.state.error}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false })
                window.location.reload()
              }}
              className="btn-primary"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppInner() {
  const { activeTab, sidebarOpen, userId, setConversations } = useStore()

  useEffect(() => {
    conversationsApi.list(userId)
      .then(r => setConversations(r.data || []))
      .catch(() => {}) // graceful degradation
  }, [userId])

  const renderPanel = () => {
    switch (activeTab) {
      case 'chat':    return <ChatPanel />
      case 'agent':   return <AgentPanel />
      case 'execute': return <ExecutePanel />
      case 'memory':  return <MemoryPanel />
      case 'settings': return <SettingsPanel />
      case 'health':  return <HealthPanel />
      case 'dev':     return <DevPanel />
      case 'phase10':  return <Phase10Panel />
      default:        return <ChatPanel />
    }
  }

  return (
    <div className="flex h-screen bg-dark-950 overflow-hidden">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
          },
        }}
      />

      {/* Sidebar */}
      <div className={`
        flex-shrink-0 transition-all duration-300 ease-in-out
        ${sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'}
        border-r border-dark-800
      `}>
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">
          {renderPanel()}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
