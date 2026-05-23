import axios from 'axios'

// Backend URL - configurable from env or localStorage
function getBackendUrl(): string {
  // 1. Vite env var (set at build time)
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL
  if (envUrl) return envUrl
  // 2. localStorage override (runtime configurable)
  try {
    const stored = localStorage.getItem('onehands_backend_url')
    if (stored) return stored
  } catch {}
  // 3. Default
  return 'https://pyae1994-openhands-genspark-agent.hf.space'
}

export let BACKEND_URL = getBackendUrl()

export function setBackendUrl(url: string) {
  BACKEND_URL = url
  api.defaults.baseURL = url
  try { localStorage.setItem('onehands_backend_url', url) } catch {}
}

export const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 180000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor
api.interceptors.request.use((config) => {
  try {
    const userId = localStorage.getItem('onehands_user_id') || 'anonymous'
    config.headers['X-User-ID'] = userId
  } catch {}
  return config
})

// Response interceptor
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response) {
      const msg = err.response.data?.detail || err.response.data?.error || err.message
      console.error(`API Error ${err.response.status}:`, msg)
    } else {
      console.error('Network error:', err.message)
    }
    return Promise.reject(err)
  }
)

// ── Health ────────────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => api.get('/health'),
  keys: () => api.get('/health/keys'),
  reloadKeys: () => api.post('/health/reload-keys'),
  env: () => api.get('/debug/env'),
}

