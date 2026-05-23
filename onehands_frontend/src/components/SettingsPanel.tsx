import React, { useState } from 'react'
import { Settings, Eye, EyeOff, Save, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { setBackendUrl, healthApi } from '../api'

type SettingsTab = 'llm' | 'keys' | 'agent'

function MaskedInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field w-full pr-8 text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

export default function SettingsPanel() {
  const { settings, updateSettings } = useStore()
  const [tab, setTab] = useState<SettingsTab>('llm')
  const [testing, setTesting] = useState(false)

  const save = () => {
    setBackendUrl(settings.backendUrl)
    toast.success('Settings saved!')
  }

  const testConnection = async () => {
    setTesting(true)
    setBackendUrl(settings.backendUrl)
    try {
      const res = await healthApi.check()
      toast.success(`Connected! Status: ${res.data.status}`)
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message}`)
    } finally {
      setTesting(false)
    }
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'llm', label: 'LLM & Backend' },
    { id: 'keys', label: 'API Keys' },
    { id: 'agent', label: 'Agent Config' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-primary-400" />
          <span className="text-white font-semibold">Settings</span>
        </div>
        <button onClick={save} className="btn-primary text-xs flex items-center gap-1">
          <Save size={12} />
          Save
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-dark-800">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              tab === id ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white hover:bg-dark-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* ── LLM & Backend ── */}
        {tab === 'llm' && (
          <>
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Backend URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={settings.backendUrl}
                  onChange={(e) => updateSettings({ backendUrl: e.target.value })}
                  className="input-field flex-1 text-sm"
                  placeholder="https://pyae1994-openhands-genspark-agent.hf.space"
                />
                <button
                  onClick={testConnection}
                  disabled={testing}
                  className="btn-ghost text-xs whitespace-nowrap flex items-center gap-1"
                >
                  {testing ? <RefreshCw size={12} className="animate-spin" /> : null}
                  Test
                </button>
              </div>
              <p className="text-xs text-dark-500 mt-1">HuggingFace Space URL for the backend</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Default Provider</label>
              <select
                value={settings.provider}
                onChange={(e) => updateSettings({ provider: e.target.value })}
                className="input-field w-full text-sm"
              >
                <option value="gemini">Gemini (Google)</option>
                <option value="github">GitHub (GPT-4o-mini)</option>
                <option value="sambanova">SambaNova (Llama)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Default Model</label>
              <select
                value={settings.model}
                onChange={(e) => updateSettings({ model: e.target.value })}
                className="input-field w-full text-sm"
              >
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="Meta-Llama-3.1-8B-Instruct">Meta-Llama-3.1-8B-Instruct</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Temperature: {settings.temperature}</label>
                <input
                  type="range"
                  min={0} max={1} step={0.1}
                  value={settings.temperature}
                  onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Max Tokens</label>
                <input
                  type="number"
                  value={settings.maxTokens}
                  onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
                  min={512} max={8192}
                  className="input-field w-full text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">System Prompt (optional)</label>
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
                placeholder="Custom system prompt for all conversations..."
                rows={3}
                className="input-field w-full resize-none text-sm"
              />
            </div>
          </>
        )}

        {/* ── API Keys ── */}
        {tab === 'keys' && (
          <>
            <p className="text-xs text-dark-500">
              ⚠️ Keys stored here are only for reference — actual keys are configured as HuggingFace Space Secrets.
              These values are stored in your browser's localStorage only.
            </p>

            {[
              { key: 'geminiKey', label: 'Gemini API Key', placeholder: 'AIza...' },
              { key: 'githubToken', label: 'GitHub Token', placeholder: 'ghp_...' },
              { key: 'sambaNovaKey', label: 'SambaNova Key', placeholder: 'sn-...' },
              { key: 'e2bApiKey', label: 'E2B API Key', placeholder: 'e2b_...' },
              { key: 'hfToken', label: 'HuggingFace Token', placeholder: 'hf_...' },
              { key: 'vercelToken', label: 'Vercel Token', placeholder: 'vcp_...' },
              { key: 'githubRepoDefault', label: 'Default GitHub Repo', placeholder: 'owner/repo-name' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-dark-400 mb-1">{label}</label>
                <MaskedInput
                  value={(settings as any)[key] || ''}
                  onChange={(v) => updateSettings({ [key]: v } as any)}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </>
        )}

        {/* ── Agent Config ── */}
        {tab === 'agent' && (
          <>
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Max Agent Steps: {settings.maxSteps}</label>
              <input
                type="range"
                min={1} max={25} step={1}
                value={settings.maxSteps}
                onChange={(e) => updateSettings({ maxSteps: Number(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-dark-600 mt-0.5">
                <span>1 (fast)</span>
                <span>25 (thorough)</span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => updateSettings({ autoExecuteCode: !settings.autoExecuteCode })}
                  className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${settings.autoExecuteCode ? 'bg-primary-600' : 'bg-dark-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${settings.autoExecuteCode ? 'left-5' : 'left-0.5'}`} />
                </div>
                <div>
                  <p className="text-sm text-dark-200">Auto Execute Code</p>
                  <p className="text-xs text-dark-500">Automatically run code blocks in agent responses</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => updateSettings({ useMemory: !settings.useMemory })}
                  className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${settings.useMemory ? 'bg-primary-600' : 'bg-dark-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${settings.useMemory ? 'left-5' : 'left-0.5'}`} />
                </div>
                <div>
                  <p className="text-sm text-dark-200">Use Memory</p>
                  <p className="text-xs text-dark-500">Inject relevant memories into agent context</p>
                </div>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
