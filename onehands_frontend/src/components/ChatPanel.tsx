import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Send, StopCircle, Plus, Bot, User, Zap, Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, Message } from '../store'
import { chatApi, streamChat, conversationsApi, setBackendUrl, BACKEND_URL } from '../api'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={copy} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-dark-700 hover:bg-dark-600">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-dark-400" />}
    </button>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isUser ? 'bg-primary-600' : 'bg-dark-700'}`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-primary-400" />}
      </div>
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-4 py-3 text-sm relative group ${
          isUser
            ? 'bg-primary-600 text-white rounded-tr-sm'
            : 'bg-dark-800 text-dark-100 rounded-tl-sm'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  pre: ({ children }) => (
                    <pre className="relative group/pre bg-dark-900 rounded-lg p-3 overflow-x-auto text-xs">
                      {children}
                    </pre>
                  ),
                  code: ({ children, className }) => {
                    if (className) return <code className={className}>{children}</code>
                    return <code className="bg-dark-700 px-1 rounded text-primary-300 text-xs">{children}</code>
                  },
                }}
              >
                {msg.isStreaming ? msg.content + '▋' : msg.content}
              </ReactMarkdown>
            </div>
          )}
          {!isUser && !msg.isStreaming && (
            <CopyButton text={msg.content} />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-500 px-1">
          {msg.provider && (
            <span className="bg-dark-700 px-2 py-0.5 rounded-full text-dark-400">
              {msg.provider}/{msg.model}
            </span>
          )}
          <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  )
}

export default function ChatPanel() {
  const {
    messages, addMessage, updateLastMessage, clearMessages,
    activeConversationId, setActiveConversation, addConversation,
    settings, userId,
  } = useStore()

  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleNewChat = async () => {
    clearMessages()
    setActiveConversation(null)
    try {
      const res = await conversationsApi.create({
        user_id: userId,
        model: settings.model,
        provider: settings.provider,
        title: 'New Chat',
      })
      const conv = res.data
      setActiveConversation(conv.id)
      addConversation({ id: conv.id, title: conv.title, created_at: conv.created_at })
    } catch {}
  }

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    setStreaming(true)

    // Create placeholder assistant message
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }
    addMessage(assistantMsg)

    // Ensure backend URL is up to date
    if (settings.backendUrl !== BACKEND_URL) {
      setBackendUrl(settings.backendUrl)
    }

    const stop = streamChat(
      {
        message: text,
        conversation_id: activeConversationId || undefined,
        provider: settings.provider,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        system_prompt: settings.systemPrompt || undefined,
        user_id: userId,
      },
      (token) => {
        updateLastMessage({ content: (prev: any) => prev.content + token, isStreaming: true })
      },
      (fullText) => {
        updateLastMessage({ content: fullText, isStreaming: false })
        setStreaming(false)
        stopRef.current = null
      },
      (err) => {
        updateLastMessage({ content: `Error: ${err}`, isStreaming: false })
        setStreaming(false)
        toast.error(err)
        stopRef.current = null
      }
    )
    stopRef.current = stop
  }, [input, streaming, settings, activeConversationId, userId, addMessage, updateLastMessage])

  // Fix: streaming callback needs access to current message content
  const sendMessageFixed = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    setStreaming(true)

    let accumulated = ''
    const assistantId = crypto.randomUUID()
    addMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    })

    if (settings.backendUrl !== BACKEND_URL) {
      setBackendUrl(settings.backendUrl)
    }

    const stop = streamChat(
      {
        message: text,
        conversation_id: activeConversationId || undefined,
        provider: settings.provider,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        system_prompt: settings.systemPrompt || undefined,
        user_id: userId,
      },
      (token) => {
        accumulated += token
        updateLastMessage({ content: accumulated, isStreaming: true })
      },
      (fullText) => {
        updateLastMessage({ content: fullText || accumulated, isStreaming: false })
        setStreaming(false)
        stopRef.current = null
      },
      (err) => {
        updateLastMessage({
          content: accumulated || `❌ Error: ${err}. Check backend URL in Settings.`,
          isStreaming: false
        })
        setStreaming(false)
        toast.error(`Stream error: ${err}`)
        stopRef.current = null
      }
    )
    stopRef.current = stop
  }, [input, streaming, settings, activeConversationId, userId, addMessage, updateLastMessage])

  const handleStop = () => {
    if (stopRef.current) {
      stopRef.current()
      updateLastMessage({ isStreaming: false })
      setStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessageFixed()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-800 bg-dark-950">
        <div className="flex items-center gap-2 text-sm text-dark-400">
          <Zap size={14} className="text-primary-400" />
          <span className="text-dark-300">{settings.provider}/{settings.model}</span>
        </div>
        <button onClick={handleNewChat} className="btn-ghost text-xs flex items-center gap-1">
          <Plus size={14} />
          New Chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-primary-600/20 flex items-center justify-center">
              <Bot size={28} className="text-primary-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-lg">Onehands AI Developer</h3>
              <p className="text-dark-400 text-sm mt-1">
                I can chat, write code, run tasks autonomously, and deploy projects.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              {[
                'Write a FastAPI hello world',
                'Explain recursion with examples',
                'Create a React counter component',
                'Write Python to parse JSON',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs text-left bg-dark-800 hover:bg-dark-700 rounded-xl p-3 text-dark-300 hover:text-white transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-dark-800 bg-dark-950">
        <div className="flex gap-2 items-end bg-dark-800 rounded-2xl px-4 py-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Onehands AI... (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 bg-transparent text-sm text-dark-100 placeholder-dark-500 resize-none outline-none max-h-32 overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
            disabled={streaming}
          />
          {streaming ? (
            <button onClick={handleStop} className="flex-shrink-0 p-2 rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors">
              <StopCircle size={16} />
            </button>
          ) : (
            <button
              onClick={sendMessageFixed}
              disabled={!input.trim()}
              className="flex-shrink-0 p-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="text-xs text-dark-600 mt-1 text-center">
          Streaming via {settings.backendUrl.replace('https://', '')}
        </p>
      </div>
    </div>
  )
}
