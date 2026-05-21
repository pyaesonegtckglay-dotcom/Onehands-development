import React from 'react'
import {
  Menu, MessageSquare, Bot, Code2, Brain, Settings, Activity,
  Zap, Cpu, Link2
} from 'lucide-react'
import { useStore, type ActiveTab } from '../store'

const TABS: {
  id: ActiveTab
  label: string
  icon: React.FC<any>
  description: string
  highlight?: boolean
  color?: string
}[] = [
  { id: 'chat',      label: 'Chat',      icon: MessageSquare, description: 'Multi-provider LLM chat with streaming' },
  { id: 'agent',     label: 'Agent',     icon: Bot,           description: 'Autonomous agent with tool calling' },
  { id: 'execute',   label: 'Execute',   icon: Code2,         description: 'Sandboxed code execution (E2B)' },
  { id: 'memory',    label: 'Memory',    icon: Brain,         description: 'Agent memory system' },
  { id: 'health',    label: 'Health',    icon: Activity,      description: 'System health & API keys' },
  { id: 'settings',  label: 'Settings',  icon: Settings,      description: 'Model, provider & system settings' },
  { id: 'dev',       label: 'Dev',       icon: Cpu,           description: 'Phase 9 — Autonomous Developer', highlight: true, color: 'purple' },
  { id: 'connector', label: 'Connector', icon: Link2,         description: 'Universal Platform Connector', highlight: true, color: 'cyan' },
]

export default function Header() {
  const { activeTab, setActiveTab, setSidebarOpen, sidebarOpen, connectors } = useStore()

  const connectedCount = Object.values(connectors).filter(c => c.connected).length

  return (
    <header className="flex-shrink-0 bg-dark-900 border-b border-dark-800 px-3 py-2">
      <div className="flex items-center gap-3">
        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded-lg hover:bg-dark-800 transition-colors text-dark-400 hover:text-white flex-shrink-0"
          title="Toggle sidebar"
        >
          <Menu size={18} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-7 h-7 bg-gradient-to-br from-brand-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-bold text-white hidden sm:block text-sm">Onehands AI</span>
          <span className="text-xs text-dark-500 hidden md:block">v10.0</span>
        </div>

        {/* Navigation tabs — scrollable */}
        <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            const colorMap: Record<string, string> = {
              purple: isActive
                ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white'
                : 'text-purple-400 hover:text-white hover:bg-purple-900/40',
              cyan: isActive
                ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white'
                : 'text-cyan-400 hover:text-white hover:bg-cyan-900/40',
            }
            const cls = tab.color
              ? colorMap[tab.color]
              : isActive
                ? 'bg-brand-600 text-white'
                : 'text-dark-400 hover:text-white hover:bg-dark-800'

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.description}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                  transition-all duration-150 whitespace-nowrap relative flex-shrink-0
                  ${cls}
                `}
              >
                <Icon size={13} />
                <span className="hidden sm:block">{tab.label}</span>
                {/* Badge for connector count */}
                {tab.id === 'connector' && connectedCount > 0 && !isActive && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                    {connectedCount}
                  </span>
                )}
                {tab.highlight && !isActive && tab.id !== 'connector' && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                )}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
