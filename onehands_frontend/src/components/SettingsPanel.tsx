import React, { useState } from 'react'
import {
  Settings, Thermometer, Hash, Brain, Server, User, Key,
  Bot, Palette, Info, ChevronRight, Eye, EyeOff, Plus, Trash2,
  CheckCircle, AlertCircle, Zap
} from 'lucide-react'
import { useStore, type Provider, type SettingsTab } from '../store'
import { BACKEND_URL } from '../api'
import toast from 'react-hot-toast'

const PROVIDERS: { id: Provider; name: string; color: string; emoji: string }[] = [
  { id: 'gemini',      name: 'Google Gemini',     color: 'text-blue-400',   emoji: '✦' },
  { id: 'sambanova',   name: 'SambaNova AI',      color: 'text-orange-400', emoji: '⚡' },
  { id: 'github_llm',  name: 'GitHub Models',     color: 'text-green-400',  emoji: '🐙' },
  { id: 'openai',      name: 'OpenAI',            color: 'text-emerald-400', emoji: '◎' },
  { id: 'anthropic',   name: 'Anthropic Claude',  color: 'text-amber-400',  emoji: '🔶' },
  { id: 'groq',        name: 'Groq',              color: 'text-violet-400', emoji: '⚙' },
  { id: 'openrouter',  name: 'OpenRouter',        color: 'text-pink-400',   emoji: '🌐' },
]

