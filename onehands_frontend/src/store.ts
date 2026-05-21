import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  id: string
  role: MessageRole
  content: string
  provider?: string
  model?: string
  created_at?: string
  isStreaming?: boolean
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  tool: string
  input: Record<string, unknown>
  output?: string
  status?: string
  duration_ms?: number
}

export interface TraceStep {
  step: number
  type: 'thought' | 'tool_call' | 'execution' | 'error' | 'final_answer'
  content?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  status?: string
  error?: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  provider: string
  task_type: string
  created_at?: string
  updated_at?: string
  user_id?: string
}

export interface Memory {
  id: string
  content: string
  memory_type: string
  key?: string
  importance: number
  created_at?: string
}

export type ActiveTab = 'chat' | 'agent' | 'execute' | 'memory' | 'settings' | 'health' | 'dev' | 'phase10'
export type Provider = 'gemini' | 'sambanova' | 'github_llm'

interface AppState {
  // UI
  activeTab: ActiveTab
  sidebarOpen: boolean
  darkMode: boolean
  
  // User
  userId: string
  
  // Conversations
  conversations: Conversation[]
  activeConversationId: string | null
  
  // Messages
  messages: Record<string, Message[]>
  
  // Agent
  agentRunning: boolean
  agentSteps: number
  agentTrace: TraceStep[]
  agentFinalAnswer: string
  
  // Code execution
  codeOutput: string
  codeError: string
  codeRunning: boolean
  
  // Memory
  memories: Memory[]
  
  // Models
  selectedModel: string
  selectedProvider: Provider
  temperature: number
  maxTokens: number
  systemPrompt: string
  
  // Loading states
  isLoading: boolean
  isStreaming: boolean
  
  // Health
  healthStatus: Record<string, unknown> | null

  // Actions
  setActiveTab: (tab: ActiveTab) => void
  setSidebarOpen: (open: boolean) => void
  setUserId: (id: string) => void
  setConversations: (convs: Conversation[]) => void
  addConversation: (conv: Conversation) => void
  removeConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  addMessage: (convId: string, msg: Message) => void
  updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => void
  setMessages: (convId: string, msgs: Message[]) => void
  setAgentRunning: (running: boolean) => void
  setAgentSteps: (steps: number) => void
  addAgentTrace: (step: TraceStep) => void
  clearAgentTrace: () => void
  setAgentFinalAnswer: (answer: string) => void
  setCodeOutput: (out: string) => void
  setCodeError: (err: string) => void
  setCodeRunning: (running: boolean) => void
  setMemories: (mems: Memory[]) => void
  addMemory: (mem: Memory) => void
  setSelectedModel: (model: string) => void
  setSelectedProvider: (provider: Provider) => void
  setTemperature: (t: number) => void
  setMaxTokens: (t: number) => void
  setSystemPrompt: (p: string) => void
  setIsLoading: (l: boolean) => void
  setIsStreaming: (s: boolean) => void
  setHealthStatus: (h: Record<string, unknown>) => void
}

const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // UI
      activeTab: 'chat',
      sidebarOpen: true,
      darkMode: true,
      
      // User
      userId: (() => {
        const stored = localStorage.getItem('onehands_user_id')
        if (stored) return stored
        const newId = `user_${generateId()}`
        localStorage.setItem('onehands_user_id', newId)
        return newId
      })(),
      
      // Conversations
      conversations: [],
      activeConversationId: null,
      
      // Messages
      messages: {},
      
      // Agent
      agentRunning: false,
      agentSteps: 0,
      agentTrace: [],
      agentFinalAnswer: '',
      
      // Code
      codeOutput: '',
      codeError: '',
      codeRunning: false,
      
      // Memory
      memories: [],
      
      // Models
      selectedModel: 'gemini-2.0-flash',
      selectedProvider: 'gemini',
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: '',
      
      // Loading
      isLoading: false,
      isStreaming: false,
      
      // Health
      healthStatus: null,

      // Actions
      setActiveTab: (tab) => set({ activeTab: tab }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setUserId: (id) => {
        localStorage.setItem('onehands_user_id', id)
        set({ userId: id })
      },
      setConversations: (convs) => set({ conversations: convs }),
      addConversation: (conv) => set((s) => ({
        conversations: [conv, ...s.conversations.filter(c => c.id !== conv.id)]
      })),
      removeConversation: (id) => set((s) => ({
        conversations: s.conversations.filter(c => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      })),
      setActiveConversation: (id) => set({ activeConversationId: id }),
      addMessage: (convId, msg) => set((s) => ({
        messages: {
          ...s.messages,
          [convId]: [...(s.messages[convId] || []), msg],
        }
      })),
      updateMessage: (convId, msgId, updates) => set((s) => ({
        messages: {
          ...s.messages,
          [convId]: (s.messages[convId] || []).map(m =>
            m.id === msgId ? { ...m, ...updates } : m
          ),
        }
      })),
      setMessages: (convId, msgs) => set((s) => ({
        messages: { ...s.messages, [convId]: msgs }
      })),
      setAgentRunning: (running) => set({ agentRunning: running }),
      setAgentSteps: (steps) => set({ agentSteps: steps }),
      addAgentTrace: (step) => set((s) => ({ agentTrace: [...s.agentTrace, step] })),
      clearAgentTrace: () => set({ agentTrace: [], agentFinalAnswer: '', agentSteps: 0 }),
      setAgentFinalAnswer: (answer) => set({ agentFinalAnswer: answer }),
      setCodeOutput: (out) => set({ codeOutput: out }),
      setCodeError: (err) => set({ codeError: err }),
      setCodeRunning: (running) => set({ codeRunning: running }),
      setMemories: (mems) => set({ memories: mems }),
      addMemory: (mem) => set((s) => ({ memories: [mem, ...s.memories] })),
      setSelectedModel: (model) => set({ selectedModel: model }),
      setSelectedProvider: (provider) => set({ selectedProvider: provider }),
      setTemperature: (t) => set({ temperature: t }),
      setMaxTokens: (t) => set({ maxTokens: t }),
      setSystemPrompt: (p) => set({ systemPrompt: p }),
      setIsLoading: (l) => set({ isLoading: l }),
      setIsStreaming: (s) => set({ isStreaming: s }),
      setHealthStatus: (h) => set({ healthStatus: h }),
    }),
    {
      name: 'onehands-store',
      partialize: (state) => ({
        userId: state.userId,
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        systemPrompt: state.systemPrompt,
        sidebarOpen: state.sidebarOpen,
        conversations: state.conversations.slice(0, 50),
      })
    }
  )
)
