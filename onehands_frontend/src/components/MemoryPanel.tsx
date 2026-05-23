import React, { useState, useEffect } from 'react'
import { Brain, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { memoryApi } from '../api'

export default function MemoryPanel() {
  const { userId, settings, memories, setMemories, addMemory } = useStore()
  const [content, setContent] = useState('')
  const [memType, setMemType] = useState('fact')
  const [key, setKey] = useState('')
  const [importance, setImportance] = useState(0.5)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadMemories = async () => {
    setLoading(true)
    try {
      const res = await memoryApi.list(userId, 20)
      setMemories(res.data?.memories || [])
    } catch (err: any) {
      toast.error('Failed to load memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMemories() }, [userId])

  const saveMemory = async () => {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      const res = await memoryApi.save({
        user_id: userId,
        content: content.trim(),
        memory_type: memType,
        key: key || undefined,
        importance,
      })
      addMemory(res.data)
      setContent('')
      setKey('')
      toast.success('Memory saved!')
    } catch (err: any) {
      toast.error('Failed to save memory')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-primary-400" />
          <span className="text-white font-semibold">Memory System</span>
          <span className="text-xs bg-dark-700 text-dark-400 px-2 py-0.5 rounded-full">
            {memories.length} memories
          </span>
        </div>
        <button onClick={loadMemories} disabled={loading} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Add memory */}
        <div className="p-4 border-b border-dark-800 space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What should I remember? e.g. 'User prefers Python for backend, React for frontend'"
            rows={3}
            className="input-field w-full resize-none text-sm"
          />
          <div className="flex gap-2 flex-wrap">
            <select value={memType} onChange={(e) => setMemType(e.target.value)} className="input-field text-xs py-1">
              <option value="fact">Fact</option>
              <option value="task_result">Task Result</option>
              <option value="preference">Preference</option>
              <option value="skill">Skill</option>
            </select>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Key (optional)"
              className="input-field text-xs py-1 flex-1 min-w-24"
            />
            <div className="flex items-center gap-1">
              <Star size={12} className="text-yellow-500" />
              <input
                type="range" min={0} max={1} step={0.1}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="w-20"
                title={`Importance: ${importance}`}
              />
              <span className="text-xs text-dark-400 w-6">{importance}</span>
            </div>
            <button onClick={saveMemory} disabled={!content.trim() || saving} className="btn-primary text-xs flex items-center gap-1">
              <Plus size={12} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Memory list */}
        <div className="p-4 space-y-2">
          {memories.length === 0 && !loading && (
            <div className="text-center py-8 text-dark-500">
              <Brain size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No memories yet</p>
            </div>
          )}
          {memories.map((mem) => (
            <div key={mem.id} className="bg-dark-800 rounded-xl p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-dark-200">{mem.content}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-dark-700 text-dark-400 px-1.5 py-0.5 rounded-full">{mem.memory_type}</span>
                  {mem.key && <span className="text-xs text-dark-500">key: {mem.key}</span>}
                  <div className="flex items-center gap-0.5">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} size={8} className={i <= mem.importance * 5 ? 'text-yellow-500 fill-current' : 'text-dark-700'} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