const MODELS_BY_PROVIDER: Record<Provider, { id: string; name: string }[]> = {
  gemini: [
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash (Latest)' },
    { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-thinking-exp',  name: 'Gemini 2.0 Flash Thinking' },
    { id: 'gemini-1.5-pro',                 name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash',               name: 'Gemini 1.5 Flash' },
  ],
  sambanova: [
    { id: 'Meta-Llama-3.3-70B-Instruct',  name: 'Llama 3.3 70B' },
    { id: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B' },
    { id: 'DeepSeek-R1',                  name: 'DeepSeek R1' },
    { id: 'Qwen2.5-72B-Instruct',         name: 'Qwen 2.5 72B' },
    { id: 'Qwen3-32B',                    name: 'Qwen 3 32B' },
  ],
  github_llm: [
    { id: 'gpt-4o',                        name: 'GPT-4o' },
    { id: 'gpt-4o-mini',                   name: 'GPT-4o Mini' },
    { id: 'Meta-Llama-3.1-70B-Instruct',   name: 'Llama 3.1 70B' },
    { id: 'Mistral-large-2407',            name: 'Mistral Large' },
    { id: 'DeepSeek-R1',                   name: 'DeepSeek R1' },
  ],
  openai: [
    { id: 'gpt-4o',              name: 'GPT-4o' },
    { id: 'gpt-4o-mini',         name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo',         name: 'GPT-4 Turbo' },
    { id: 'o1-mini',             name: 'o1-mini' },
    { id: 'o3-mini',             name: 'o3-mini' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229',     name: 'Claude 3 Opus' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant',    name: 'Llama 3.1 8B' },
    { id: 'mixtral-8x7b-32768',      name: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',            name: 'Gemma 2 9B' },
  ],
  openrouter: [
    { id: 'anthropic/claude-3-5-sonnet',  name: 'Claude 3.5 Sonnet (OR)' },
    { id: 'openai/gpt-4o',               name: 'GPT-4o (OR)' },
    { id: 'google/gemini-2.0-flash-001',  name: 'Gemini 2.0 Flash (OR)' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (OR)' },
    { id: 'deepseek/deepseek-r1',         name: 'DeepSeek R1 (OR)' },
  ],
}

const SETTING_TABS: { id: SettingsTab; label: string; icon: React.FC<any> }[] = [
  { id: 'llm',      label: 'LLM',        icon: Server },
  { id: 'api_keys', label: 'API Keys',   icon: Key },
  { id: 'agent',    label: 'Agent',      icon: Bot },
  { id: 'ui',       label: 'UI',         icon: Palette },
  { id: 'system',   label: 'System',     icon: Settings },
  { id: 'about',    label: 'About',      icon: Info },
]

// ─── Masked input helper ──────────────────────────────────────────────────────
function SecretInput({
  value, onChange, placeholder
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Enter key…'}
        className="input-field text-sm pr-10 font-mono"
      />
      <button
        onClick={() => setShow(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

// ─── Multi-key editor ─────────────────────────────────────────────────────────
function MultiKeyEditor({
  keys, onChange, label
}: { keys: string[]; onChange: (keys: string[]) => void; label: string }) {
  const addKey = () => onChange([...keys, ''])
  const removeKey = (i: number) => onChange(keys.filter((_, idx) => idx !== i))
  const updateKey = (i: number, v: string) => {
    const next = [...keys]
    next[i] = v
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-dark-400">{label}</label>
        <button onClick={addKey} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
          <Plus size={12} /> Add Key
        </button>
      </div>
      {keys.length === 0 && (
        <p className="text-xs text-dark-600 italic">No keys added. Click "Add Key" to add one.</p>
      )}
      {keys.map((k, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex-1">
            <SecretInput value={k} onChange={(v) => updateKey(i, v)} placeholder={`Key ${i + 1}`} />
          </div>
          <button onClick={() => removeKey(i)} className="text-dark-500 hover:text-red-400 flex-shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SettingsPanel() {
  const {
    selectedModel, selectedProvider, temperature, maxTokens, systemPrompt,
    userId, settingsTab, apiKeys,
    agentMaxSteps, agentAutoExecute, agentMemoryEnabled,
    setSelectedModel, setSelectedProvider, setTemperature, setMaxTokens, setSystemPrompt,
    setUserId, setSettingsTab, updateApiKeys,
    setAgentMaxSteps, setAgentAutoExecute, setAgentMemoryEnabled,
  } = useStore()

  const handleProviderChange = (provider: Provider) => {
    setSelectedProvider(provider)
    const models = MODELS_BY_PROVIDER[provider] || []
    if (models.length > 0 && !models.find(m => m.id === selectedModel)) {
      setSelectedModel(models[0].id)
    }
  }

  const availableModels = MODELS_BY_PROVIDER[selectedProvider] || []

  const handleSaveApiKeys = () => {
    toast.success('API keys saved locally!')
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <div className="w-40 flex-shrink-0 border-r border-dark-800 bg-dark-900 p-3 space-y-1">
        <p className="text-xs text-dark-600 uppercase tracking-wider px-2 mb-2">Settings</p>
        {SETTING_TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setSettingsTab(t.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                settingsTab === t.id
                  ? 'bg-brand-600/20 text-white border border-brand-500/30'
                  : 'text-dark-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* ── LLM Tab ── */}
        {settingsTab === 'llm' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Server size={16} className="text-blue-400" /> LLM Configuration
            </h2>

            {/* Provider */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Provider</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className={`p-3 rounded-lg border text-sm font-medium transition-all text-left ${
                      selectedProvider === p.id
                        ? 'border-brand-500 bg-brand-600/20 text-white'
                        : 'border-dark-700 bg-dark-800/50 text-dark-400 hover:border-dark-600 hover:text-white'
                    }`}
                  >
                    <span className="text-lg mr-1">{p.emoji}</span>
                    <span className={p.color}>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Model</h3>
              <div className="grid grid-cols-2 gap-2">
                {availableModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    className={`p-2.5 rounded-lg border text-left text-sm transition-all ${
                      selectedModel === m.id
                        ? 'border-brand-500 bg-brand-600/20 text-white'
                        : 'border-dark-700 bg-dark-800/50 text-dark-400 hover:border-dark-600 hover:text-white'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Params */}
            <div className="card space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Thermometer size={14} className="text-orange-400" /> Generation Parameters
              </h3>
              <div>
                <label className="text-xs text-dark-400 mb-2 flex justify-between">
                  <span>Temperature</span>
                  <span className="text-white font-mono">{temperature.toFixed(1)}</span>
                </label>
                <input type="range" min={0} max={2} step={0.1} value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))}
                  className="w-full accent-brand-500" />
                <div className="flex justify-between text-xs text-dark-600 mt-1">
                  <span>Precise (0)</span><span>Balanced (1)</span><span>Creative (2)</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-dark-400 mb-2 flex justify-between">
                  <span>Max Tokens</span>
                  <span className="text-white font-mono">{maxTokens.toLocaleString()}</span>
                </label>
                <input type="range" min={256} max={16384} step={256} value={maxTokens}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  className="w-full accent-brand-500" />
                <div className="flex justify-between text-xs text-dark-600 mt-1">
                  <span>256</span><span>8192</span><span>16384</span>
                </div>
              </div>
            </div>

            {/* System Prompt */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Brain size={14} className="text-purple-400" /> System Prompt
              </h3>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Optional system prompt to customize AI behavior. Leave empty for default autonomous developer."
                rows={5}
                className="input-field text-sm resize-none"
              />
            </div>
          </div>
        )}

        {/* ── API Keys Tab ── */}
        {settingsTab === 'api_keys' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Key size={16} className="text-yellow-400" /> API Keys
            </h2>
            <div className="badge-warning text-xs p-2 rounded-lg">
              ⚠️ Keys are stored locally in your browser. They're sent to the backend for use.
            </div>

            <div className="card space-y-4">
              <h3 className="text-xs text-dark-400 uppercase tracking-wider">LLM Provider Keys</h3>
              <MultiKeyEditor
                label="Gemini API Keys (round-robin)"
                keys={apiKeys.gemini}
                onChange={v => updateApiKeys({ gemini: v })}
              />
              <MultiKeyEditor
                label="SambaNova API Keys"
                keys={apiKeys.sambanova}
                onChange={v => updateApiKeys({ sambanova: v })}
              />
              <MultiKeyEditor
                label="GitHub Token (for GitHub Models)"
                keys={apiKeys.github_llm}
                onChange={v => updateApiKeys({ github_llm: v })}
              />
              <MultiKeyEditor
                label="OpenAI API Keys"
                keys={apiKeys.openai}
                onChange={v => updateApiKeys({ openai: v })}
              />
              <MultiKeyEditor
                label="Anthropic API Keys"
                keys={apiKeys.anthropic}
                onChange={v => updateApiKeys({ anthropic: v })}
              />
              <MultiKeyEditor
                label="Groq API Keys"
                keys={apiKeys.groq}
                onChange={v => updateApiKeys({ groq: v })}
              />
              <MultiKeyEditor
                label="OpenRouter API Keys"
                keys={apiKeys.openrouter}
                onChange={v => updateApiKeys({ openrouter: v })}
              />
            </div>

            <div className="card space-y-4">
              <h3 className="text-xs text-dark-400 uppercase tracking-wider">Developer & Platform Keys</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">E2B API Key (Code Sandbox)</label>
                  <SecretInput value={apiKeys.e2b} onChange={v => updateApiKeys({ e2b: v })} placeholder="e2b_..." />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">GitHub Personal Access Token</label>
                  <SecretInput value={apiKeys.github_token} onChange={v => updateApiKeys({ github_token: v })} placeholder="ghp_..." />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">HuggingFace Token</label>
                  <SecretInput value={apiKeys.hf_token} onChange={v => updateApiKeys({ hf_token: v })} placeholder="hf_..." />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Vercel Token</label>
                  <SecretInput value={apiKeys.vercel_token} onChange={v => updateApiKeys({ vercel_token: v })} placeholder="vcp_..." />
                </div>
              </div>
            </div>

            <div className="card space-y-4">
              <h3 className="text-xs text-dark-400 uppercase tracking-wider">Database / Cache</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Supabase URL</label>
                  <input type="text" value={apiKeys.supabase_url}
                    onChange={e => updateApiKeys({ supabase_url: e.target.value })}
                    placeholder="https://xxx.supabase.co" className="input-field text-sm" />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Supabase Anon Key</label>
                  <SecretInput value={apiKeys.supabase_key} onChange={v => updateApiKeys({ supabase_key: v })} />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">Redis URL</label>
                  <SecretInput value={apiKeys.redis_url} onChange={v => updateApiKeys({ redis_url: v })} placeholder="redis://..." />
                </div>
              </div>
            </div>

            <button onClick={handleSaveApiKeys} className="btn-primary w-full">
              Save API Keys
            </button>
          </div>
        )}

        {/* ── Agent Tab ── */}
        {settingsTab === 'agent' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Bot size={16} className="text-green-400" /> Agent Configuration
            </h2>

            <div className="card space-y-4">
              <h3 className="text-sm font-semibold text-white">Autonomous Loop</h3>
              <div>
                <label className="text-xs text-dark-400 mb-2 flex justify-between">
                  <span>Max Steps</span>
                  <span className="text-white font-mono">{agentMaxSteps}</span>
                </label>
                <input type="range" min={5} max={50} step={5} value={agentMaxSteps}
                  onChange={e => setAgentMaxSteps(Number(e.target.value))}
                  className="w-full accent-brand-500" />
                <div className="flex justify-between text-xs text-dark-600 mt-1">
                  <span>5 (quick)</span><span>25 (default)</span><span>50 (deep)</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Auto-Execute Code</p>
                  <p className="text-xs text-dark-500">Automatically run code blocks detected in agent responses</p>
                </div>
                <button
                  onClick={() => setAgentAutoExecute(!agentAutoExecute)}
                  className={`w-12 h-6 rounded-full transition-colors ${agentAutoExecute ? 'bg-green-500' : 'bg-dark-700'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${agentAutoExecute ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Memory System</p>
                  <p className="text-xs text-dark-500">Persist and recall memories across conversations</p>
                </div>
                <button
                  onClick={() => setAgentMemoryEnabled(!agentMemoryEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors ${agentMemoryEnabled ? 'bg-green-500' : 'bg-dark-700'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${agentMemoryEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Agent Capabilities</h3>
              <div className="space-y-2">
                {[
                  { name: 'Web Search (DuckDuckGo)', status: true },
                  { name: 'URL Reader', status: true },
                  { name: 'Code Execution (E2B)', status: true },
                  { name: 'File Workspace', status: true },
                  { name: 'GitHub Operations', status: true },
                  { name: 'Vercel Deploy', status: true },
                  { name: 'HuggingFace Deploy', status: true },
                  { name: 'Universal Connectors', status: true },
                  { name: 'Long-term Memory', status: true },
                  { name: 'Multi-step Planning', status: true },
                ].map(cap => (
                  <div key={cap.name} className="flex items-center gap-2 text-sm">
                    {cap.status
                      ? <CheckCircle size={14} className="text-green-400" />
                      : <AlertCircle size={14} className="text-yellow-400" />
                    }
                    <span className={cap.status ? 'text-white' : 'text-dark-400'}>{cap.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── UI Tab ── */}
        {settingsTab === 'ui' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Palette size={16} className="text-pink-400" /> UI Preferences
            </h2>

            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <User size={14} className="text-dark-400" /> User Identity
              </h3>
              <div className="flex gap-2">
                <input
                  type="text" value={userId}
                  onChange={e => setUserId(e.target.value)}
                  className="input-field text-sm flex-1 font-mono"
                  placeholder="user_id"
                />
                <button
                  onClick={() => {
                    const newId = `user_${Math.random().toString(36).slice(2)}`
                    setUserId(newId)
                    toast.success('User ID reset')
                  }}
                  className="btn-secondary text-xs px-3"
                >
                  Reset
                </button>
              </div>
              <p className="text-xs text-dark-600 mt-1">Used to scope conversations and memories</p>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Theme</h3>
              <p className="text-dark-400 text-sm">Dark mode is always on — optimized for developer use.</p>
            </div>
          </div>
        )}

        {/* ── System Tab ── */}
        {settingsTab === 'system' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Settings size={16} className="text-gray-400" /> System
            </h2>

            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Backend Connection</h3>
              <div className="font-mono text-xs text-dark-400 bg-dark-800 px-3 py-2 rounded">
                {BACKEND_URL}
              </div>
              <p className="text-xs text-dark-600 mt-2">
                Set VITE_BACKEND_URL environment variable to change the backend endpoint.
              </p>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Clear Data</h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    localStorage.removeItem('onehands-store-v2')
                    toast.success('Settings cleared. Reloading...')
                    setTimeout(() => window.location.reload(), 1000)
                  }}
                  className="btn-danger text-sm w-full"
                >
                  Clear All Settings & Reload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── About Tab ── */}
        {settingsTab === 'about' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Zap size={16} className="text-brand-400" /> About Onehands AI
            </h2>
            <div className="card space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-brand-600 to-purple-600 rounded-2xl flex items-center justify-center">
                  <Zap size={22} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Onehands AI</h3>
                  <p className="text-dark-400 text-sm">Real Autonomous AI Developer Platform</p>
                </div>
              </div>
              <div className="space-y-2 text-sm text-dark-400">
                {[
                  ['Version', 'v10.0 — Phase 10'],
                  ['Backend', 'FastAPI on HuggingFace Spaces'],
                  ['Frontend', 'React 18 + Vite + TailwindCSS'],
                  ['Database', 'Supabase PostgreSQL'],
                  ['Cache', 'Upstash Redis'],
                  ['Sandbox', 'E2B Code Execution'],
                  ['Auth', 'Per-user scoped sessions'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="text-white font-mono text-xs">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-2">Phase Completion</h3>
              <div className="space-y-1">
                {[
                  'Phase 1: Smart LLM Routing ✅',
                  'Phase 2: Persistent Conversations ✅',
                  'Phase 3: Realtime Streaming (SSE/WS) ✅',
                  'Phase 4: E2B Code Execution ✅',
                  'Phase 5: Autonomous Agent Loop ✅',
                  'Phase 6: Memory + Tool Calling ✅',
                  'Phase 7: Full-Stack Code Generator ✅',
                  'Phase 8: GitHub + Deploy Agent ✅',
                  'Phase 9: Full Developer Workflow ✅',
                  'Phase 10: Universal Connector ✅',
                ].map(p => (
                  <p key={p} className="text-xs text-dark-400">{p}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
