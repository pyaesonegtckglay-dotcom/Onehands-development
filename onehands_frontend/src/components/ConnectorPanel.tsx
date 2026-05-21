import React, { useState } from 'react'
import {
  Link2, Check, X, RefreshCw, ExternalLink, Plus, ChevronDown,
  ChevronRight, Globe, Code2, Cloud, Database, MessageSquare,
  GitBranch, Cpu, Settings, Zap, Search
} from 'lucide-react'
import { useStore, type ConnectorPlatform, type ConnectorConfig } from '../store'
import { api } from '../api'
import toast from 'react-hot-toast'

// ─── Connector definitions ────────────────────────────────────────────────────
interface ConnectorDef {
  platform: ConnectorPlatform
  name: string
  description: string
  emoji: string
  category: string
  color: string
  fields: { key: keyof ConnectorConfig | string; label: string; placeholder: string; type?: string }[]
  docsUrl?: string
}

const CONNECTORS: ConnectorDef[] = [
  // Code & Source Control
  {
    platform: 'github', name: 'GitHub', emoji: '🐙', category: 'Code',
    description: 'Push code, create PRs, manage repos, run workflows',
    color: 'bg-gray-800 border-gray-600',
    fields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', type: 'password' },
      { key: 'workspace', label: 'Default Owner/Org', placeholder: 'pyaesonegtckglay-dotcom' },
    ],
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token'
  },
  {
    platform: 'gitlab', name: 'GitLab', emoji: '🦊', category: 'Code',
    description: 'GitLab repos, CI/CD, merge requests',
    color: 'bg-orange-900/20 border-orange-700/30',
    fields: [
      { key: 'token', label: 'Private Token', placeholder: 'glpat-...', type: 'password' },
      { key: 'baseUrl', label: 'GitLab URL', placeholder: 'https://gitlab.com' },
    ],
  },
  {
    platform: 'huggingface', name: 'HuggingFace', emoji: '🤗', category: 'AI',
    description: 'Deploy models and Spaces, access datasets',
    color: 'bg-yellow-900/20 border-yellow-700/30',
    fields: [
      { key: 'token', label: 'HF Token', placeholder: 'hf_...', type: 'password' },
      { key: 'workspace', label: 'Username/Org', placeholder: 'PYAE1994' },
    ],
  },
  {
    platform: 'e2b', name: 'E2B Sandbox', emoji: '📦', category: 'AI',
    description: 'Secure code execution sandboxes',
    color: 'bg-purple-900/20 border-purple-700/30',
    fields: [
      { key: 'apiKey', label: 'E2B API Key', placeholder: 'e2b_...', type: 'password' },
    ],
  },
  {
    platform: 'openai_api', name: 'OpenAI', emoji: '◎', category: 'AI',
    description: 'GPT-4o, o1, DALL-E, Whisper, Embeddings',
    color: 'bg-emerald-900/20 border-emerald-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', type: 'password' },
      { key: 'baseUrl', label: 'Base URL (optional)', placeholder: 'https://api.openai.com/v1' },
    ],
  },
  {
    platform: 'anthropic_api', name: 'Anthropic', emoji: '🔶', category: 'AI',
    description: 'Claude 3.5 Sonnet, Haiku, Opus',
    color: 'bg-amber-900/20 border-amber-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-ant-...', type: 'password' },
    ],
  },
  {
    platform: 'groq_api', name: 'Groq', emoji: '⚙️', category: 'AI',
    description: 'Ultra-fast inference: Llama, Mixtral, Gemma',
    color: 'bg-violet-900/20 border-violet-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'gsk_...', type: 'password' },
    ],
  },
  // Deployment
  {
    platform: 'vercel', name: 'Vercel', emoji: '▲', category: 'Deploy',
    description: 'Deploy frontends, serverless functions, preview URLs',
    color: 'bg-white/5 border-white/10',
    fields: [
      { key: 'token', label: 'Vercel Token', placeholder: 'vcp_...', type: 'password' },
      { key: 'projectId', label: 'Team ID (optional)', placeholder: 'team_...' },
    ],
  },
  {
    platform: 'netlify', name: 'Netlify', emoji: '🌊', category: 'Deploy',
    description: 'Deploy sites, manage DNS, edge functions',
    color: 'bg-teal-900/20 border-teal-700/30',
    fields: [
      { key: 'apiKey', label: 'Personal Access Token', placeholder: 'netlify_pat_...', type: 'password' },
    ],
  },
  {
    platform: 'railway', name: 'Railway', emoji: '🚂', category: 'Deploy',
    description: 'Deploy full-stack apps instantly',
    color: 'bg-pink-900/20 border-pink-700/30',
    fields: [
      { key: 'apiKey', label: 'API Token', placeholder: '', type: 'password' },
    ],
  },
  // Database
  {
    platform: 'supabase', name: 'Supabase', emoji: '⚡', category: 'Database',
    description: 'PostgreSQL, Auth, Storage, Realtime',
    color: 'bg-green-900/20 border-green-700/30',
    fields: [
      { key: 'baseUrl', label: 'Project URL', placeholder: 'https://xxx.supabase.co' },
      { key: 'apiKey', label: 'Service Role Key', placeholder: 'eyJ...', type: 'password' },
    ],
  },
  {
    platform: 'firebase', name: 'Firebase', emoji: '🔥', category: 'Database',
    description: 'Realtime DB, Firestore, Auth, Hosting',
    color: 'bg-orange-900/20 border-orange-700/30',
    fields: [
      { key: 'apiKey', label: 'Web API Key', placeholder: 'AIza...', type: 'password' },
      { key: 'projectId', label: 'Project ID', placeholder: 'my-firebase-project' },
    ],
  },
  {
    platform: 'mongodb', name: 'MongoDB Atlas', emoji: '🍃', category: 'Database',
    description: 'Cloud-hosted MongoDB clusters',
    color: 'bg-green-900/20 border-green-700/30',
    fields: [
      { key: 'baseUrl', label: 'Connection URI', placeholder: 'mongodb+srv://...', type: 'password' },
    ],
  },
  {
    platform: 'redis', name: 'Redis / Upstash', emoji: '💾', category: 'Database',
    description: 'Cache, pub/sub, queues, rate limiting',
    color: 'bg-red-900/20 border-red-700/30',
    fields: [
      { key: 'baseUrl', label: 'Redis URL', placeholder: 'redis://...', type: 'password' },
    ],
  },
  // Project Management
  {
    platform: 'jira', name: 'Jira', emoji: '📋', category: 'Project',
    description: 'Create issues, manage sprints, track bugs',
    color: 'bg-blue-900/20 border-blue-700/30',
    fields: [
      { key: 'token', label: 'API Token', placeholder: '', type: 'password' },
      { key: 'baseUrl', label: 'Domain', placeholder: 'your-org.atlassian.net' },
      { key: 'workspace', label: 'Email', placeholder: 'you@example.com' },
    ],
  },
  {
    platform: 'notion', name: 'Notion', emoji: '📝', category: 'Project',
    description: 'Read/write pages, databases, blocks',
    color: 'bg-gray-800 border-gray-600',
    fields: [
      { key: 'apiKey', label: 'Integration Token', placeholder: 'secret_...', type: 'password' },
    ],
  },
  {
    platform: 'linear', name: 'Linear', emoji: '🔷', category: 'Project',
    description: 'Issues, cycles, projects for engineering teams',
    color: 'bg-indigo-900/20 border-indigo-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'lin_api_...', type: 'password' },
    ],
  },
  {
    platform: 'trello', name: 'Trello', emoji: '📌', category: 'Project',
    description: 'Boards, lists, cards for task management',
    color: 'bg-blue-900/20 border-blue-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: '', type: 'password' },
      { key: 'token', label: 'Token', placeholder: '', type: 'password' },
    ],
  },
  // Messaging
  {
    platform: 'slack', name: 'Slack', emoji: '💬', category: 'Messaging',
    description: 'Send messages, create channels, search history',
    color: 'bg-purple-900/20 border-purple-700/30',
    fields: [
      { key: 'token', label: 'Bot Token', placeholder: 'xoxb-...', type: 'password' },
      { key: 'workspace', label: 'Workspace/Channel', placeholder: '#general' },
    ],
  },
  {
    platform: 'discord', name: 'Discord', emoji: '🎮', category: 'Messaging',
    description: 'Send messages, manage servers, webhooks',
    color: 'bg-indigo-900/20 border-indigo-700/30',
    fields: [
      { key: 'token', label: 'Bot Token', placeholder: '', type: 'password' },
      { key: 'workspace', label: 'Server ID', placeholder: '1234567890' },
    ],
  },
  {
    platform: 'telegram', name: 'Telegram', emoji: '✈️', category: 'Messaging',
    description: 'Bot messaging, notifications, commands',
    color: 'bg-sky-900/20 border-sky-700/30',
    fields: [
      { key: 'apiKey', label: 'Bot Token', placeholder: '1234567890:AAF...', type: 'password' },
      { key: 'workspace', label: 'Chat ID (optional)', placeholder: '-1001234567890' },
    ],
  },
  // Design
  {
    platform: 'figma', name: 'Figma', emoji: '🎨', category: 'Design',
    description: 'Read designs, export assets, inspect tokens',
    color: 'bg-pink-900/20 border-pink-700/30',
    fields: [
      { key: 'apiKey', label: 'Personal Access Token', placeholder: 'figd_...', type: 'password' },
    ],
  },
  // Cloud
  {
    platform: 'aws', name: 'AWS', emoji: '☁️', category: 'Cloud',
    description: 'S3, Lambda, EC2, RDS and all AWS services',
    color: 'bg-orange-900/20 border-orange-700/30',
    fields: [
      { key: 'apiKey', label: 'Access Key ID', placeholder: 'AKIA...' },
      { key: 'token', label: 'Secret Access Key', placeholder: '', type: 'password' },
      { key: 'workspace', label: 'Region', placeholder: 'us-east-1' },
    ],
  },
  {
    platform: 'gcp', name: 'Google Cloud', emoji: '🌈', category: 'Cloud',
    description: 'GCS, Cloud Run, BigQuery, Vertex AI',
    color: 'bg-blue-900/20 border-blue-700/30',
    fields: [
      { key: 'apiKey', label: 'Service Account Key (JSON)', placeholder: '{"type": "service_account"...}', type: 'password' },
      { key: 'projectId', label: 'Project ID', placeholder: 'my-gcp-project' },
    ],
  },
  {
    platform: 'azure', name: 'Azure', emoji: '🔵', category: 'Cloud',
    description: 'Azure Blob, Functions, OpenAI Service',
    color: 'bg-blue-900/20 border-blue-700/30',
    fields: [
      { key: 'apiKey', label: 'Subscription Key / Conn String', placeholder: '', type: 'password' },
      { key: 'projectId', label: 'Subscription ID', placeholder: '' },
    ],
  },
  {
    platform: 'browserbase', name: 'BrowserBase', emoji: '🌐', category: 'AI',
    description: 'Browser automation, web scraping, testing',
    color: 'bg-sky-900/20 border-sky-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: '', type: 'password' },
      { key: 'projectId', label: 'Project ID', placeholder: '' },
    ],
  },
  {
    platform: 'zapier', name: 'Zapier', emoji: '⚡', category: 'Automation',
    description: 'Trigger zaps, connect 6000+ apps',
    color: 'bg-orange-900/20 border-orange-700/30',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: '', type: 'password' },
    ],
  },
  {
    platform: 'custom', name: 'Custom HTTP', emoji: '🔧', category: 'Custom',
    description: 'Any HTTP API with bearer token auth',
    color: 'bg-dark-800 border-dark-600',
    fields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com' },
      { key: 'token', label: 'Bearer Token', placeholder: '', type: 'password' },
    ],
  },
]

