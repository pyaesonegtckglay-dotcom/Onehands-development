import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tab = 'chat' | 'agent' | 'execute' | 'memory' | 'settings' | 'health' | 'dev' | 'connector'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  provider?: string
  model?: string
  timestamp: number
  isStreaming?: boolean
}

export interface Conversation {
  id: string
  title: string
  user_id?: string
  model?: string
  provider?: string
  created_at?: number
  updated_at?: number
}

export interface AgentStep {
  step: number
  thought: string
  action?: string
  action_input?: any
  observation?: string
  provider?: string
  model?: string
  final_answer?: string
}

export interface AgentResult {
  task_id: string
  task: string
  steps_taken: number
  history: AgentStep[]
  final_answer?: string
  status: string
  duration_ms?: number
}

export interface ExecutionResult {
  stdout: string
  stderr: string
  exit_code: number
  error?: string
  language: string
  duration_ms?: number
  sandbox?: string
}

export interface MemoryItem {
  id: string
  user_id: string
  content: string
  memory_type: string
  key?: string
  importance: number
  created_at: number
}

export type ActiveTab = 'chat' | 'agent' | 'execute' | 'memory' | 'settings' | 'health' | 'dev' | 'phase10'
export type Provider = 'gemini' | 'sambanova' | 'github_llm'

interface AppSettings {
  backendUrl: string
  provider: string
  model: string
  temperature: number
  maxTokens: number
  maxSteps: number
  autoExecuteCode: boolean
  useMemory: boolean
  systemPrompt: string
  // API keys (stored locally)
  geminiKey: string
  githubToken: string
  sambaNovaKey: string
  e2bApiKey: string
  hfToken: string
  vercelToken: string
  githubRepoDefault: string
}

interface AppState {
  // UI
  activeTab: ActiveTab
  sidebarOpen: boolean
  setActiveTab: (tab: ActiveTab) => void
  setSidebarOpen: (open: boolean) => void

  // User
  userId: string
  setUserId: (id: string) => void

  // Conversations
  conversations: Conversation[]
  activeConversationId: string | null
  setConversations: (convs: Conversation[]) => void
  setActiveConversation: (id: string | null) => void
  addConversation: (conv: Conversation) => void
  removeConversation: (id: string) => void

  // Chat messages (current conversation)
  messages: Message[]
  setMessages: (msgs: Message[]) => void
  addMessage: (msg: Message) => void
  updateLastMessage: (patch: Partial<Message>) => void
  clearMessages: () => void

  // Agent
  agentResult: AgentResult | null
  agentRunning: boolean
  setAgentResult: (result: AgentResult | null) => void
  setAgentRunning: (running: boolean) => void

  // Execute
  lastExecution: ExecutionResult | null
  setLastExecution: (result: ExecutionResult | null) => void

  // Memory
  memories: MemoryItem[]
  setMemories: (mems: MemoryItem[]) => void
  addMemory: (mem: MemoryItem) => void

  // Tasks
  activeTasks: Record<string, any>
  setTask: (id: string, task: any) => void
  removeTask: (id: string) => void

  // Settings
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void

  // Health
  healthData: any
  setHealthData: (data: any) => void
}

const DEFAULT_SETTINGS: AppSettings = {
  backendUrl: 'https://pyae1994-openhands-genspark-agent.hf.space',
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  temperature: 0.7,
  maxTokens: 4096,
  maxSteps: 10,
  autoExecuteCode: true,
  useMemory: true,
  systemPrompt: '',
  geminiKey: '',
  githubToken: '',
  sambaNovaKey: '',
  e2bApiKey: '',
  hfToken: '',
  vercelToken: '',
  githubRepoDefault: '',
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // UI
      activeTab: 'chat',
      sidebarOpen: true,
      setActiveTab: (tab) => set({ activeTab: tab }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      // User
      userId: `user_${Math.random().toString(36).slice(2, 10)}`,
      setUserId: (id) => set({ userId: id }),

      // Conversations
      conversations: [],
      activeConversationId: null,
      setConversations: (convs) => set({ conversations: convs }),
      setActiveConversation: (id) => set({ activeConversationId: id }),
      addConversation: (conv) =>
        set((s) => ({ conversations: [conv, ...s.conversations] })),
      removeConversation: (id) =>
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        })),

      // Chat
      messages: [],
      setMessages: (msgs) => set({ messages: msgs }),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastMessage: (patch) =>
        set((s) => {
          const msgs = [...s.messages]
          if (msgs.length > 0) {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch }
          }
          return { messages: msgs }
        }),
      clearMessages: () => set({ messages: [] }),

      // Agent
      agentResult: null,
      agentRunning: false,
      setAgentResult: (result) => set({ agentResult: result }),
      setAgentRunning: (running) => set({ agentRunning: running }),

      // Execute
      lastExecution: null,
      setLastExecution: (result) => set({ lastExecution: result }),

      // Memory
      memories: [],
      setMemories: (mems) => set({ memories: mems }),
      addMemory: (mem) => set((s) => ({ memories: [mem, ...s.memories] })),

      // Tasks
      activeTasks: {},
      setTask: (id, task) =>
        set((s) => ({ activeTasks: { ...s.activeTasks, [id]: task } })),
      removeTask: (id) =>
        set((s) => {
          const t = { ...s.activeTasks }
          delete t[id]
          return { activeTasks: t }
        }),

      // Settings
      settings: DEFAULT_SETTINGS,
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      // Health
      healthData: null,
      setHealthData: (data) => set({ healthData: data }),
    }),
    {
      name: 'onehands-store-v3',
      partialize: (state) => ({
        userId: state.userId,
        settings: state.settings,
        sidebarOpen: state.sidebarOpen,
        conversations: state.conversations.slice(0, 50),
      }),
    }
  )
)