// ── Models ────────────────────────────────────────────────────────────────────
export const modelsApi = {
  list: () => api.get('/models'),
}

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversationsApi = {
  create: (data: { user_id?: string; title?: string; model?: string; provider?: string }) =>
    api.post('/conversations', data),
  list: (userId?: string) =>
    api.get('/conversations', { params: { user_id: userId || 'anonymous' } }),
  get: (id: string) => api.get(`/conversations/${id}`),
  getMessages: (id: string) => api.get(`/conversations/${id}/messages`),
  delete: (id: string) => api.delete(`/conversations/${id}`),
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chatApi = {
  send: (data: {
    conversation_id?: string
    message: string
    model?: string
    provider?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    user_id?: string
  }) => api.post('/chat', data),
}

// ── Agent ─────────────────────────────────────────────────────────────────────
export const agentApi = {
  task: (data: {
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

  plan: (data: { task: string; provider?: string; model?: string; user_id?: string }) =>
    api.post('/agent/plan', data),
}

// ── Execute ───────────────────────────────────────────────────────────────────
export const executeApi = {
  run: (data: { code: string; language?: string; timeout?: number; conversation_id?: string }) =>
    api.post('/execute', data),
}

// ── Memory ────────────────────────────────────────────────────────────────────
export const memoryApi = {
  save: (data: { user_id?: string; content: string; memory_type?: string; key?: string; importance?: number }) =>
    api.post('/memory', data),
  list: (userId?: string, limit?: number) =>
    api.get('/memory', { params: { user_id: userId || 'anonymous', limit: limit || 20 } }),
}

// ── Tools ─────────────────────────────────────────────────────────────────────
export const toolsApi = {
  list: () => api.get('/tools'),
  execute: (tool_name: string, tool_input: Record<string, any>, user_id?: string) =>
    api.post('/tools/execute', { tool_name, tool_input, user_id: user_id || 'anonymous' }),
}

// ── Developer ─────────────────────────────────────────────────────────────────
export const devApi = {
  generate: (data: {
    description: string
    stack?: string
    include_tests?: boolean
    model?: string
    provider?: string
    user_id?: string
  }) => api.post('/dev/generate', data),

  stacks: () => api.get('/dev/stacks'),

  workflow: (data: {
    description: string
    stack?: string
    provider?: string
    model?: string
    user_id?: string
    github_token?: string
    github_repo?: string
    vercel_token?: string
    hf_token?: string
    deploy_to?: string
    run_tests?: boolean
  }) => api.post('/dev/workflow', data),

  github: (data: {
    operation: string
    github_token?: string
    repo?: string
    repo_name?: string
    files?: Record<string, string>
    message?: string
    branch?: string
    title?: string
    body?: string
    head?: string
    base?: string
    description?: string
    private?: boolean
  }) => api.post('/dev/github', data),

  deploy: (data: {
    target: string
    project_name: string
    files: Record<string, string>
    vercel_token?: string
    hf_token?: string
    space_id?: string
  }) => api.post('/dev/deploy', data),

  explain: (code: string, language?: string) =>
    api.post('/dev/explain', { operation: 'explain', code, language }),
  refactor: (code: string, language?: string) =>
    api.post('/dev/refactor', { operation: 'refactor', code, language }),
  debug: (code: string, language?: string, context?: string) =>
    api.post('/dev/debug', { operation: 'debug', code, language, context }),
  review: (code: string, language?: string) =>
    api.post('/dev/review', { operation: 'review', code, language }),
  convert: (code: string, language?: string, context?: string) =>
    api.post('/dev/convert', { operation: 'convert', code, language, context }),

  metrics: () => api.get('/dev/metrics'),
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const tasksApi = {
  submit: (task_type: string, payload: Record<string, any>, user_id?: string) =>
    api.post('/tasks', { task_type, payload, user_id: user_id || 'anonymous' }),
  get: (task_id: string) => api.get(`/tasks/${task_id}`),
  result: (task_id: string) => api.get(`/tasks/${task_id}/result`),
  list: (user_id?: string) =>
    api.get('/tasks', { params: { user_id: user_id || 'anonymous' } }),
}

// ── Workspace ─────────────────────────────────────────────────────────────────
export const workspaceApi = {
  create: (filename: string, content: string, user_id?: string) =>
    api.post('/workspace/files', { filename, content, user_id: user_id || 'anonymous' }),
  list: (user_id?: string) =>
    api.get('/workspace/files', { params: { user_id: user_id || 'anonymous' } }),
  read: (filename: string, user_id?: string) =>
    api.get(`/workspace/files/${filename}`, { params: { user_id: user_id || 'anonymous' } }),
  delete: (filename: string, user_id?: string) =>
    api.delete(`/workspace/files/${filename}`, { params: { user_id: user_id || 'anonymous' } }),
}

// ── SSE Streaming Chat ────────────────────────────────────────────────────────
export function streamChat(
  params: {
    message: string
    conversation_id?: string
    model?: string
    provider?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    user_id?: string
  },
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: string) => void
): () => void {
  let cancelled = false
  let fullText = ''

  const run = async () => {
    try {
      const resp = await fetch(`${BACKEND_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: undefined,
      })

      if (!resp.ok) {
        onError(`HTTP ${resp.status}: ${resp.statusText}`)
        return
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (cancelled) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'token' && data.content) {
                fullText += data.content
                onToken(data.content)
              } else if (data.type === 'done') {
                onDone(fullText)
                return
              } else if (data.type === 'error') {
                onError(data.message || 'Stream error')
                return
              }
            } catch {}
          }
        }
      }
      onDone(fullText)
    } catch (err: any) {
      if (!cancelled) onError(err.message || 'Stream failed')
    }
  }

  run()
  return () => { cancelled = true }
}

// ── Poll task until done ───────────────────────────────────────────────────────
export async function pollTask(
  taskId: string,
  onProgress: (task: any) => void,
  intervalMs = 2000,
  maxWaitMs = 300000
): Promise<any> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (Date.now() - start > maxWaitMs) {
        clearInterval(interval)
        reject(new Error('Task timed out'))
        return
      }
      try {
        const res = await tasksApi.get(taskId)
        const task = res.data
        onProgress(task)
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(interval)
          resolve(task)
        }
      } catch (err) {
        clearInterval(interval)
        reject(err)
      }
    }, intervalMs)
  })
}
