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

export type ActiveTab =
  | 'chat'
  | 'agent'
  | 'execute'
  | 'memory'
  | 'settings'
  | 'health'
  | 'dev'
  | 'connector'

export type Provider = 'gemini' | 'sambanova' | 'github_llm' | 'openai' | 'anthropic' | 'groq' | 'openrouter'

// ─── Universal Connector Types ────────────────────────────────────────────────

export type ConnectorPlatform =
  | 'github'
  | 'gitlab'
  | 'jira'
  | 'notion'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'linear'
  | 'trello'
  | 'figma'
  | 'vercel'
  | 'netlify'
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'heroku'
  | 'railway'
  | 'supabase'
  | 'firebase'
  | 'mongodb'
  | 'postgres'
  | 'redis'
  | 'huggingface'
  | 'openai_api'
  | 'anthropic_api'
  | 'groq_api'
  | 'e2b'
  | 'browserbase'
  | 'zapier'
  | 'custom'

export interface ConnectorConfig {
  platform: ConnectorPlatform
  name: string
  token?: string
  apiKey?: string
  baseUrl?: string
  workspace?: string
  projectId?: string
  extraConfig?: Record<string, string>
  connected: boolean
  lastTestedAt?: string
  status?: 'ok' | 'error' | 'testing'
  error?: string
}

// ─── Settings sub-tabs
export type SettingsTab =
  | 'llm'
  | 'api_keys'
  | 'agent'
  | 'ui'
  | 'system'
  | 'about'

interface AppState {
  // UI
  activeTab: ActiveTab
  sidebarOpen: boolean
  darkMode: boolean

  // Settings sub-tabs
  settingsTab: SettingsTab

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
  agentMaxSteps: number
  agentAutoExecute: boolean
  agentMemoryEnabled: boolean

  // Code execution
  codeOutput: string
  codeError: string
  codeRunning: boolean

  // Memory
  memories: Memory[]

  // Models / LLM Config
  selectedModel: string
  selectedProvider: Provider
  temperature: number
  maxTokens: number
  systemPrompt: string

  // API Keys (stored in settings)
  apiKeys: {
    gemini: string[]
    sambanova: string[]
    github_llm: string[]
    openai: string[]
    anthropic: string[]
    groq: string[]
    openrouter: string[]
    e2b: string
    github_token: string
    hf_token: string
    vercel_token: string
    supabase_url: string
    supabase_key: string
    redis_url: string
  }

  // Universal Connectors
  connectors: Record<ConnectorPlatform, ConnectorConfig>

  // Loading states
  isLoading: boolean
  isStreaming: boolean

  // Health
  healthStatus: Record<string, unknown> | null

  // Actions ─────────────────────────────────────────────────────────────
  setActiveTab: (tab: ActiveTab) => void
  setSettingsTab: (tab: SettingsTab) => void
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
  setAgentMaxSteps: (n: number) => void
  setAgentAutoExecute: (v: boolean) => void
  setAgentMemoryEnabled: (v: boolean) => void

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

  updateApiKeys: (keys: Partial<AppState['apiKeys']>) => void

  setConnector: (platform: ConnectorPlatform, config: Partial<ConnectorConfig>) => void
  removeConnector: (platform: ConnectorPlatform) => void
  testConnector: (platform: ConnectorPlatform) => void

  setIsLoading: (l: boolean) => void
  setIsStreaming: (s: boolean) => void
  setHealthStatus: (h: Record<string, unknown>) => void
}

const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

// Default connector configs
const defaultConnectors: Record<ConnectorPlatform, ConnectorConfig> = {} as any
const connectorPlatforms: ConnectorPlatform[] = [
  'github', 'gitlab', 'jira', 'notion', 'slack', 'discord', 'telegram',
  'linear', 'trello', 'figma', 'vercel', 'netlify', 'aws', 'gcp', 'azure',
  'heroku', 'railway', 'supabase', 'firebase', 'mongodb', 'postgres', 'redis',
  'huggingface', 'openai_api', 'anthropic_api', 'groq_api', 'e2b', 'browserbase',
  'zapier', 'custom'
]
for (const p of connectorPlatforms) {
  defaultConnectors[p] = { platform: p, name: p, connected: false }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // UI
      activeTab: 'chat',
      sidebarOpen: true,
      darkMode: true,
      settingsTab: 'llm',

      // User
      userId: (() => {
        try {
          const stored = localStorage.getItem('onehands_user_id')
          if (stored) return stored
          const newId = `user_${generateId()}`
          localStorage.setItem('onehands_user_id', newId)
          return newId
        } catch { return `user_${generateId()}` }
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
      agentMaxSteps: 25,
      agentAutoExecute: true,
      agentMemoryEnabled: true,

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

      // API Keys (empty by default, user fills in settings)
      apiKeys: {
        gemini: [],
        sambanova: [],
        github_llm: [],
        openai: [],
        anthropic: [],
        groq: [],
        openrouter: [],
        e2b: '',
        github_token: '',
        hf_token: '',
        vercel_token: '',
        supabase_url: '',
        supabase_key: '',
        redis_url: '',
      },

      // Connectors
      connectors: defaultConnectors,

      // Loading
      isLoading: false,
      isStreaming: false,

      // Health
      healthStatus: null,

      // ─── Actions ──────────────────────────────────────────────────────────

      setActiveTab: (tab) => set({ activeTab: tab }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setUserId: (id) => {
        try { localStorage.setItem('onehands_user_id', id) } catch {}
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
      setAgentMaxSteps: (n) => set({ agentMaxSteps: n }),
      setAgentAutoExecute: (v) => set({ agentAutoExecute: v }),
      setAgentMemoryEnabled: (v) => set({ agentMemoryEnabled: v }),

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

      updateApiKeys: (keys) => set((s) => ({ apiKeys: { ...s.apiKeys, ...keys } })),

      setConnector: (platform, config) => set((s) => ({
        connectors: {
          ...s.connectors,
          [platform]: { ...s.connectors[platform], ...config, platform }
        }
      })),
      removeConnector: (platform) => set((s) => ({
        connectors: {
          ...s.connectors,
          [platform]: { ...defaultConnectors[platform] }
        }
      })),
      testConnector: async (platform) => {
        set((s) => ({
          connectors: { ...s.connectors, [platform]: { ...s.connectors[platform], status: 'testing' } }
        }))
        // Simulate test – real test happens in ConnectorPanel
        await new Promise(r => setTimeout(r, 1000))
        set((s) => ({
          connectors: {
            ...s.connectors,
            [platform]: {
              ...s.connectors[platform],
              status: s.connectors[platform].token || s.connectors[platform].apiKey ? 'ok' : 'error',
              connected: !!(s.connectors[platform].token || s.connectors[platform].apiKey),
              lastTestedAt: new Date().toISOString(),
            }
          }
        }))
      },

      setIsLoading: (l) => set({ isLoading: l }),
      setIsStreaming: (s) => set({ isStreaming: s }),
      setHealthStatus: (h) => set({ healthStatus: h }),
    }),
    {
      name: 'onehands-store-v2',
      partialize: (state) => ({
        userId: state.userId,
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        systemPrompt: state.systemPrompt,
        sidebarOpen: state.sidebarOpen,
        settingsTab: state.settingsTab,
        conversations: state.conversations.slice(0, 50),
        apiKeys: state.apiKeys,
        connectors: state.connectors,
        agentMaxSteps: state.agentMaxSteps,
        agentAutoExecute: state.agentAutoExecute,
        agentMemoryEnabled: state.agentMemoryEnabled,
      })
    }
  )
)
