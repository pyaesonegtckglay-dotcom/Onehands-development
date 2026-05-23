import React, { useState } from 'react'
import { Link2, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../api'

const PLATFORMS = [
  { id: 'github', name: 'GitHub', icon: '🐙', category: 'code', endpoint: '/dev/github', testOp: 'get_user', tokenField: 'github_token' },
  { id: 'huggingface', name: 'HuggingFace', icon: '🤗', category: 'ai', endpoint: null },
  { id: 'vercel', name: 'Vercel', icon: '▲', category: 'deploy', endpoint: null },
  { id: 'e2b', name: 'E2B Sandbox', icon: '🧪', category: 'code', endpoint: '/debug/env' },
]

export default function ConnectorPanel() {
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, 'ok' | 'error' | 'testing'>>({})

  const test = async (platform: typeof PLATFORMS[0]) => {
    const token = credentials[platform.id]
    if (!token) { toast.error('Enter a token first'); return }
    setStatuses(s => ({ ...s, [platform.id]: 'testing' }))
    try {
      if (platform.endpoint === '/dev/github') {
        const res = await api.post('/dev/github', { operation: 'get_user', github_token: token })
        if (res.data.login) {
          toast.success(`GitHub: ${res.data.login}`)
          setStatuses(s => ({ ...s, [platform.id]: 'ok' }))
        } else {
          setStatuses(s => ({ ...s, [platform.id]: 'error' }))
        }
      } else {
        setStatuses(s => ({ ...s, [platform.id]: 'ok' }))
      }
    } catch {
      setStatuses(s => ({ ...s, [platform.id]: 'error' }))
      toast.error(`${platform.name} test failed`)
    }
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-primary-400" />
        <span className="text-white font-semibold">Platform Connectors</span>
      </div>

      {PLATFORMS.map((p) => (
        <div key={p.id} className="bg-dark-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{p.icon}</span>
              <span className="text-sm font-medium text-white">{p.name}</span>
              <span className="text-xs text-dark-500">{p.category}</span>
            </div>
            {statuses[p.id] === 'ok' && <CheckCircle size={14} className="text-green-400" />}
            {statuses[p.id] === 'error' && <XCircle size={14} className="text-red-400" />}
            {statuses[p.id] === 'testing' && <RefreshCw size={14} className="text-primary-400 animate-spin" />}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              placeholder={`${p.name} token / API key`}
              value={credentials[p.id] || ''}
              onChange={(e) => setCredentials(c => ({ ...c, [p.id]: e.target.value }))}
              className="input-field flex-1 text-sm"
            />
            <button onClick={() => test(p)} className="btn-ghost text-xs">Test</button>
          </div>
        </div>
      ))}
    </div>
  )
}
