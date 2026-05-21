import axios from 'axios'

// Backend URL - configurable
export const BACKEND_URL = 
  (import.meta as any).env?.VITE_BACKEND_URL || 
  'https://pyae1994-openhands-genspark-agent.hf.space'

export const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 180000,
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

// ── Existing API Methods ──────────────────────────────────────────────────────

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

// ── Phase 9 API Methods ───────────────────────────────────────────────────────

export const devApi = {
  // 9.1 Code generation
  generate: (data: {
    description: string
    stack?: string
    include_tests?: boolean
    include_dockerfile?: boolean
    model?: string
    provider?: string
    user_id?: string
  }) => api.post('/dev/generate', data),

  stacks: () => api.get('/dev/stacks'),

  // 9.2 GitHub operations
  github: (data: {
    operation: string
    repo?: string
    branch?: string
    new_branch?: string
    commit_message?: string
    files?: Record<string, string>
    pr_title?: string
    pr_body?: string
    base_branch?: string
    path?: string
    description?: string
    private?: boolean
    user_id?: string
    github_token?: string
  }) => api.post('/dev/github', data),

  // 9.4 Deployment
  deploy: (data: {
    platform: string
    project_name: string
    files: Record<string, string>
    framework?: string
    env_vars?: Record<string, string>
    description?: string
    user_id?: string
    vercel_token?: string
    hf_token?: string
    hf_space_name?: string
  }) => api.post('/dev/deploy', data),

  // 9.5 Tests
  test: (data: {
    code: string
    language?: string
    framework?: string
    test_type?: string
    auto_generate?: boolean
    model?: string
    provider?: string
    user_id?: string
  }) => api.post('/dev/test', data),

  // 9.8 Code review
  review: (data: {
    code: string
    language?: string
    context?: string
    review_type?: string
    model?: string
    provider?: string
    user_id?: string
  }) => api.post('/dev/review', data),

  // 9.9 Full workflow
  workflow: (data: {
    description: string
    stack?: string
    deploy_to?: string
    project_name?: string
    run_tests?: boolean
    model?: string
    provider?: string
    user_id?: string
    github_token?: string
    vercel_token?: string
    hf_token?: string
    github_repo?: string
  }) => api.post('/dev/workflow', data),

  // Metrics
  metrics: () => api.get('/dev/metrics'),
}

// 9.3 Task Queue
export const tasksApi = {
  submit: (data: {
    task_type: string
    payload: Record<string, unknown>
    user_id?: string
  }) => api.post('/tasks', data),

  get: (taskId: string) => api.get(`/tasks/${taskId}`),
  getResult: (taskId: string) => api.get(`/tasks/${taskId}/result`),
  list: (userId?: string, limit?: number) => 
    api.get('/tasks', { params: { user_id: userId || 'anonymous', limit: limit || 20 } }),
}

// 9.6 Workspace
export const workspaceApi = {
  createFile: (data: { filename: string; content: string; user_id?: string }) =>
    api.post('/workspace/files', data),

  listFiles: (userId?: string) =>
    api.get('/workspace/files', { params: { user_id: userId || 'anonymous' } }),

  getFile: (filename: string, userId?: string) =>
    api.get(`/workspace/files/${encodeURIComponent(filename)}`, {
      params: { user_id: userId || 'anonymous' }
    }),

  deleteFile: (filename: string, userId?: string) =>
    api.delete(`/workspace/files/${encodeURIComponent(filename)}`, {
      params: { user_id: userId || 'anonymous' }
    }),
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

// Task polling helper
export function pollTask(
  taskId: string,
  onProgress: (task: any) => void,
  onComplete: (result: any) => void,
  onError: (err: string) => void,
  intervalMs = 2000,
  maxWaitMs = 300000
): () => void {
  let stopped = false
  let elapsed = 0

  const poll = async () => {
    while (!stopped && elapsed < maxWaitMs) {
      try {
        const resp = await tasksApi.get(taskId)
        const task = resp.data
        onProgress(task)
        
        if (task.status === 'success') {
          // Fetch full result
          const resultResp = await tasksApi.getResult(taskId)
          onComplete(resultResp.data)
          return
        } else if (task.status === 'failed') {
          onError(task.error || 'Task failed')
          return
        }
      } catch (e: any) {
        // ignore polling errors, keep trying
      }
      await new Promise(r => setTimeout(r, intervalMs))
      elapsed += intervalMs
    }
    if (!stopped) onError('Task timed out')
  }

  poll()
  return () => { stopped = true }
}
