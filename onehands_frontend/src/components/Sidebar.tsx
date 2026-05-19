import React from 'react'
import { Plus, Trash2, MessageSquare, Bot, Clock } from 'lucide-react'
import { useStore } from '../store'
import { conversationsApi } from '../api'
import toast from 'react-hot-toast'

function formatTime(dateStr?: string) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

export default function Sidebar() {
  const {
    conversations, activeConversationId,
    setActiveConversation, addConversation, removeConversation,
    setMessages, setActiveTab, selectedModel, selectedProvider, userId,
  } = useStore()

  const handleNewConversation = async () => {
    try {
      const r = await conversationsApi.create({
        user_id: userId,
        title: 'New conversation',
        model: selectedModel,
        provider: selectedProvider,
      })
      const conv = r.data
      addConversation(conv)
      setActiveConversation(conv.id)
      setActiveTab('chat')
    } catch (err) {
      toast.error('Failed to create conversation')
    }
  }

  const handleSelectConversation = async (id: string) => {
    setActiveConversation(id)
    setActiveTab('chat')
    try {
      const r = await conversationsApi.getMessages(id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages(id, r.data.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        provider: m.provider,
        model: m.model,
        created_at: m.created_at,
      })))
    } catch (err) {
      // Graceful degradation
    }
  }

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await conversationsApi.delete(id)
      removeConversation(id)
      toast.success('Conversation deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const agentConvs = conversations.filter(c => c.task_type === 'agent')
  const chatConvs = conversations.filter(c => c.task_type !== 'agent')

  const ConvItem = ({ conv }: { conv: typeof conversations[0] }) => (
    <div
      key={conv.id}
      onClick={() => handleSelectConversation(conv.id)}
      className={`
        group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer
        transition-colors duration-150
        ${activeConversationId === conv.id
          ? 'bg-brand-600/20 border border-brand-600/30'
          : 'hover:bg-dark-800 border border-transparent'
        }
      `}
    >
      <div className="mt-0.5 flex-shrink-0">
        {conv.task_type === 'agent'
          ? <Bot size={14} className="text-purple-400" />
          : <MessageSquare size={14} className="text-dark-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate leading-tight">{conv.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Clock size={10} className="text-dark-500" />
          <span className="text-xs text-dark-500">{formatTime(conv.updated_at)}</span>
          <span className="text-xs text-dark-600">·</span>
          <span className="text-xs text-dark-500 truncate">{conv.model}</span>
        </div>
      </div>
      <button
        onClick={(e) => handleDeleteConversation(e, conv.id)}
        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-dark-500 transition-all"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-dark-950 w-64">
      {/* Header */}
      <div className="p-3 border-b border-dark-800">
        <button
          onClick={handleNewConversation}
          className="w-full btn-primary flex items-center justify-center gap-2 text-sm py-2"
        >
          <Plus size={16} />
          New Conversation
        </button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="text-center py-8 text-dark-500 text-sm">
            <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
            <p>No conversations yet</p>
            <p className="text-xs mt-1">Start a chat to begin</p>
          </div>
        ) : (
          <>
            {chatConvs.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-dark-500 px-2 py-1 font-medium uppercase tracking-wider">
                  Chats
                </p>
                {chatConvs.map(conv => <ConvItem key={conv.id} conv={conv} />)}
              </div>
            )}
            {agentConvs.length > 0 && (
              <div>
                <p className="text-xs text-dark-500 px-2 py-1 font-medium uppercase tracking-wider">
                  Agent Tasks
                </p>
                {agentConvs.map(conv => <ConvItem key={conv.id} conv={conv} />)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-dark-800">
        <p className="text-xs text-dark-600 text-center">
          Onehands AI v3.0 · Phase 1-6
        </p>
      </div>
    </div>
  )
}
