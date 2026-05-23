import React from 'react'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { conversationsApi } from '../api'

export default function Sidebar() {
  const {
    conversations, activeConversationId, setActiveConversation,
    removeConversation, clearMessages, setMessages,
    addConversation, userId, settings, setActiveTab,
  } = useStore()

  const newChat = async () => {
    clearMessages()
    setActiveConversation(null)
    setActiveTab('chat')
    try {
      const res = await conversationsApi.create({
        user_id: userId,
        title: 'New Chat',
        model: settings.model,
        provider: settings.provider,
      })
      const conv = res.data
      addConversation({ id: conv.id, title: conv.title || 'New Chat', created_at: conv.created_at })
      setActiveConversation(conv.id)
    } catch {}
  }

  const openConversation = async (id: string) => {
    setActiveConversation(id)
    setActiveTab('chat')
    try {
      const res = await conversationsApi.getMessages(id)
      const msgs = (res.data?.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        provider: m.provider,
        model: m.model,
        timestamp: m.created_at * 1000 || Date.now(),
      }))
      setMessages(msgs)
    } catch {
      clearMessages()
    }
  }

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await conversationsApi.delete(id)
      removeConversation(id)
      if (activeConversationId === id) clearMessages()
      toast.success('Deleted')
    } catch {
      removeConversation(id) // local delete even if API fails
    }
  }

  return (
    <div className="h-full flex flex-col bg-dark-900 overflow-hidden">
      {/* New Chat button */}
      <div className="p-3 border-b border-dark-800">
        <button
          onClick={newChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus size={14} />
          New Chat
        </button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <p className="text-xs text-dark-500 px-2 py-1 uppercase tracking-wide">Recent</p>
        {conversations.length === 0 && (
          <p className="text-xs text-dark-600 px-2">No conversations yet</p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => openConversation(conv.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left group transition-colors ${
              activeConversationId === conv.id
                ? 'bg-dark-700 text-white'
                : 'text-dark-400 hover:bg-dark-800 hover:text-dark-200'
            }`}
          >
            <MessageSquare size={13} className="flex-shrink-0" />
            <span className="text-xs flex-1 truncate">{conv.title || 'Chat'}</span>
            <button
              onClick={(e) => deleteConversation(e, conv.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-dark-600 transition-opacity"
            >
              <Trash2 size={10} className="text-dark-500 hover:text-red-400" />
            </button>
          </button>
        ))}
      </div>
    </div>
  )
}
