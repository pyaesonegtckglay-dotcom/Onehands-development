import React, { useState, useEffect } from 'react'
import { Activity, Database, Radio, Cpu, MemoryStick, RefreshCw, CheckCircle, XCircle, Server } from 'lucide-react'
import { useStore } from '../store'
import { healthApi, setBackendUrl, BACKEND_URL } from '../api'

function StatusBadge({ ok }: { ok: boolean | string }) {
  const isOk = ok === true || ok === 'connected'
  return (
    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isOk ? 'bg-green-900 text-green-300' : 'bg-red-900/50 text-red-400'}`}>
      {isOk ? <CheckCircle size={10} /> : <XCircle size={10} />}
      {isOk ? 'OK' : (typeof ok === 'string' ? ok : 'DOWN')}
    </span>
  )
}

export default function HealthPanel() {
  const { settings, healthData, setHealthData } = useStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const check = async () => {
    if (settings.backendUrl !== BACKEND_URL) setBackendUrl(settings.backendUrl)
    setLoading(true)
    setError('')
    try {
      const res = await healthApi.check()
      setHealthData(res.data)
    } catch (err: any) {
      setError(err.message || 'Health check failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [settings.backendUrl])

  const h = healthData

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-primary-400" />
          <h2 className="text-white font-semibold">System Health</h2>
        </div>
        <button onClick={check} disabled={loading} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4">
          <p className="text-red-400 text-sm">❌ {error}</p>
          <p className="text-xs text-dark-400 mt-1">Backend: {settings.backendUrl}</p>
        </div>
      )}

      {h && (
        <>
          {/* Services */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-dark-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-dark-400" />
                  <span className="text-xs text-dark-400">Backend</span>
                </div>
                <StatusBadge ok={h.status === 'healthy'} />
              </div>
              <p className="text-xs text-dark-500">{settings.backendUrl.replace('https://', '')}</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-dark-400" />
                  <span className="text-xs text-dark-400">Database</span>
                </div>
                <StatusBadge ok={h.db} />
              </div>
              <p className="text-xs text-dark-500">{h.db === true || h.db === 'connected' ? 'PostgreSQL' : 'In-memory fallback'}</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Radio size={14} className="text-dark-400" />
                  <span className="text-xs text-dark-400">Redis</span>
                </div>
                <StatusBadge ok={h.redis} />
              </div>
              <p className="text-xs text-dark-500">{h.redis === true || h.redis === 'connected' ? 'Upstash Redis' : 'Disabled'}</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Cpu size={14} className="text-dark-400" />
                  <span className="text-xs text-dark-400">E2B Sandbox</span>
                </div>
                <StatusBadge ok={h.e2b} />
              </div>
              <p className="text-xs text-dark-500">{h.e2b ? 'Configured' : 'Not configured'}</p>
            </div>
          </div>

          {/* System Resources */}
          {h.system && (
            <div className="bg-dark-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-dark-400 uppercase mb-3">System Resources</h3>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-dark-400">CPU</span>
                    <span className={h.system.cpu_percent > 80 ? 'text-red-400' : 'text-dark-300'}>
                      {h.system.cpu_percent?.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${h.system.cpu_percent > 80 ? 'bg-red-500' : 'bg-primary-500'}`}
                      style={{ width: `${Math.min(h.system.cpu_percent, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-dark-400">Memory</span>
                    <span className={h.system.memory_percent > 85 ? 'text-red-400' : 'text-dark-300'}>
                      {h.system.memory_percent?.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${h.system.memory_percent > 85 ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(h.system.memory_percent, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Providers */}
          {h.providers && (
            <div className="bg-dark-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-dark-400 uppercase mb-3">LLM Providers</h3>
              <div className="space-y-2">
                {Object.entries(h.providers).map(([provider, info]: any) => (
                  <div key={provider} className="flex items-center justify-between">
                    <span className="text-sm text-dark-300 capitalize">{provider}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-dark-500">
                        {info.available}/{info.total} keys
                      </span>
                      <StatusBadge ok={info.available > 0} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Backend URL */}
      <div className="bg-dark-800 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-dark-400 uppercase mb-2">Backend URL</h3>
        <code className="text-xs text-primary-300 break-all">{settings.backendUrl}</code>
        <p className="text-xs text-dark-500 mt-1">Change in Settings → LLM tab</p>
      </div>
    </div>
  )
}
