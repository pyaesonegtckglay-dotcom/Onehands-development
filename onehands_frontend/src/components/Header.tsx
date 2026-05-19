import React from 'react'
import {
  Menu, MessageSquare, Bot, Code2, Brain, Settings, Activity, Zap
} from 'lucide-react'
import { useStore, type ActiveTab } from '../store'

const TABS: { id: ActiveTab; label: string; icon: React.FC<any>; description: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: MessageSquare, description: 'Multi-provider LLM chat with streaming' },
  { id: 'agent',    label: 'Agent',    icon: Bot,           description: 'Autonomous agent with tool calling' },
  { id: 'execute',  label: 'Execute',  icon: Code2,         description: 'Sandboxed code execution (E2B)' },
  { id: 'memory',   label: 'Memory',   icon: Brain,         description: 'Agent memory system' },
  { id: 'health',   label: 'Health',   icon: Activity,      description: 'System health & API keys' },
  { id: 'settings', label: 'Settings', icon: Settings,      description: 'Model & provider settings' },
]

export default function Header() {
  const { activeTab, setActiveTab, setSidebarOpen, sidebarOpen } = useStore()

  return (
    <header className="flex-shrink-0 bg-dark-900 border-b border-dark-800 px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded-lg hover:bg-dark-800 transition-colors text-dark-400 hover:text-white"
          title="Toggle sidebar"
        >
          <Menu size={18} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-bold text-white hidden sm:block">Onehands AI</span>
          <span className="text-xs text-dark-400 hidden md:block">v3.0</span>
        </div>

        {/* Navigation tabs */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.description}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                  transition-all duration-150 whitespace-nowrap
                  ${isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-dark-400 hover:text-white hover:bg-dark-800'
                  }
                `}
              >
                <Icon size={14} />
                <span className="hidden sm:block">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
