import axios from 'axios'

// Backend URL - configurable
export const BACKEND_URL = 
  (import.meta as any).env?.VITE_BACKEND_URL || 
  'https://pyae1994-openhands-genspark-agent.hf.space'

export const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use((config) => {
  const userId = localStorage.getItem('onehands_user_id') || 'anonymous'
  config.headers['X-User-ID'] = userId
  return config
})

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const msg = error.response.data?.detail || error.response.data?.error || error.message
      console.error(`API Error ${error.response.status}:`, msg)
    } else if (error.request) {
      console.error('Network error:', error.message)
    }
    return Promise.reject(error)
  }
)

// ── API Methods ──────────────────────────────────────────────────────────────

export const healthApi = {
  check: () => api.get('/health'),
  keys: () => api.get('/health/keys'),
  reloadKeys: () => api.post('/health/reload-keys'),
}

export const modelsApi = {
  list: () => api.get('/models'),
}

export const conversationsApi = {
  create: (data: {
    user_id?: string
    title?: string
    model?: string
    provider?: string
    task_type?: string
  }) => api.post('/conversations', data),

  list: (userId?: string) => 
    api.get('/conversations', { params: { user_id: userId || 'anonymous' } }),

  get: (id: string) => api.get(`/conversations/${id}`),

  getMessages: (id: string) => api.get(`/conversations/${id}/messages`),

  getExecutions: (id: string) => api.get(`/conversations/${id}/executions`),

  getToolCalls: (id: string) => api.get(`/conversations/${id}/tool-calls`),

  delete: (id: string) => api.delete(`/conversations/${id}`),
}

export const chatApi = {
  send: (data: {
    conversation_id?: string
    message: string
    model?: string
    provider?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    auto_fallback?: boolean
    user_id?: string
  }) => api.post('/chat', data),

  streamUrl: (convId?: string) => {
    if (convId) return `${BACKEND_URL}/chat/stream/${convId}`
    return `${BACKEND_URL}/chat/stream`
  },
}

export const executeApi = {
  run: (data: {
    conversation_id?: string
    code: string
    language?: string
    timeout?: number
  }) => api.post('/execute', data),
}

export const agentApi = {
  runTask: (data: {
    task: string
    conversation_id?: string
    model?: string
    provider?: string
    max_steps?: number
    execute_code?: boolean
    user_id?: string
    use_memory?: boolean
    system_prompt?: string
  }) => api.post('/agent/task', data),

  createPlan: (data: {
    task: string
    conversation_id?: string
    model?: string
    provider?: string
    user_id?: string
  }) => api.post('/agent/plan', data),
}

export const memoryApi = {
  save: (data: {
    user_id?: string
    content: string
    memory_type?: string
    key?: string
    importance?: number
    conv_id?: string
  }) => api.post('/memory', data),

  get: (params: {
    user_id?: string
    conv_id?: string
    memory_type?: string
    limit?: number
  }) => api.get('/memory', { params }),
}

export const toolsApi = {
  list: () => api.get('/tools'),
  execute: (data: {
    tool_name: string
    tool_input?: Record<string, unknown>
    conversation_id?: string
  }) => api.post('/tools/execute', data),
}

// Streaming chat with SSE
export function streamChat(
  data: {
    conversation_id?: string
    message: string
    model?: string
    provider?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    user_id?: string
  },
  onChunk: (chunk: string) => void,
  onDone: (convId: string, provider: string, model: string) => void,
  onError: (err: string) => void
): () => void {
  let aborted = false
  
  const runStream = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: undefined,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue
            try {
              const event = JSON.parse(jsonStr)
              if (event.type === 'chunk' && event.content) {
                onChunk(event.content)
              } else if (event.type === 'done') {
                onDone(event.conv_id || '', event.provider || '', event.model || '')
              } else if (event.type === 'error') {
                onError(event.error || 'Unknown error')
              }
            } catch (e) {
              // ignore parse errors
            }
          }
        }
      }
    } catch (err: any) {
      if (!aborted) {
        onError(err.message || 'Stream error')
      }
    }
  }

  runStream()

  return () => { aborted = true }
}
