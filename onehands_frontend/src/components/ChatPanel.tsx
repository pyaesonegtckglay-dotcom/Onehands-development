import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import {
  Send, Copy, CheckCheck, RefreshCw, ChevronDown, Zap, User, Bot,
  StopCircle, PlusCircle
} from 'lucide-react'
import { useStore } from '../store'
import { chatApi, conversationsApi, streamChat } from '../api'
import toast from 'react-hot-toast'
import 'highlight.js/styles/github-dark.css'

const PROVIDER_COLORS: Record<string, string> = {
  gemini: 'text-blue-400',
  sambanova: 'text-orange-400',
  github_llm: 'text-green-400',
}

const PROVIDER_BADGES: Record<string, string> = {
  gemini: 'bg-blue-900/30 text-blue-300 border-blue-800/50',
  sambanova: 'bg-orange-900/30 text-orange-300 border-orange-800/50',
  github_llm: 'bg-green-900/30 text-green-300 border-green-800/50',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="p-1 rounded hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <CheckCheck size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  )
}

export default function ChatPanel() {
  const {
    activeConversationId, setActiveConversation, addConversation,
    messages, addMessage, updateMessage, setMessages,
    selectedModel, selectedProvider, temperature, maxTokens, systemPrompt,
    isStreaming, setIsStreaming, userId,
  } = useStore()

  const [input, setInput] = useState('')
  const [localConvId, setLocalConvId] = useState<string | null>(activeConversationId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopStreamRef = useRef<(() => void) | null>(null)

  const currentMessages = localConvId ? (messages[localConvId] || []) : []

  useEffect(() => {
    setLocalConvId(activeConversationId)
  }, [activeConversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, localConvId])

  const handleNewChat = async () => {
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
      setLocalConvId(conv.id)
    } catch {
      const tempId = `temp_${Date.now()}`
      setLocalConvId(tempId)
      setActiveConversation(tempId)
    }
  }

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || isStreaming) return

    setInput('')
    setIsStreaming(true)

    // Ensure we have a conversation
    let convId = localConvId
    if (!convId) {
      try {
        const r = await conversationsApi.create({
          user_id: userId,
          title: msg.slice(0, 60),
          model: selectedModel,
          provider: selectedProvider,
        })
        convId = r.data.id
        addConversation(r.data)
        setActiveConversation(convId)
        setLocalConvId(convId)
      } catch {
        convId = `temp_${Date.now()}`
        setLocalConvId(convId)
        setActiveConversation(convId)
      }
    }

    // Add user message
    const userMsgId = `user_${Date.now()}`
    addMessage(convId, {
      id: userMsgId,
      role: 'user',
      content: msg,
    })

    // Add placeholder for assistant
    const assistantMsgId = `assistant_${Date.now()}`
    addMessage(convId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    })

    let accumulatedText = ''

    stopStreamRef.current = streamChat(
      {
        conversation_id: convId,
        message: msg,
        model: selectedModel,
        provider: selectedProvider,
        temperature,
        max_tokens: maxTokens,
        system_prompt: systemPrompt || undefined,
        user_id: userId,
      },
      (chunk) => {
        accumulatedText += chunk
        updateMessage(convId!, assistantMsgId, {
          content: accumulatedText,
          isStreaming: true,
        })
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      },
      (returnedConvId, provider, model) => {
        // Update with final conv_id if it changed
        if (returnedConvId && returnedConvId !== convId) {
          setLocalConvId(returnedConvId)
          setActiveConversation(returnedConvId)
          // Re-map messages
          const currentMsgs = messages[convId!] || []
          const updatedMsgs = currentMsgs.map(m =>
            m.id === assistantMsgId ? { ...m, isStreaming: false, provider, model } : m
          )
          setMessages(returnedConvId, updatedMsgs)
        } else {
          updateMessage(convId!, assistantMsgId, {
            isStreaming: false,
            provider,
            model,
          })
        }
        setIsStreaming(false)
        stopStreamRef.current = null
      },
      (err) => {
        // Fallback to non-streaming
        chatApi.send({
          conversation_id: convId!,
          message: msg,
          model: selectedModel,
          provider: selectedProvider,
          temperature,
          max_tokens: maxTokens,
          system_prompt: systemPrompt || undefined,
          user_id: userId,
        })
          .then(r => {
            updateMessage(convId!, assistantMsgId, {
              content: r.data.content,
              provider: r.data.provider,
              model: r.data.model,
              isStreaming: false,
            })
          })
          .catch(e2 => {
            updateMessage(convId!, assistantMsgId, {
              content: `Error: ${e2.message || 'Failed to get response'}`,
              isStreaming: false,
            })
            toast.error('Chat failed: ' + (e2.message || 'Unknown error'))
          })
          .finally(() => {
            setIsStreaming(false)
            stopStreamRef.current = null
          })
      }
    )
  }

  const handleStop = () => {
    if (stopStreamRef.current) {
      stopStreamRef.current()
      stopStreamRef.current = null
    }
    setIsStreaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 bg-brand-600/20 rounded-full flex items-center justify-center mb-4">
              <Zap size={28} className="text-brand-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Onehands AI Chat</h2>
            <p className="text-dark-400 max-w-md text-sm leading-relaxed">
              Multi-provider LLM with auto-fallback. Supports Gemini, SambaNova & GitHub Models.
              Streaming responses, persistent conversations.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {[
                "What can you help me build?",
                "Explain async/await in Python",
                "Write a React component for a modal",
                "How does Retrieval-Augmented Generation work?",
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  className="text-xs px-3 py-1.5 rounded-full bg-dark-800 hover:bg-dark-700 
                             text-dark-300 hover:text-white border border-dark-700 
                             transition-colors duration-150"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {!localConvId && (
              <button onClick={handleNewChat} className="mt-4 btn-secondary text-sm flex items-center gap-2">
                <PlusCircle size={14} />
                Start New Conversation
              </button>
            )}
          </div>
        ) : (
          <>
            {currentMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-brand-600/20 border border-brand-600/30 
                                  flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot size={14} className="text-brand-400" />
                  </div>
                )}

                <div className={`
                  max-w-3xl rounded-xl px-4 py-3
                  ${msg.role === 'user'
                    ? 'bg-brand-600 text-white ml-12'
                    : 'bg-dark-900 border border-dark-800 mr-12'
                  }
                `}>
                  {/* Header */}
                  {msg.role === 'assistant' && (msg.provider || msg.model) && (
                    <div className="flex items-center gap-2 mb-2">
                      {msg.provider && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PROVIDER_BADGES[msg.provider] || 'bg-dark-800 text-dark-300 border-dark-700'}`}>
                          {msg.provider}
                        </span>
                      )}
                      {msg.model && (
                        <span className="text-xs text-dark-500">{msg.model}</span>
                      )}
                    </div>
                  )}

                  {/* Content */}
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                          code: ({ className, children, ...props }: any) => {
                            const isInline = !className
                            if (isInline) {
                              return <code className="bg-dark-800 text-purple-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>
                            }
                            return (
                              <div className="relative group">
                                <code className={className} {...props}>{children}</code>
                                <button
                                  onClick={() => navigator.clipboard.writeText(String(children))}
                                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 
                                             p-1 bg-dark-700 rounded text-dark-300 hover:text-white transition-all"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            )
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5 rounded-sm" />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}

                  {/* Footer actions */}
                  {msg.role === 'assistant' && !msg.isStreaming && (
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-dark-700/50">
                      <CopyButton text={msg.content} />
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-dark-700 border border-dark-600 
                                  flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={14} className="text-dark-300" />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-dark-800 bg-dark-950 p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Onehands AI... (Shift+Enter for new line)"
              disabled={isStreaming}
              rows={1}
              className="input-field resize-none min-h-[44px] max-h-40 py-3 pr-12 text-sm
                         disabled:opacity-50"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
            />
          </div>

          <div className="flex gap-2 flex-shrink-0">
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="p-3 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                title="Stop generation"
              >
                <StopCircle size={18} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-3 btn-primary rounded-lg disabled:opacity-40"
                title="Send message (Enter)"
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4 mt-2 text-xs text-dark-500">
          <span className={PROVIDER_COLORS[selectedProvider] || 'text-dark-400'}>
            {selectedProvider}
          </span>
          <span>·</span>
          <span>{selectedModel}</span>
          <span>·</span>
          <span>temp: {temperature}</span>
          {isStreaming && (
            <>
              <span>·</span>
              <span className="text-brand-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                streaming...
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