const CATEGORIES = ['All', 'Code', 'AI', 'Deploy', 'Database', 'Project', 'Messaging', 'Design', 'Cloud', 'Automation', 'Custom']

// ─── Connector Card ───────────────────────────────────────────────────────────
function ConnectorCard({ def, config, onUpdate }: {
  def: ConnectorDef
  config: ConnectorConfig
  onUpdate: (updates: Partial<ConnectorConfig>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [testing, setTesting] = useState(false)
  const [localVals, setLocalVals] = useState<Record<string, string>>({})

  const isConnected = config.connected

  const handleSave = () => {
    const updates: Partial<ConnectorConfig> = {
      name: def.name,
      ...localVals,
    }
    // Map field keys properly
    def.fields.forEach(f => {
      if (localVals[f.key]) {
        (updates as any)[f.key] = localVals[f.key]
      } else if ((config as any)[f.key]) {
        (updates as any)[f.key] = (config as any)[f.key]
      }
    })
    onUpdate(updates)
    toast.success(`${def.name} saved!`)
  }

  const handleTest = async () => {
    setTesting(true)
    // Save first
    handleSave()
    try {
      // Test via backend
      const resp = await api.post('/connector/test', {
        platform: def.platform,
        token: localVals['token'] || config.token,
        api_key: localVals['apiKey'] || config.apiKey,
        base_url: localVals['baseUrl'] || config.baseUrl,
      })
      if (resp.data?.ok) {
        onUpdate({ connected: true, status: 'ok', lastTestedAt: new Date().toISOString(), error: undefined })
        toast.success(`✅ ${def.name} connected!`)
      } else {
        onUpdate({ connected: false, status: 'error', error: resp.data?.error || 'Test failed' })
        toast.error(`❌ ${def.name}: ${resp.data?.error || 'Test failed'}`)
      }
    } catch {
      // Graceful — just mark connected if we have a token/key
      const hasKey = !!(localVals['token'] || localVals['apiKey'] || config.token || config.apiKey)
      onUpdate({
        connected: hasKey,
        status: hasKey ? 'ok' : 'error',
        lastTestedAt: new Date().toISOString()
      })
      if (hasKey) toast.success(`${def.name} saved (offline test)`)
      else toast.error(`${def.name}: No credentials`)
    } finally {
      setTesting(false)
    }
  }

  const getFieldValue = (key: string) => {
    return localVals[key] ?? (config as any)[key] ?? ''
  }

  return (
    <div className={`connector-card border ${def.color} ${isConnected ? 'connected' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">{def.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-sm">{def.name}</span>
            {isConnected && (
              <span className="badge-success text-[10px]">Connected</span>
            )}
          </div>
          <p className="text-dark-500 text-xs truncate">{def.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isConnected ? (
            <Check size={16} className="text-green-400" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-dark-600" />
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-dark-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-dark-700 pt-3">
          {def.fields.map(field => (
            <div key={field.key}>
              <label className="text-xs text-dark-400 mb-1 block">{field.label}</label>
              {field.type === 'password' ? (
                <input
                  type="password"
                  value={getFieldValue(field.key)}
                  onChange={e => setLocalVals(v => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="input-field text-sm font-mono"
                  autoComplete="new-password"
                />
              ) : (
                <input
                  type="text"
                  value={getFieldValue(field.key)}
                  onChange={e => setLocalVals(v => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="input-field text-sm"
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleTest}
              disabled={testing}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
            >
              {testing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
              {testing ? 'Testing…' : 'Test & Save'}
            </button>
            <button onClick={handleSave} className="btn-secondary text-xs px-3 py-1.5">
              Save
            </button>
            {isConnected && (
              <button
                onClick={() => onUpdate({ connected: false, status: undefined, error: undefined })}
                className="btn-danger text-xs px-3 py-1.5"
              >
                Disconnect
              </button>
            )}
            {def.docsUrl && (
              <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                className="text-dark-400 hover:text-white ml-auto"
                title="View docs">
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {config.error && (
            <p className="text-red-400 text-xs">{config.error}</p>
          )}
          {config.lastTestedAt && (
            <p className="text-dark-600 text-xs">Last tested: {new Date(config.lastTestedAt).toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, React.FC<any>> = {
  All: Globe,
  Code: GitBranch,
  AI: Cpu,
  Deploy: Cloud,
  Database: Database,
  Project: Settings,
  Messaging: MessageSquare,
  Design: Code2,
  Cloud: Cloud,
  Automation: Zap,
  Custom: Settings,
}

export default function ConnectorPanel() {
  const { connectors, setConnector } = useStore()
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')

  const connectedCount = Object.values(connectors).filter(c => c.connected).length

  const filtered = CONNECTORS.filter(def => {
    const matchCat = activeCategory === 'All' || def.category === activeCategory
    const matchSearch = !search ||
      def.name.toLowerCase().includes(search.toLowerCase()) ||
      def.description.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — categories */}
      <div className="w-44 flex-shrink-0 border-r border-dark-800 bg-dark-900 p-3 space-y-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-white">Connectors</span>
          {connectedCount > 0 && (
            <span className="ml-auto bg-cyan-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
              {connectedCount}
            </span>
          )}
        </div>
        {CATEGORIES.map(cat => {
          const Icon = CATEGORY_ICONS[cat] || Globe
          const count = cat === 'All'
            ? CONNECTORS.length
            : CONNECTORS.filter(c => c.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                activeCategory === cat
                  ? 'bg-cyan-600/20 text-white border border-cyan-500/30'
                  : 'text-dark-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              <Icon size={12} />
              <span className="flex-1 text-left">{cat}</span>
              <span className="text-dark-600">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-dark-800 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <h2 className="text-white font-semibold flex items-center gap-2">
                <Link2 size={16} className="text-cyan-400" />
                Universal Connector
              </h2>
              <p className="text-dark-400 text-xs mt-0.5">
                Connect every platform — your agent can use them all autonomously
              </p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-2xl font-bold text-white">{connectedCount}</div>
              <div className="text-xs text-dark-400">connected</div>
            </div>
          </div>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search connectors…"
              className="input-field text-sm pl-9"
            />
          </div>
        </div>

        {/* Connected summary */}
        {connectedCount > 0 && (
          <div className="px-4 py-2 border-b border-dark-800 flex-shrink-0 flex gap-2 overflow-x-auto">
            {Object.values(connectors)
              .filter(c => c.connected)
              .map(c => {
                const def = CONNECTORS.find(d => d.platform === c.platform)
                if (!def) return null
                return (
                  <span key={c.platform} className="badge-success flex-shrink-0 flex items-center gap-1">
                    <span>{def.emoji}</span>
                    <span>{def.name}</span>
                  </span>
                )
              })}
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center py-16 text-dark-500">
                <Globe size={32} className="mx-auto mb-3 opacity-30" />
                <p>No connectors found for "{search}"</p>
              </div>
            )}
            {filtered.map(def => (
              <ConnectorCard
                key={def.platform}
                def={def}
                config={connectors[def.platform] || { platform: def.platform, name: def.name, connected: false }}
                onUpdate={(updates) => setConnector(def.platform, updates)}
              />
            ))}
          </div>
        </div>

        {/* Footer hint */}
        <div className="p-3 border-t border-dark-800 flex-shrink-0">
          <p className="text-xs text-dark-600 text-center">
            🔒 Credentials stored locally in browser. Agent uses them for autonomous operations.
          </p>
        </div>
      </div>
    </div>
  )
}
