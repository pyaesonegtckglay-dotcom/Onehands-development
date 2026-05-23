import React from 'react'
import {
  Menu, MessageSquare, Bot, Code2, Brain, Settings, Activity, Zap, Cpu, FlaskConical
} from 'lucide-react'
import { useStore, type ActiveTab } from '../store'

const TABS: { id: ActiveTab; label: string; icon: React.FC<any>; description: string; highlight?: boolean }[] = [
  { id: 'chat',     label: 'Chat',     icon: MessageSquare, description: 'Multi-provider LLM chat with streaming' },
  { id: 'agent',    label: 'Agent',    icon: Bot,           description: 'Autonomous agent with tool calling' },
  { id: 'execute',  label: 'Execute',  icon: Code2,         description: 'Sandboxed code execution (E2B)' },
  { id: 'memory',   label: 'Memory',   icon: Brain,         description: 'Agent memory system' },
  { id: 'health',   label: 'Health',   icon: Activity,      description: 'System health & API keys' },
  { id: 'settings', label: 'Settings', icon: Settings,      description: 'Model & provider settings' },
  { id: 'dev',      label: 'Dev',      icon: Cpu,           description: 'Phase 9 — Autonomous Developer', highlight: true },
  { id: 'phase10',   label: 'Phase 10', icon: FlaskConical,   description: 'Phase 10 — Multi-Agent Orchestration', highlight: true },
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

      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
          <Zap size={14} className="text-white" />
        </div>
        <span className="font-bold text-white hidden sm:block">Onehands AI</span>
        <span className="text-xs text-dark-400 hidden md:block">v10.0</span>
      </div>

      {/* Navigation tabs */}
      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
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
                transition-all duration-150 whitespace-nowrap relative
                ${isActive
                  ? tab.highlight
                    ? 'bg-gradient-to-r from-primary-600 to-purple-600 text-white'
                    : 'bg-brand-600 text-white'
                  : tab.highlight
                    ? 'text-purple-400 hover:text-white hover:bg-purple-900/50'
                    : 'text-dark-400 hover:text-white hover:bg-dark-800'
                }
              `}
            >
              <Icon size={14} />
              <span className="hidden sm:block">{tab.label}</span>
              {tab.highlight && !isActive && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
              )}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
