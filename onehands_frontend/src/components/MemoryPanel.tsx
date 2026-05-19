import React, { useState, useEffect } from 'react'
import { Brain, Plus, Trash2, Search, Star, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { memoryApi } from '../api'
import toast from 'react-hot-toast'

export default function MemoryPanel() {
  const { userId, memories, setMemories, activeConversationId } = useStore()
  const [content, setContent] = useState('')
  const [key, setKey] = useState('')
  const [memType, setMemType] = useState('fact')
  const [importance, setImportance] = useState(0.7)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const loadMemories = async () => {
    setLoading(true)
    try {
      const r = await memoryApi.get({
        user_id: userId,
        conv_id: activeConversationId || undefined,
        limit: 50,
      })
      setMemories(r.data.memories || [])
    } catch (err) {
      toast.error('Failed to load memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMemories()
  }, [userId, activeConversationId])

  const handleSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      await memoryApi.save({
        user_id: userId,
        content: content.trim(),
        memory_type: memType,
        key: key.trim() || undefined,
        importance,
        conv_id: activeConversationId || undefined,
      })
      setContent('')
      setKey('')
      toast.success('Memory saved')
      loadMemories()
    } catch (err) {
      toast.error('Failed to save memory')
    } finally {
      setSaving(false)
    }
  }

  const filteredMemories = memories.filter(m =>
    !filter || m.content.toLowerCase().includes(filter.toLowerCase()) ||
    (m.key || '').toLowerCase().includes(filter.toLowerCase())
  )

  const MEMORY_TYPE_COLORS: Record<string, string> = {
    fact: 'bg-blue-900/30 text-blue-300 border-blue-800/50',
    task_result: 'bg-green-900/30 text-green-300 border-green-800/50',
    preference: 'bg-purple-900/30 text-purple-300 border-purple-800/50',
    skill: 'bg-yellow-900/30 text-yellow-300 border-yellow-800/50',
    error: 'bg-red-900/30 text-red-300 border-red-800/50',
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Add memory */}
      <div className="w-72 flex-shrink-0 border-r border-dark-800 flex flex-col p-4 gap-4">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-purple-400" />
          <h2 className="font-semibold text-white">Memory System</h2>
        </div>
        <p className="text-xs text-dark-400">
          Phase 6: Persistent agent memory for facts, tasks, preferences, and skills.
        </p>

        {/* Add memory form */}
        <div className="card space-y-3">
          <h3 className="text-sm font-medium text-white">Add Memory</h3>

          <div>
            <label className="text-xs text-dark-400 mb-1 block">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What to remember..."
              rows={3}
              className="input-field text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-dark-400 mb-1 block">Type</label>
              <select
                value={memType}
                onChange={(e) => setMemType(e.target.value)}
                className="input-field text-sm py-1.5"
              >
                <option value="fact">Fact</option>
                <option value="task_result">Task Result</option>
                <option value="preference">Preference</option>
                <option value="skill">Skill</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-dark-400 mb-1 block">Key (optional)</label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="identifier"
                className="input-field text-sm py-1.5"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-dark-400 mb-1 block">
              Importance: {importance.toFixed(1)}
              <Star size={10} className="inline ml-1 text-yellow-400" />
            </label>
            <input
              type="range" min={0} max={1} step={0.1} value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Saving...</>
            ) : (
              <><Plus size={14} /> Save Memory</>
            )}
          </button>
        </div>
      </div>

      {/* Right: Memory list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-dark-800 bg-dark-900">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter memories..."
              className="input-field text-sm py-1.5 pl-9"
            />
          </div>
          <button onClick={loadMemories} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            {loading ? <Loader2 size={12} className="animate-spin" /> : 'Refresh'}
          </button>
          <span className="text-xs text-dark-500">{filteredMemories.length} memories</span>
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-brand-400" />
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="text-center py-12">
              <Brain size={32} className="mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400 text-sm">No memories stored</p>
              <p className="text-dark-600 text-xs mt-1">
                Run agent tasks or add memories manually
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMemories.map((mem) => (
                <div key={mem.id} className="card hover:border-dark-700 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${MEMORY_TYPE_COLORS[mem.memory_type] || MEMORY_TYPE_COLORS.fact}`}>
                          {mem.memory_type}
                        </span>
                        {mem.key && (
                          <span className="text-xs text-dark-500 font-mono">#{mem.key}</span>
                        )}
                        <div className="flex items-center gap-1 ml-auto">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              size={10}
                              className={i < Math.round(mem.importance * 5)
                                ? 'text-yellow-400 fill-yellow-400'
                                : 'text-dark-600'
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-dark-200 leading-relaxed">{mem.content}</p>
                      {mem.created_at && (
                        <p className="text-xs text-dark-600 mt-1">
                          {new Date(mem.created_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
