import React, { useState, useCallback, useEffect, useRef } from 'react'
import { devApi, tasksApi, workspaceApi, pollTask } from '../api'
import { useStore } from '../store'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskProgress {
  task_id: string
  status: string
  progress: number
  progress_steps: { time: number; msg: string }[]
  description: string
  type: string
  has_result: boolean
  error?: string
}

interface GenerateResult {
  project_name: string
  description: string
  stack: string
  files: Record<string, string>
  file_count: number
  features: string[]
  api_endpoints: { method: string; path: string; description: string }[]
  dependencies: string[]
  validation: { status: string; output: string }
}

interface ReviewResult {
  review: {
    overall_score: number
    summary: string
    issues: { severity: string; category: string; description: string; suggestion: string; line?: number }[]
    strengths: string[]
    recommended_improvements: string[]
    estimated_effort: string
  }
  language: string
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-950 border-red-700',
  high: 'text-orange-400 bg-orange-950 border-orange-700',
  medium: 'text-yellow-400 bg-yellow-950 border-yellow-700',
  low: 'text-blue-400 bg-blue-950 border-blue-700',
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-gray-400',
  running: 'text-blue-400',
  success: 'text-green-400',
  failed: 'text-red-400',
}

function TaskProgressPanel({
  task,
  onDone,
}: {
  task: TaskProgress | null
  onDone?: () => void
}) {
  if (!task) return null

  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${STATUS_COLORS[task.status] || 'text-gray-400'}`}>
          {task.status === 'running' && '⚙️ '}
          {task.status === 'success' && '✅ '}
          {task.status === 'failed' && '❌ '}
          {task.status === 'queued' && '⏳ '}
          {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
        </span>
        <span className="text-xs text-dark-400">{task.task_id?.slice(0, 8)}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-dark-800 rounded-full h-2">
        <div
          className="bg-primary-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      <div className="text-xs text-dark-300 text-right">{task.progress}%</div>

      {/* Step log */}
      <div className="max-h-40 overflow-y-auto space-y-1">
        {(task.progress_steps || []).map((step, i) => (
          <div key={i} className="text-xs text-dark-200 font-mono">
            <span className="text-dark-500">{new Date(step.time * 1000).toLocaleTimeString()}</span>{' '}
            {step.msg}
          </div>
        ))}
      </div>

      {task.status === 'failed' && task.error && (
        <div className="text-xs text-red-400 bg-red-950 border border-red-700 rounded p-2">
          ❌ {task.error}
        </div>
      )}
    </div>
  )
}

function FileTree({
  files,
  onSelectFile,
  selectedFile,
}: {
  files: Record<string, string>
  onSelectFile: (name: string) => void
  selectedFile: string | null
}) {
  return (
    <div className="space-y-1">
      {Object.keys(files).map((fname) => (
        <button
          key={fname}
          onClick={() => onSelectFile(fname)}
          className={`w-full text-left px-3 py-1.5 rounded text-xs font-mono truncate hover:bg-dark-700 transition-colors ${
            selectedFile === fname ? 'bg-primary-900 text-primary-300' : 'text-dark-200'
          }`}
        >
          📄 {fname}
        </button>
      ))}
    </div>
  )
}

// ── Generate Tab ──────────────────────────────────────────────────────────────

function GenerateTab() {
  const { selectedModel, selectedProvider, userId } = useStore()
  const [description, setDescription] = useState('')
  const [stack, setStack] = useState('python-fastapi')
  const [includeTests, setIncludeTests] = useState(true)
  const [includeDockerfile, setIncludeDockerfile] = useState(true)
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<TaskProgress | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const stopPollRef = useRef<(() => void) | null>(null)

  const STACKS = [
    { id: 'python-fastapi', label: '🐍 Python FastAPI' },
    { id: 'node-express', label: '🟢 Node.js Express' },
    { id: 'react-vite', label: '⚛️ React + Vite' },
    { id: 'fullstack-python', label: '🔥 Full-Stack Python' },
    { id: 'fullstack-node', label: '🚀 Full-Stack Node' },
  ]

  const handleGenerate = async () => {
    if (!description.trim()) return toast.error('Describe what to build')
    setLoading(true)
    setTask(null)
    setResult(null)
    setSelectedFile(null)
    if (stopPollRef.current) stopPollRef.current()

    try {
      const resp = await devApi.generate({
        description,
        stack,
        include_tests: includeTests,
        include_dockerfile: includeDockerfile,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })

      const taskId = resp.data.task_id
      toast.success('Code generation started!')

      stopPollRef.current = pollTask(
        taskId,
        (t) => setTask(t),
        (res) => {
          setResult(res.result)
          setLoading(false)
          toast.success(`✅ Generated ${res.result.file_count} files!`)
        },
        (err) => {
          setLoading(false)
          toast.error(`Failed: ${err}`)
        }
      )
    } catch (e: any) {
      setLoading(false)
      toast.error(e.response?.data?.detail || e.message)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const content = Object.entries(result.files)
      .map(([fname, code]) => `\n${'='.repeat(60)}\n# ${fname}\n${'='.repeat(60)}\n${code}`)
      .join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.project_name}.txt`
    a.click()
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-dark-200 mb-1">
          What do you want to build?
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. REST API for a todo app with user auth and SQLite database"
          className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-dark-200 mb-2">Stack</label>
        <div className="grid grid-cols-2 gap-2">
          {STACKS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStack(s.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                stack === s.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-dark-800 text-dark-200 hover:bg-dark-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer">
          <input type="checkbox" checked={includeTests} onChange={(e) => setIncludeTests(e.target.checked)} className="accent-primary-500" />
          Include Tests
        </label>
        <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer">
          <input type="checkbox" checked={includeDockerfile} onChange={(e) => setIncludeDockerfile(e.target.checked)} className="accent-primary-500" />
          Include Dockerfile
        </label>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !description.trim()}
        className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-medium transition-colors"
      >
        {loading ? '⚙️ Generating...' : '🚀 Generate Project'}
      </button>

      {task && <TaskProgressPanel task={task} />}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              📦 {result.project_name} — {result.file_count} files
            </h3>
            <button
              onClick={handleDownload}
              className="text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 px-3 py-1 rounded"
            >
              ⬇️ Download All
            </button>
          </div>

          {result.features.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.features.slice(0, 6).map((f, i) => (
                <span key={i} className="text-xs bg-primary-900 text-primary-300 px-2 py-0.5 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 bg-dark-900 border border-dark-700 rounded p-2 max-h-64 overflow-y-auto">
              <div className="text-xs font-medium text-dark-400 mb-2">Files</div>
              <FileTree
                files={result.files}
                onSelectFile={setSelectedFile}
                selectedFile={selectedFile}
              />
            </div>
            <div className="col-span-2 bg-dark-900 border border-dark-700 rounded p-2 max-h-64 overflow-y-auto">
              {selectedFile ? (
                <>
                  <div className="text-xs font-medium text-dark-400 mb-2 font-mono">{selectedFile}</div>
                  <pre className="text-xs text-dark-100 font-mono whitespace-pre-wrap break-words">
                    {result.files[selectedFile]}
                  </pre>
                </>
              ) : (
                <div className="text-xs text-dark-400 text-center pt-8">
                  ← Select a file to view
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── GitHub Tab ────────────────────────────────────────────────────────────────

function GitHubTab() {
  const { userId } = useStore()
  const [op, setOp] = useState('list_repos')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [newBranch, setNewBranch] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('gh_token') || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const OPS = [
    { id: 'list_repos', label: '📋 List Repos' },
    { id: 'get_tree', label: '🌳 Get Tree' },
    { id: 'get_file', label: '📄 Get File' },
    { id: 'create_branch', label: '🌿 Create Branch' },
    { id: 'list_prs', label: '🔀 List PRs' },
    { id: 'create_pr', label: '🔀 Create PR' },
  ]

  const handleRun = async () => {
    setLoading(true)
    setResult(null)
    if (githubToken) localStorage.setItem('gh_token', githubToken)

    try {
      const resp = await devApi.github({
        operation: op,
        repo: repo || undefined,
        branch,
        new_branch: newBranch || undefined,
        pr_title: prTitle || undefined,
        pr_body: prBody || undefined,
        user_id: userId,
        github_token: githubToken || undefined,
      })
      setResult(resp.data)
      toast.success(`GitHub operation: ${op} ✅`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || e.message)
      setResult({ error: e.response?.data?.detail || e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-dark-400 mb-1">GitHub Token (PAT)</label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder="ghp_..."
          className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
        />
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-2">Operation</label>
        <div className="grid grid-cols-3 gap-1">
          {OPS.map((o) => (
            <button
              key={o.id}
              onClick={() => setOp(o.id)}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                op === o.id ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-200 hover:bg-dark-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {op !== 'list_repos' && (
        <div>
          <label className="block text-xs text-dark-400 mb-1">Repo (owner/repo)</label>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repository"
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      )}

      {(op === 'create_branch') && (
        <div>
          <label className="block text-xs text-dark-400 mb-1">New Branch Name</label>
          <input
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="feature/my-feature"
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      )}

      {op === 'create_pr' && (
        <>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Head Branch</label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feature/my-feature"
              className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">PR Title</label>
            <input
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder="Add new feature"
              className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">PR Body</label>
            <textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              rows={3}
              placeholder="Describe the changes..."
              className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
            />
          </div>
        </>
      )}

      <button
        onClick={handleRun}
        disabled={loading}
        className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-medium transition-colors"
      >
        {loading ? '⚙️ Running...' : `🐙 Run: ${op}`}
      </button>

      {result && (
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3 max-h-80 overflow-y-auto">
          <pre className="text-xs text-dark-100 font-mono whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Test Tab ──────────────────────────────────────────────────────────────────

function TestTab() {
  const { selectedModel, selectedProvider, userId } = useStore()
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [framework, setFramework] = useState('pytest')
  const [autoGenerate, setAutoGenerate] = useState(true)
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<TaskProgress | null>(null)
  const [result, setResult] = useState<any>(null)
  const stopPollRef = useRef<(() => void) | null>(null)

  const handleRun = async () => {
    if (!code.trim()) return toast.error('Enter code to test')
    setLoading(true)
    setTask(null)
    setResult(null)
    if (stopPollRef.current) stopPollRef.current()

    try {
      const resp = await devApi.test({
        code,
        language,
        framework,
        auto_generate: autoGenerate,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      const taskId = resp.data.task_id
      toast.success('Test run started!')

      stopPollRef.current = pollTask(
        taskId,
        (t) => setTask(t),
        (res) => {
          setResult(res.result)
          setLoading(false)
          const summary = res.result?.summary
          if (summary?.status === 'passed') toast.success(`✅ Tests passed: ${summary.passed} passed`)
          else toast.error(`❌ Tests failed: ${summary?.failed} failed`)
        },
        (err) => {
          setLoading(false)
          toast.error(`Failed: ${err}`)
        }
      )
    } catch (e: any) {
      setLoading(false)
      toast.error(e.response?.data?.detail || e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div>
          <label className="block text-xs text-dark-400 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1">Framework</label>
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="pytest">pytest</option>
            <option value="jest">jest</option>
            <option value="vitest">vitest</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer pb-2">
            <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} className="accent-primary-500" />
            AI Generate Tests
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-1">Source Code</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={8}
          placeholder="Paste your code here..."
          className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500 font-mono"
        />
      </div>

      <button
        onClick={handleRun}
        disabled={loading || !code.trim()}
        className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-medium transition-colors"
      >
        {loading ? '⚙️ Running Tests...' : '🧪 Run Tests'}
      </button>

      {task && <TaskProgressPanel task={task} />}

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className={`rounded-lg p-3 ${result.summary?.status === 'passed' ? 'bg-green-950 border border-green-700' : 'bg-red-950 border border-red-700'}`}>
            <div className="flex items-center gap-3">
              <span className="text-lg">{result.summary?.status === 'passed' ? '✅' : '❌'}</span>
              <div>
                <div className="font-semibold text-white">
                  {result.summary?.status === 'passed' ? 'All Tests Passed' : 'Tests Failed'}
                </div>
                <div className="text-xs text-dark-300">
                  {result.summary?.passed} passed · {result.summary?.failed} failed · {result.summary?.errors} errors
                </div>
              </div>
            </div>
          </div>

          {/* Generated tests */}
          {result.generated_tests && (
            <div>
              <div className="text-xs text-dark-400 mb-1">🤖 AI-Generated Tests</div>
              <pre className="bg-dark-900 border border-dark-700 rounded p-2 text-xs font-mono text-dark-100 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {result.generated_tests}
              </pre>
            </div>
          )}

          {/* Output */}
          {result.output && (
            <div>
              <div className="text-xs text-dark-400 mb-1">📋 Output</div>
              <pre className="bg-dark-900 border border-dark-700 rounded p-2 text-xs font-mono text-dark-100 max-h-48 overflow-y-auto">
                {result.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Review Tab ────────────────────────────────────────────────────────────────

function ReviewTab() {
  const { selectedModel, selectedProvider, userId } = useStore()
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [reviewType, setReviewType] = useState('full')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)

  const handleReview = async () => {
    if (!code.trim()) return toast.error('Enter code to review')
    setLoading(true)
    setResult(null)

    try {
      const resp = await devApi.review({
        code,
        language,
        review_type: reviewType,
        context,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      setResult(resp.data)
      toast.success(`Code review complete — Score: ${resp.data.review?.overall_score}/10`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = (score: number) => {
    if (score >= 8) return 'text-green-400'
    if (score >= 6) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div>
          <label className="block text-xs text-dark-400 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="rust">Rust</option>
            <option value="go">Go</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1">Review Type</label>
          <select
            value={reviewType}
            onChange={(e) => setReviewType(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="full">Full Review</option>
            <option value="security">Security</option>
            <option value="performance">Performance</option>
            <option value="style">Style</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-1">Code to Review</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={8}
          placeholder="Paste your code here..."
          className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500 font-mono"
        />
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-1">Context (optional)</label>
        <input
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="e.g. This is a public API endpoint handling user auth"
          className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
        />
      </div>

      <button
        onClick={handleReview}
        disabled={loading || !code.trim()}
        className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-medium transition-colors"
      >
        {loading ? '⚙️ Reviewing...' : '🔍 Review Code'}
      </button>

      {result && result.review && (
        <div className="space-y-3">
          {/* Score */}
          <div className="bg-dark-900 border border-dark-700 rounded-lg p-4 flex items-center gap-4">
            <div className={`text-4xl font-bold ${scoreColor(result.review.overall_score)}`}>
              {result.review.overall_score}/10
            </div>
            <div>
              <div className="font-semibold text-white">{result.review.summary}</div>
              <div className="text-xs text-dark-400 mt-1">Effort: {result.review.estimated_effort}</div>
            </div>
          </div>

          {/* Issues */}
          {(result.review.issues || []).length > 0 && (
            <div>
              <div className="text-xs font-medium text-dark-300 mb-2">🔍 Issues Found ({result.review.issues.length})</div>
              <div className="space-y-2">
                {result.review.issues.map((issue, i) => (
                  <div key={i} className={`border rounded-lg p-3 ${SEVERITY_COLORS[issue.severity] || 'text-gray-400 bg-dark-900 border-dark-700'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase">{issue.severity}</span>
                      <span className="text-xs opacity-70">{issue.category}</span>
                      {issue.line && <span className="text-xs opacity-60">line {issue.line}</span>}
                    </div>
                    <div className="text-sm">{issue.description}</div>
                    <div className="text-xs mt-1 opacity-80">💡 {issue.suggestion}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strengths */}
          {(result.review.strengths || []).length > 0 && (
            <div>
              <div className="text-xs font-medium text-dark-300 mb-2">✅ Strengths</div>
              <ul className="space-y-1">
                {result.review.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-green-300 flex items-start gap-1">
                    <span>•</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {(result.review.recommended_improvements || []).length > 0 && (
            <div>
              <div className="text-xs font-medium text-dark-300 mb-2">🚀 Recommended Improvements</div>
              <ul className="space-y-1">
                {result.review.recommended_improvements.map((s, i) => (
                  <li key={i} className="text-xs text-yellow-300 flex items-start gap-1">
                    <span>{i + 1}.</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Workflow Tab ──────────────────────────────────────────────────────────────

function WorkflowTab() {
  const { selectedModel, selectedProvider, userId } = useStore()
  const [description, setDescription] = useState('')
  const [stack, setStack] = useState('python-fastapi')
  const [deployTo, setDeployTo] = useState('')
  const [runTests, setRunTests] = useState(true)
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('gh_token') || '')
  const [githubRepo, setGithubRepo] = useState('')
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<TaskProgress | null>(null)
  const [result, setResult] = useState<any>(null)
  const stopPollRef = useRef<(() => void) | null>(null)

  const handleRun = async () => {
    if (!description.trim()) return toast.error('Describe what to build')
    setLoading(true)
    setTask(null)
    setResult(null)
    if (stopPollRef.current) stopPollRef.current()
    if (githubToken) localStorage.setItem('gh_token', githubToken)

    try {
      const resp = await devApi.workflow({
        description,
        stack,
        deploy_to: deployTo || undefined,
        run_tests: runTests,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
        github_token: githubToken || undefined,
        github_repo: githubRepo || undefined,
      })
      const taskId = resp.data.task_id
      toast.success('🚀 Autonomous workflow started!')

      stopPollRef.current = pollTask(
        taskId,
        (t) => setTask(t),
        (res) => {
          setResult(res.result)
          setLoading(false)
          toast.success(`🎉 Workflow complete! ${(res.result?.steps_completed || []).join(' → ')}`)
        },
        (err) => {
          setLoading(false)
          toast.error(`Workflow failed: ${err}`)
        },
        3000,
        600000,
      )
    } catch (e: any) {
      setLoading(false)
      toast.error(e.response?.data?.detail || e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-primary-950 border border-primary-800 rounded-lg p-3 text-xs text-primary-200">
        🤖 <strong>Full Autonomous Developer Workflow:</strong> Generate → Test → Push to GitHub → Deploy
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-1">What to build?</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. FastAPI REST API with authentication and PostgreSQL"
          className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-dark-400 mb-1">Stack</label>
          <select
            value={stack}
            onChange={(e) => setStack(e.target.value)}
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="python-fastapi">Python FastAPI</option>
            <option value="node-express">Node.js Express</option>
            <option value="react-vite">React + Vite</option>
            <option value="fullstack-python">Full-Stack Python</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1">Deploy to (optional)</label>
          <select
            value={deployTo}
            onChange={(e) => setDeployTo(e.target.value)}
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">Skip deployment</option>
            <option value="vercel">Vercel</option>
            <option value="huggingface">HuggingFace Space</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-dark-400 mb-1">GitHub Token (for auto-push + PR)</label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder="ghp_... (optional)"
          className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
        />
      </div>

      {githubToken && (
        <div>
          <label className="block text-xs text-dark-400 mb-1">GitHub Repo (owner/repo)</label>
          <input
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="owner/repo"
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-dark-200 cursor-pointer">
        <input type="checkbox" checked={runTests} onChange={(e) => setRunTests(e.target.checked)} className="accent-primary-500" />
        Run Tests
      </label>

      <button
        onClick={handleRun}
        disabled={loading || !description.trim()}
        className="w-full bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-50 text-white rounded-lg px-4 py-3 font-bold transition-all"
      >
        {loading ? '⚙️ Running Workflow...' : '🤖 Run Full Workflow'}
      </button>

      {task && <TaskProgressPanel task={task} />}

      {result && (
        <div className="bg-dark-900 border border-green-700 rounded-lg p-4 space-y-3">
          <div className="text-green-400 font-semibold">🎉 Workflow Complete!</div>
          <div className="flex flex-wrap gap-2">
            {(result.steps_completed || []).map((step: string, i: number) => (
              <span key={i} className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded-full">
                ✅ {step}
              </span>
            ))}
          </div>
          {result.generate && (
            <div className="text-xs text-dark-300">
              📦 Generated: <span className="text-white">{result.generate.project_name}</span> ({result.generate.file_count} files)
            </div>
          )}
          {result.test && (
            <div className="text-xs text-dark-300">
              🧪 Tests: <span className={result.test.summary?.status === 'passed' ? 'text-green-400' : 'text-red-400'}>
                {result.test.summary?.status} ({result.test.summary?.passed} passed)
              </span>
            </div>
          )}
          {result.github?.pr?.url && (
            <div className="text-xs text-dark-300">
              🔀 PR: <a href={result.github.pr.url} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">
                #{result.github.pr.number}: {result.github.pr.title}
              </a>
            </div>
          )}
          {result.deploy?.url && (
            <div className="text-xs text-dark-300">
              🚀 Deployed: <a href={result.deploy.url} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">
                {result.deploy.url}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Metrics Tab ───────────────────────────────────────────────────────────────

function MetricsTab() {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await devApi.metrics()
      setMetrics(resp.data)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMetrics()
    const interval = setInterval(loadMetrics, 30000)
    return () => clearInterval(interval)
  }, [loadMetrics])

  if (!metrics) return (
    <div className="text-center py-8 text-dark-400">
      {loading ? 'Loading metrics...' : 'No data'}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Phase 9 Metrics Dashboard</h3>
        <button
          onClick={loadMetrics}
          disabled={loading}
          className="text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 px-2 py-1 rounded"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">Total Tasks</div>
          <div className="text-2xl font-bold text-white">{metrics.tasks?.total || 0}</div>
          <div className="text-xs text-green-400 mt-1">✅ {metrics.tasks?.success_rate}</div>
        </div>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">Uptime</div>
          <div className="text-lg font-bold text-white">{metrics.uptime_human}</div>
          <div className="text-xs text-dark-400 mt-1">v{metrics.version}</div>
        </div>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">Code Generations</div>
          <div className="text-2xl font-bold text-primary-400">{metrics.operations?.code_generations || 0}</div>
        </div>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">GitHub Ops</div>
          <div className="text-2xl font-bold text-green-400">{metrics.operations?.github_ops || 0}</div>
        </div>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">Tests Run</div>
          <div className="text-2xl font-bold text-yellow-400">{metrics.operations?.tests_run || 0}</div>
        </div>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
          <div className="text-xs text-dark-400">Deployments</div>
          <div className="text-2xl font-bold text-purple-400">{metrics.operations?.deployments || 0}</div>
        </div>
      </div>

      {/* Running tasks */}
      {metrics.tasks?.running > 0 && (
        <div className="bg-blue-950 border border-blue-700 rounded-lg p-2 text-xs text-blue-200">
          ⚙️ {metrics.tasks.running} task(s) running
        </div>
      )}

      {/* Recent tasks */}
      {(metrics.recent_tasks || []).length > 0 && (
        <div>
          <div className="text-xs font-medium text-dark-400 mb-2">Recent Tasks</div>
          <div className="space-y-1">
            {metrics.recent_tasks.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={STATUS_COLORS[t.status] || 'text-gray-400'}>
                  {t.status === 'success' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'running' ? '⚙️' : '⏳'}
                </span>
                <span className="text-dark-400 font-mono">{t.task_id}</span>
                <span className="text-dark-500">{t.type}</span>
                <span className="text-dark-200 flex-1 truncate">{t.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tasks Panel ───────────────────────────────────────────────────────────────

function TasksTab() {
  const { userId } = useStore()
  const [tasks, setTasks] = useState<any[]>([])
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await tasksApi.list(userId, 30)
      setTasks(resp.data.tasks || [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadTasks()
    const interval = setInterval(loadTasks, 5000)
    return () => clearInterval(interval)
  }, [loadTasks])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Tasks ({tasks.length})</span>
        <button
          onClick={loadTasks}
          disabled={loading}
          className="text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 px-2 py-1 rounded"
        >
          🔄
        </button>
      </div>

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-xs text-dark-400 text-center py-8">No tasks yet</div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.task_id}
              onClick={() => setSelectedTask(selectedTask?.task_id === task.task_id ? null : task)}
              className="bg-dark-900 border border-dark-700 rounded-lg p-3 cursor-pointer hover:border-dark-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={STATUS_COLORS[task.status] || 'text-gray-400'}>
                    {task.status === 'success' ? '✅' : task.status === 'failed' ? '❌' : task.status === 'running' ? '⚙️' : '⏳'}
                  </span>
                  <span className="text-xs font-medium text-white capitalize">{task.type}</span>
                </div>
                <span className="text-xs text-dark-400">{task.progress}%</span>
              </div>
              <div className="text-xs text-dark-300 mt-1 truncate">{task.description}</div>
              
              {/* Progress bar */}
              <div className="w-full bg-dark-800 rounded-full h-1 mt-2">
                <div
                  className={`h-1 rounded-full transition-all ${task.status === 'failed' ? 'bg-red-500' : 'bg-primary-600'}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {selectedTask && (
        <div className="border border-dark-600 rounded-lg p-3 bg-dark-950">
          <div className="text-xs font-medium text-dark-300 mb-2">Task Log</div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {(selectedTask.progress_steps || []).map((step: any, i: number) => (
              <div key={i} className="text-xs text-dark-200 font-mono">
                <span className="text-dark-500">{new Date(step.time * 1000).toLocaleTimeString()}</span>{' '}
                {step.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main DevPanel ─────────────────────────────────────────────────────────────

const DEV_TABS = [
  { id: 'generate', label: '🚀 Generate', component: GenerateTab },
  { id: 'workflow', label: '🤖 Workflow', component: WorkflowTab },
  { id: 'test', label: '🧪 Test', component: TestTab },
  { id: 'review', label: '🔍 Review', component: ReviewTab },
  { id: 'github', label: '🐙 GitHub', component: GitHubTab },
  { id: 'tasks', label: '📋 Tasks', component: TasksTab },
  { id: 'metrics', label: '📊 Metrics', component: MetricsTab },
]

export default function DevPanel() {
  const [activeSubTab, setActiveSubTab] = useState('generate')
  const ActiveComponent = DEV_TABS.find((t) => t.id === activeSubTab)?.component || GenerateTab

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-dark-800">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🤖</span>
          <div>
            <h2 className="text-sm font-bold text-white">Phase 9 — Autonomous Developer</h2>
            <p className="text-xs text-dark-400">Generate · Test · Review · Deploy · GitHub</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {DEV_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeSubTab === tab.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-dark-800 text-dark-300 hover:bg-dark-700 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ActiveComponent />
      </div>
    </div>
  )
}
