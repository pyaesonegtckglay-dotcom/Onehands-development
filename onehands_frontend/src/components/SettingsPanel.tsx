import React from 'react'
import { Settings, Thermometer, Hash, Brain, Server, User } from 'lucide-react'
import { useStore, type Provider } from '../store'
import { BACKEND_URL } from '../api'
import toast from 'react-hot-toast'

const PROVIDERS: { id: Provider; name: string; color: string }[] = [
  { id: 'gemini',     name: 'Google Gemini',    color: 'text-blue-400' },
  { id: 'sambanova',  name: 'SambaNova AI',     color: 'text-orange-400' },
  { id: 'github_llm', name: 'GitHub Models',    color: 'text-green-400' },
]

const MODELS_BY_PROVIDER: Record<Provider, { id: string; name: string }[]> = {
  gemini: [
    { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview' },
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
    { id: 'gpt-4o',                     name: 'GPT-4o' },
    { id: 'gpt-4o-mini',               name: 'GPT-4o Mini' },
    { id: 'Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B (GitHub)' },
    { id: 'Mistral-large-2407',         name: 'Mistral Large' },
    { id: 'DeepSeek-R1',                name: 'DeepSeek R1 (GitHub)' },
  ],
}

export default function SettingsPanel() {
  const {
    selectedModel, selectedProvider, temperature, maxTokens, systemPrompt,
    userId,
    setSelectedModel, setSelectedProvider, setTemperature, setMaxTokens, setSystemPrompt,
    setUserId,
  } = useStore()

  const handleProviderChange = (provider: Provider) => {
    setSelectedProvider(provider)
    // Set a sensible default model for the provider
    const models = MODELS_BY_PROVIDER[provider]
    if (models.length > 0 && !models.find(m => m.id === selectedModel)) {
      setSelectedModel(models[0].id)
    }
  }

  const availableModels = MODELS_BY_PROVIDER[selectedProvider] || []

  return (
    <div className="flex h-full overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-dark-400" />
          <h2 className="font-semibold text-white">Settings</h2>
        </div>

        {/* Provider selection */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Server size={14} className="text-blue-400" />
            LLM Provider
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                  selectedProvider === p.id
                    ? 'border-brand-500 bg-brand-600/20 text-white'
                    : 'border-dark-700 bg-dark-800/50 text-dark-400 hover:border-dark-600 hover:text-white'
                }`}
              >
                <span className={p.color}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model selection */}
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

        {/* Generation params */}
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Thermometer size={14} className="text-orange-400" />
            Generation Parameters
          </h3>

          <div>
            <label className="text-xs text-dark-400 mb-2 block flex items-center justify-between">
              <span>Temperature</span>
              <span className="text-white font-mono">{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range" min={0} max={2} step={0.1} value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-dark-600 mt-1">
              <span>0 (precise)</span>
              <span>1 (balanced)</span>
              <span>2 (creative)</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-dark-400 mb-2 block flex items-center justify-between">
              <span>Max Tokens</span>
              <span className="text-white font-mono">{maxTokens.toLocaleString()}</span>
            </label>
            <input
              type="range" min={256} max={8192} step={256} value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-dark-600 mt-1">
              <span>256</span>
              <span>4096</span>
              <span>8192</span>
            </div>
          </div>
        </div>

        {/* System prompt */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Brain size={14} className="text-purple-400" />
            System Prompt
          </h3>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Optional system prompt to customize AI behavior..."
            rows={4}
            className="input-field text-sm resize-none"
          />
          <p className="text-xs text-dark-600 mt-1">
            Leave empty for default behavior
          </p>
        </div>

        {/* User ID */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <User size={14} className="text-dark-400" />
            User Identity
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
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
          <p className="text-xs text-dark-600 mt-1">
            Used to scope conversations and memories
          </p>
        </div>

        {/* Backend info */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-2">Backend</h3>
          <div className="font-mono text-xs text-dark-400 bg-dark-800 px-3 py-2 rounded">
            {BACKEND_URL}
          </div>
        </div>
      </div>
    </div>
  )
}
