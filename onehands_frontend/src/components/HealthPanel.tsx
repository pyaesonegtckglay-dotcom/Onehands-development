import React, { useState, useEffect } from 'react'
import { Activity, RefreshCw, Check, X, Key, Zap, Database, Radio, Code2, Bot, Brain, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { healthApi } from '../api'
import toast from 'react-hot-toast'

const PHASE_ICONS: Record<string, React.FC<any>> = {
  phase1_llm_routing: Key,
  phase2_persistence: Database,
  phase3_realtime: Radio,
  phase4_code_exec: Code2,
  phase5_agent_loop: Bot,
  phase6_memory_tools: Brain,
}

const PHASE_LABELS: Record<string, string> = {
  phase1_llm_routing: 'Phase 1: LLM Routing',
  phase2_persistence: 'Phase 2: Persistence',
  phase3_realtime: 'Phase 3: Realtime',
  phase4_code_exec: 'Phase 4: Code Exec',
  phase5_agent_loop: 'Phase 5: Agent Loop',
  phase6_memory_tools: 'Phase 6: Memory & Tools',
}

export default function HealthPanel() {
  const { healthStatus, setHealthStatus } = useStore()
  const [loading, setLoading] = useState(false)

  const loadHealth = async () => {
    setLoading(true)
    try {
      const r = await healthApi.check()
      setHealthStatus(r.data)
    } catch (err: any) {
      toast.error('Failed to fetch health: ' + (err.message || 'unknown'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const handleReloadKeys = async () => {
    try {
      await healthApi.reloadKeys()
      toast.success('API keys reloaded')
      loadHealth()
    } catch {
      toast.error('Failed to reload keys')
    }
  }

  const health = healthStatus as any

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <div className={`w-2 h-2 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'} flex-shrink-0`} />
  )

  const ProviderKeyTable = ({ provider, data }: { provider: string; data: any }) => (
    <div className="card mt-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-dark-400" />
          <span className="text-sm font-medium capitalize">{provider.replace('_', ' ')}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-400">
          <span className="text-green-400">{data.available_keys}</span>
          <span>/</span>
          <span>{data.total_keys} keys available</span>
        </div>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(data.keys || []).map((key: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs bg-dark-800/50 rounded px-2 py-1.5">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${key.available ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="font-mono text-dark-400">{key.key_suffix}</span>
            <span className="text-dark-600">·</span>
            <span className="text-dark-500">{key.total_requests} req</span>
            {key.cooldown_remaining > 0 && (
              <span className="ml-auto text-orange-400">
                cooldown {key.cooldown_remaining}s
              </span>
            )}
            {key.last_error && (
              <span className="ml-auto text-red-400 truncate max-w-32">{key.last_error}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex h-full overflow-y-auto">
      <div className="w-full max-w-4xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-green-400" />
            <h2 className="font-semibold text-white">System Health</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReloadKeys}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
            >
              <Key size={12} /> Reload Keys
            </button>
            <button
              onClick={loadHealth}
              disabled={loading}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
        </div>

        {loading && !health ? (
          <div className="flex justify-center py-12">
            <Loader2 size={28} className="animate-spin text-brand-400" />
          </div>
        ) : health ? (
          <>
            {/* Overall status */}
            <div className={`card flex items-center gap-3 ${
              health.status === 'ok'
                ? 'border-green-700/50 bg-green-900/10'
                : health.status === 'partial'
                ? 'border-yellow-700/50 bg-yellow-900/10'
                : 'border-red-700/50 bg-red-900/10'
            }`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                health.status === 'ok' ? 'bg-green-900/50' : 'bg-red-900/50'
              }`}>
                {health.status === 'ok'
                  ? <Check size={18} className="text-green-400" />
                  : <X size={18} className="text-red-400" />
                }
              </div>
              <div>
                <p className="font-semibold text-white capitalize">{health.status}</p>
                <p className="text-xs text-dark-400">
                  DB: {health.database} · Redis: {health.redis} · E2B: {health.e2b}
                </p>
              </div>
              {health.timestamp && (
                <span className="ml-auto text-xs text-dark-500">
                  {new Date(health.timestamp * 1000).toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Phase status */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Zap size={14} className="text-yellow-400" />
                Phase Status
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(health.phases || {}).map(([phase, active]) => {
                  const Icon = PHASE_ICONS[phase] || Activity
                  return (
                    <div key={phase} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      active
                        ? 'border-green-800/50 bg-green-900/10'
                        : 'border-dark-700 bg-dark-800/30'
                    }`}>
                      <Icon size={14} className={active ? 'text-green-400' : 'text-dark-500'} />
                      <div className="min-w-0">
                        <p className={`text-xs font-medium ${active ? 'text-green-300' : 'text-dark-500'}`}>
                          {PHASE_LABELS[phase] || phase}
                        </p>
                      </div>
                      <div className="ml-auto">
                        <StatusDot ok={Boolean(active)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Infrastructure */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Database', value: health.database, icon: Database },
                { label: 'Redis', value: health.redis, icon: Radio },
                { label: 'E2B Sandbox', value: health.e2b, icon: Code2 },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className={`card flex items-center gap-3 ${
                  value === 'connected' || value === 'configured'
                    ? 'border-green-800/30'
                    : 'border-dark-700'
                }`}>
                  <Icon size={16} className={
                    value === 'connected' || value === 'configured'
                      ? 'text-green-400' : 'text-dark-500'
                  } />
                  <div>
                    <p className="text-xs text-dark-400">{label}</p>
                    <p className={`text-sm font-medium ${
                      value === 'connected' || value === 'configured'
                        ? 'text-green-300' : 'text-dark-400'
                    }`}>{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Provider keys */}
            {health.smart_router && (
              <div>
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Key size={14} className="text-blue-400" />
                  API Key Pools
                </h3>
                {Object.entries(health.smart_router).map(([provider, data]) => (
                  <ProviderKeyTable key={provider} provider={provider} data={data} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-dark-400">
            <Activity size={32} className="mx-auto mb-3 opacity-30" />
            <p>Click Refresh to load health status</p>
          </div>
        )}
      </div>
    </div>
  )
}
