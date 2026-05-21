import React, { useEffect } from 'react'
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

export default function App() {
  const { activeTab, sidebarOpen, userId, setConversations } = useStore()

  // Load conversations on mount
  useEffect(() => {
    conversationsApi.list(userId)
      .then(r => setConversations(r.data))
      .catch(() => {}) // Graceful degradation
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
