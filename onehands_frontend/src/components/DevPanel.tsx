import React, { useState, useEffect } from 'react'
import { Code2, Play, Github, Rocket, CheckCircle, XCircle, Clock, Download, RefreshCw, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { devApi, tasksApi, pollTask, setBackendUrl, BACKEND_URL } from '../api'

type DevMode = 'workflow' | 'generate' | 'github' | 'intelligence'

function LogLine({ log }: { log: { time: number; message: string } }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      <span className="text-dark-600 flex-shrink-0">{new Date(log.time * 1000).toLocaleTimeString()}</span>
      <span className="text-dark-300">{log.message}</span>
    </div>
  )
}

export default function DevPanel() {
  const { settings, userId } = useStore()
  const [mode, setMode] = useState<DevMode>('workflow')

  // Workflow state
  const [description, setDescription] = useState('')
  const [stack, setStack] = useState('python-fastapi')
  const [githubToken, setGithubToken] = useState(settings.githubToken || '')
  const [githubRepo, setGithubRepo] = useState(settings.githubRepoDefault || '')
  const [deployTo, setDeployTo] = useState('')
  const [runTests, setRunTests] = useState(true)
  const [running, setRunning] = useState(false)
  const [taskData, setTaskData] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])

  // Generate state
  const [genDesc, setGenDesc] = useState('')
  const [genStack, setGenStack] = useState('python-fastapi')
  const [genRunning, setGenRunning] = useState(false)
  const [genResult, setGenResult] = useState<any>(null)

  // GitHub state
  const [ghOp, setGhOp] = useState('list_repos')
  const [ghToken, setGhToken] = useState(settings.githubToken || '')
  const [ghRepo, setGhRepo] = useState('')
  const [ghResult, setGhResult] = useState<any>(null)
  const [ghRunning, setGhRunning] = useState(false)

  // Code intelligence state
  const [ciCode, setCiCode] = useState('')
  const [ciOp, setCiOp] = useState('explain')
  const [ciLang, setCiLang] = useState('python')
  const [ciResult, setCiResult] = useState<any>(null)
  const [ciRunning, setCiRunning] = useState(false)

  const [stacks, setStacks] = useState<any[]>([])

  useEffect(() => {
    devApi.stacks().then(r => setStacks(r.data?.stacks || [])).catch(() => {})
  }, [])

  const ensureBackend = () => {
    if (settings.backendUrl !== BACKEND_URL) setBackendUrl(settings.backendUrl)
  }

  // ── Full Workflow ──────────────────────────────────────────────────────────
  const runWorkflow = async () => {
    if (!description.trim() || running) return
    ensureBackend()
    setRunning(true)
    setTaskData(null)
    setLogs([])
    toast('🚀 Starting autonomous dev workflow...')

    try {
      const res = await devApi.workflow({
        description: description.trim(),
        stack,
        provider: settings.provider,
        model: settings.model,
        user_id: userId,
        github_token: githubToken || undefined,
        github_repo: githubRepo || undefined,
        deploy_to: deployTo || undefined,
        run_tests: runTests,
      })
      const taskId = res.data.task_id

      await pollTask(
        taskId,
        (task) => {
          setTaskData(task)
          setLogs(task.logs || [])
        },
        2000,
        300000
      )
    } catch (err: any) {
      toast.error(err.message || 'Workflow failed')
    } finally {
      setRunning(false)
    }
  }

  // ── Generate Only ─────────────────────────────────────────────────────────
  const runGenerate = async () => {
    if (!genDesc.trim() || genRunning) return
    ensureBackend()
    setGenRunning(true)
    setGenResult(null)
    toast('📝 Generating project...')

    try {
      const res = await devApi.generate({
        description: genDesc.trim(),
        stack: genStack,
        provider: settings.provider,
        model: settings.model,
        user_id: userId,
      })
      const taskId = res.data.task_id
      const final = await pollTask(taskId, () => {}, 2000, 120000)
      setGenResult(final.result)
      toast.success(`Generated ${final.result?.file_count || 0} files!`)
    } catch (err: any) {
      toast.error(err.message || 'Generate failed')
    } finally {
      setGenRunning(false)
    }
  }

  const downloadFiles = (files: Record<string, string>, projectName: string) => {
    // Create a simple text blob with all files
    const content = Object.entries(files)
      .map(([name, code]) => `${'='.repeat(60)}\n# ${name}\n${'='.repeat(60)}\n${code}`)
      .join('\n\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'project'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── GitHub ─────────────────────────────────────────────────────────────────
  const runGithub = async () => {
    if (ghRunning) return
    ensureBackend()
    setGhRunning(true)
    setGhResult(null)
    try {
      const res = await devApi.github({
        operation: ghOp,
        github_token: ghToken || undefined,
        repo: ghRepo || undefined,
      })
      setGhResult(res.data)
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message
      setGhResult({ error: msg })
      toast.error(msg)
    } finally {
      setGhRunning(false)
    }
  }

  // ── Code Intelligence ──────────────────────────────────────────────────────
  const runCodeIntel = async () => {
    if (!ciCode.trim() || ciRunning) return
    ensureBackend()
    setCiRunning(true)
    setCiResult(null)
    try {
      let res
      switch (ciOp) {
        case 'explain': res = await devApi.explain(ciCode, ciLang); break
        case 'refactor': res = await devApi.refactor(ciCode, ciLang); break
        case 'debug': res = await devApi.debug(ciCode, ciLang); break
        case 'review': res = await devApi.review(ciCode, ciLang); break
        case 'convert': res = await devApi.convert(ciCode, ciLang); break
        default: res = await devApi.explain(ciCode, ciLang)
      }
      setCiResult(res.data)
    } catch (err: any) {
      toast.error(err.message || 'Code intel failed')
    } finally {
      setCiRunning(false)
    }
  }

  const tabs: { id: DevMode; label: string; icon: any }[] = [
    { id: 'workflow', label: 'Full Workflow', icon: Rocket },
    { id: 'generate', label: 'Generate', icon: Code2 },
    { id: 'github', label: 'GitHub', icon: Github },
    { id: 'intelligence', label: 'Code Intel', icon: Wrench },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-1 p-3 border-b border-dark-800 bg-dark-950 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              mode === id ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* ── Full Workflow ── */}
        {mode === 'workflow' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Project Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Build a REST API for a todo list with CRUD operations"
                rows={3}
                className="input-field w-full resize-none text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Stack</label>
                <select value={stack} onChange={(e) => setStack(e.target.value)} className="input-field w-full text-sm">
                  {stacks.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Deploy To</label>
                <select value={deployTo} onChange={(e) => setDeployTo(e.target.value)} className="input-field w-full text-sm">
                  <option value="">No deploy</option>
                  <option value="vercel">Vercel</option>
                  <option value="huggingface">HuggingFace</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">GitHub Token (optional)</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_xxx"
                  className="input-field w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">GitHub Repo (optional)</label>
                <input
                  type="text"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="owner/repo-name"
                  className="input-field w-full text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={runTests}
                  onChange={(e) => setRunTests(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-dark-300">Run tests</span>
              </label>
              <button
                onClick={runWorkflow}
                disabled={!description.trim() || running}
                className="btn-primary flex items-center gap-2 ml-auto"
              >
                {running ? <RefreshCw size={14} className="animate-spin" /> : <Rocket size={14} />}
                {running ? 'Running...' : 'Run Full Workflow'}
              </button>
            </div>

            {/* Progress log */}
            {(running || taskData) && (
              <div className="bg-dark-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-dark-400 uppercase">Live Log</span>
                  {taskData && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      taskData.status === 'completed' ? 'bg-green-900 text-green-300' :
                      taskData.status === 'failed' ? 'bg-red-900 text-red-300' :
                      'bg-primary-900 text-primary-300'
                    }`}>
                      {taskData.status} {taskData.progress}%
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                {taskData?.progress !== undefined && (
                  <div className="h-1.5 bg-dark-700 rounded-full mb-3 overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all duration-500"
                      style={{ width: `${taskData.progress}%` }}
                    />
                  </div>
                )}
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {logs.map((log, i) => <LogLine key={i} log={log} />)}
                  {running && logs.length === 0 && (
                    <p className="text-xs text-dark-500 animate-pulse">Starting...</p>
                  )}
                </div>
              </div>
            )}

            {/* Result */}
            {taskData?.status === 'completed' && taskData?.result && (
              <div className="space-y-3">
                <div className="bg-dark-800 rounded-xl p-4 border border-green-800">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle size={16} className="text-green-400" />
                    <span className="text-sm font-semibold text-green-400">Workflow Complete!</span>
                    <span className="text-xs text-dark-500 ml-auto">
                      Steps: {taskData.result.steps_completed?.join(' → ')}
                    </span>
                  </div>

                  {taskData.result.generate && (
                    <div className="mb-3">
                      <p className="text-xs text-dark-400 mb-2">Generated Files ({taskData.result.generate.file_count}):</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(taskData.result.generate.files || {}).map(f => (
                          <span key={f} className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => downloadFiles(taskData.result.generate.files, taskData.result.generate.project_name)}
                        className="mt-2 btn-ghost text-xs flex items-center gap-1"
                      >
                        <Download size={12} />
                        Download Files
                      </button>
                    </div>
                  )}

                  {taskData.result.github && !taskData.result.github.error && (
                    <div className="text-xs text-dark-400">
                      <span className="text-green-400">✅ GitHub:</span> {' '}
                      <a href={taskData.result.github.url} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">
                        {taskData.result.github.url}
                      </a>
                    </div>
                  )}

                  {taskData.result.deploy && !taskData.result.deploy.error && (
                    <div className="text-xs text-dark-400 mt-1">
                      <span className="text-green-400">✅ Deployed:</span> {' '}
                      <a href={taskData.result.deploy.url} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">
                        {taskData.result.deploy.url}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {taskData?.status === 'failed' && (
              <div className="bg-dark-800 rounded-xl p-4 border border-red-800">
                <div className="flex items-center gap-2">
                  <XCircle size={16} className="text-red-400" />
                  <span className="text-sm text-red-400">Workflow Failed</span>
                </div>
                <p className="text-xs text-dark-400 mt-2">{taskData.error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Generate Only ── */}
        {mode === 'generate' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Description *</label>
              <textarea
                value={genDesc}
                onChange={(e) => setGenDesc(e.target.value)}
                placeholder="e.g. A FastAPI backend with user authentication and JWT tokens"
                rows={3}
                className="input-field w-full resize-none text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <select value={genStack} onChange={(e) => setGenStack(e.target.value)} className="input-field text-sm flex-1">
                {stacks.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={runGenerate} disabled={!genDesc.trim() || genRunning} className="btn-primary flex items-center gap-2">
                {genRunning ? <RefreshCw size={14} className="animate-spin" /> : <Code2 size={14} />}
                {genRunning ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {genResult && (
              <div className="bg-dark-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-green-400">
                    ✅ {genResult.project_name} ({genResult.file_count} files)
                  </span>
                  <button
                    onClick={() => downloadFiles(genResult.files, genResult.project_name)}
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <Download size={12} />
                    Download
                  </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {Object.entries(genResult.files || {}).map(([fname, content]: any) => (
                    <details key={fname} className="bg-dark-900 rounded-lg overflow-hidden">
                      <summary className="cursor-pointer px-3 py-2 text-xs text-primary-300 hover:bg-dark-800 flex items-center gap-2">
                        <Code2 size={10} />
                        {fname}
                      </summary>
                      <pre className="px-3 py-2 text-xs text-dark-300 overflow-x-auto">
                        {content.slice(0, 1000)}{content.length > 1000 ? '\n...(truncated)' : ''}
                      </pre>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GitHub ── */}
        {mode === 'github' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">GitHub Token</label>
                <input
                  type="password"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                  placeholder="ghp_xxx"
                  className="input-field w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Operation</label>
                <select value={ghOp} onChange={(e) => setGhOp(e.target.value)} className="input-field w-full text-sm">
                  <option value="list_repos">List Repos</option>
                  <option value="get_user">Get User Info</option>
                  <option value="get_repo_info">Get Repo Info</option>
                  <option value="list_prs">List Open PRs</option>
                  <option value="create_repo">Create Repo</option>
                </select>
              </div>
            </div>
            {['get_repo_info', 'list_prs', 'commit_files'].includes(ghOp) && (
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Repo (owner/name)</label>
                <input
                  type="text"
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                  placeholder="owner/repo-name"
                  className="input-field w-full text-sm"
                />
              </div>
            )}
            <button onClick={runGithub} disabled={!ghToken || ghRunning} className="btn-primary flex items-center gap-2">
              {ghRunning ? <RefreshCw size={14} className="animate-spin" /> : <Github size={14} />}
              {ghRunning ? 'Running...' : 'Execute'}
            </button>

            {ghResult && (
              <div className="bg-dark-800 rounded-xl p-4">
                <pre className="text-xs text-dark-300 overflow-auto max-h-80 whitespace-pre-wrap">
                  {JSON.stringify(ghResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* ── Code Intelligence ── */}
        {mode === 'intelligence' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-dark-400 mb-1">Operation</label>
                <select value={ciOp} onChange={(e) => setCiOp(e.target.value)} className="input-field w-full text-sm">
                  <option value="explain">Explain Code</option>
                  <option value="refactor">Refactor Code</option>
                  <option value="debug">Debug Code</option>
                  <option value="review">Code Review</option>
                  <option value="convert">Convert Language</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-dark-400 mb-1">Language</label>
                <select value={ciLang} onChange={(e) => setCiLang(e.target.value)} className="input-field w-full text-sm">
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="java">Java</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Code *</label>
              <textarea
                value={ciCode}
                onChange={(e) => setCiCode(e.target.value)}
                placeholder="Paste your code here..."
                rows={8}
                className="input-field w-full resize-none text-sm font-mono"
              />
            </div>
            <button onClick={runCodeIntel} disabled={!ciCode.trim() || ciRunning} className="btn-primary flex items-center gap-2">
              {ciRunning ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
              {ciRunning ? 'Analyzing...' : `Run ${ciOp}`}
            </button>

            {ciResult && (
              <div className="bg-dark-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-dark-400">{ciResult.operation} • {ciResult.provider}/{ciResult.model}</span>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <pre className="text-xs text-dark-200 whitespace-pre-wrap overflow-auto max-h-80">
                    {ciResult.result}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
