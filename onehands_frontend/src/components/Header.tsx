import React from 'react'
import { Menu, Bot, MessageSquare, Brain, Terminal, Activity, Settings, Code2 } from 'lucide-react'
import { useStore, Tab } from '../store'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'chat',     label: 'Chat',    icon: MessageSquare },
  { id: 'agent',    label: 'Agent',   icon: Bot },
  { id: 'dev',      label: 'Dev',     icon: Code2 },
  { id: 'execute',  label: 'Execute', icon: Terminal },
  { id: 'memory',   label: 'Memory',  icon: Brain },
  { id: 'health',   label: 'Health',  icon: Activity },
  { id: 'settings', label: 'Settings',icon: Settings },
]

export default function Header() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useStore()

  return (
    <header className="flex items-center gap-1 px-3 py-2 border-b border-dark-800 bg-dark-900 overflow-x-auto flex-shrink-0">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-800 transition-colors flex-shrink-0"
      >
        <Menu size={16} />
      </button>

      <div className="flex items-center gap-1 mx-1 flex-shrink-0">
        <Bot size={16} className="text-primary-400" />
        <span className="text-white text-sm font-semibold hidden sm:inline">Onehands</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === id
                ? 'bg-primary-600 text-white'
                : 'text-dark-400 hover:text-white hover:bg-dark-800'
            }`}
          >
            <Icon size={12} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </nav>
    </header>
  )
}
