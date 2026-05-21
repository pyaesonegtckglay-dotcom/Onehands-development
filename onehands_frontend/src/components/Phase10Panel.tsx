import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Users, GitBranch, RefreshCw, Network, Bug, Vote, Zap,
  Play, ChevronRight, CheckCircle, XCircle, Clock, AlertCircle,
  BarChart2, Brain, Code, Loader2
} from 'lucide-react'
import { p10Api } from '../api'
import { useStore } from '../store'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

type P10Tab = 'orchestrate' | 'cicd' | 'selfimprove' | 'taskgraph' | 'bugfix' | 'consensus' | 'status'

const AGENT_ROLES = ['planner', 'coder', 'reviewer', 'tester', 'deployer', 'debugger', 'researcher']
const CICD_STAGES = ['lint', 'test', 'build', 'deploy', 'notify']

const TAB_CONFIG: { id: P10Tab; label: string; icon: React.FC<any>; description: string }[] = [
  { id: 'orchestrate', label: 'Orchestrate', icon: Users, description: 'Multi-agent coordination' },
  { id: 'cicd', label: 'CI/CD', icon: GitBranch, description: 'Agentic CI/CD pipeline' },
  { id: 'selfimprove', label: 'Self-Improve', icon: RefreshCw, description: 'Agent self-improvement loop' },
  { id: 'taskgraph', label: 'Task Graph', icon: Network, description: 'DAG task decomposition' },
  { id: 'bugfix', label: 'Bug Fix', icon: Bug, description: 'Autonomous bug fixer' },
  { id: 'consensus', label: 'Consensus', icon: Vote, description: 'Multi-model agreement' },
  { id: 'status', label: 'Status', icon: BarChart2, description: 'Phase 10 dashboard' },
]

const STATUS_STYLES: Record<string, string> = {
  success: 'text-green-400',
  passed: 'text-green-400',
  failed: 'text-red-400',
  running: 'text-blue-400',
  queued: 'text-yellow-400',
  fixed: 'text-green-400',
  improved: 'text-teal-400',
  error: 'text-red-400',
  info: 'text-blue-400',
  sent: 'text-green-400',
  completed: 'text-green-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`font-semibold text-sm ${STATUS_STYLES[status] || 'text-gray-400'}`}>
      {status === 'success' || status === 'passed' || status === 'fixed' ? '✅' :
       status === 'failed' || status === 'error' ? '❌' :
       status === 'running' ? '⚙️' :
       status === 'queued' ? '⏳' : '◉'} {status}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {children}
    </div>
  )
}

function CodeBlock({ code, lang = 'python' }: { code: string; lang?: string }) {
  return (
    <pre className="bg-dark-950 text-green-300 text-xs rounded-lg p-3 overflow-auto max-h-64 border border-dark-700">
      <code>{code}</code>
    </pre>
  )
}

function ToggleGroup({
  options, selected, onChange
}: {
  options: string[]
  selected: string[]
  onChange: (vals: string[]) => void
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) {
      if (selected.length > 1) onChange(selected.filter(x => x !== v))
    } else {
      onChange([...selected, v])
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          onClick={() => toggle(o)}
          className={`px-2 py-1 rounded text-xs font-medium transition-all ${
            selected.includes(o)
              ? 'bg-brand-600 text-white'
              : 'bg-dark-800 text-dark-400 hover:text-white hover:bg-dark-700'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

// ── Orchestrate Tab ────────────────────────────────────────────────────────────

function OrchestrateTab() {
  const { userId, selectedModel, selectedProvider } = useStore()
  const [task, setTask] = useState('')
  const [roles, setRoles] = useState(['planner', 'coder', 'reviewer', 'tester'])
  const [parallel, setParallel] = useState(false)
  const [running, setRunning] = useState(false)
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [polling, setPolling] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async (pid: string) => {
    try {
      const r = await p10Api.getPipeline(pid)
      const data = r.data
      if (data.status === 'success') {
        setResult(data.result)
        setPolling(false)
        setRunning(false)
        if (intervalRef.current) clearInterval(intervalRef.current)
        toast.success('Orchestration complete!')
      } else if (data.status === 'failed') {
        toast.error(`Orchestration failed: ${data.error || ''}`)
        setPolling(false)
        setRunning(false)
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } catch (e) {
      // Ignore poll errors
    }
  }, [])

  const run = useCallback(async () => {
    if (!task.trim()) { toast.error('Enter a task'); return }
    setRunning(true)
    setResult(null)
    try {
      const r = await p10Api.orchestrate({
        task,
        roles,
        parallel,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      const pid = r.data.pipeline_id
      setPipelineId(pid)
      setPolling(true)
      toast.success('Multi-agent orchestration started!')
      intervalRef.current = setInterval(() => poll(pid), 3000)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Orchestration failed')
      setRunning(false)
    }
  }, [task, roles, parallel, selectedModel, selectedProvider, userId, poll])

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return (
    <div className="space-y-4">
      <Section title="🤖 Multi-Agent Orchestration">
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
          rows={3}
          placeholder="Describe the task (e.g. 'Build a REST API for a todo app with authentication')..."
          value={task}
          onChange={e => setTask(e.target.value)}
        />
        <div>
          <p className="text-xs text-dark-400 mb-2">Agent Roles:</p>
          <ToggleGroup options={AGENT_ROLES} selected={roles} onChange={setRoles} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={parallel}
            onChange={e => setParallel(e.target.checked)}
            className="w-4 h-4 rounded accent-brand-500"
          />
          <span className="text-sm text-dark-300">Run independent agents in parallel</span>
        </label>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Orchestrating...</> : <><Play size={14} /> Run Orchestration</>}
        </button>
        {polling && (
          <div className="text-xs text-blue-400 flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Polling for results...
          </div>
        )}
      </Section>

      {result && (
        <Section title="📋 Orchestration Result">
          <div className="text-xs text-dark-400 mb-1">Agents used: {result.agents_used?.join(', ')}</div>
          {result.agent_results && Object.entries(result.agent_results).map(([role, res]: [string, any]) => (
            <details key={role} className="bg-dark-800 rounded-lg p-3 cursor-pointer">
              <summary className="text-xs font-semibold text-white capitalize flex items-center justify-between">
                <span>🔹 {role}</span>
                <StatusBadge status={res.status || 'unknown'} />
              </summary>
              <div className="mt-2">
                <CodeBlock code={res.result || res.error || ''} />
              </div>
            </details>
          ))}
          {result.synthesis && (
            <div className="bg-brand-900/30 border border-brand-700 rounded-lg p-3">
              <p className="text-xs font-semibold text-brand-400 mb-1">🎯 Synthesis</p>
              <pre className="text-xs text-white whitespace-pre-wrap">{result.synthesis}</pre>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── CI/CD Tab ──────────────────────────────────────────────────────────────────

function CICDTab() {
  const { userId, selectedModel, selectedProvider } = useStore()
  const [repo, setRepo] = useState('')
  const [code, setCode] = useState('def add(a, b):\n    return a + b\n\nresult = add(1, 2)\nprint(result)')
  const [language, setLanguage] = useState('python')
  const [stages, setStages] = useState(['lint', 'test', 'build'])
  const [running, setRunning] = useState(false)
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  const [pipelineData, setPipelineData] = useState<any>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async (pid: string) => {
    try {
      const r = await p10Api.getPipeline(pid)
      setPipelineData(r.data)
      if (['passed', 'failed'].includes(r.data.status)) {
        setRunning(false)
        if (intervalRef.current) clearInterval(intervalRef.current)
        if (r.data.status === 'passed') toast.success('Pipeline passed! ✅')
        else toast.error('Pipeline failed ❌')
      }
    } catch (e) {}
  }, [])

  const run = useCallback(async () => {
    setRunning(true)
    setPipelineData(null)
    try {
      const r = await p10Api.cicd({
        repo: repo || 'inline',
        code: code || undefined,
        language,
        stages,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      const pid = r.data.pipeline_id
      setPipelineId(pid)
      toast.success('CI/CD pipeline started!')
      intervalRef.current = setInterval(() => poll(pid), 2000)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Pipeline failed to start')
      setRunning(false)
    }
  }, [repo, code, language, stages, selectedModel, selectedProvider, userId, poll])

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return (
    <div className="space-y-4">
      <Section title="⚙️ CI/CD Pipeline">
        <input
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white"
          placeholder="GitHub repo (owner/repo) — optional"
          value={repo}
          onChange={e => setRepo(e.target.value)}
        />
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white font-mono resize-none"
          rows={5}
          placeholder="Or paste code directly..."
          value={code}
          onChange={e => setCode(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-white"
          >
            {['python', 'javascript', 'typescript'].map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <div className="flex-1">
            <p className="text-xs text-dark-400 mb-1">Stages:</p>
            <ToggleGroup options={CICD_STAGES} selected={stages} onChange={setStages} />
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Running Pipeline...</> : <><GitBranch size={14} /> Trigger Pipeline</>}
        </button>
      </Section>

      {pipelineData && (
        <Section title="📊 Pipeline Results">
          <div className="flex items-center justify-between mb-2">
            <StatusBadge status={pipelineData.status} />
            <span className="text-xs text-dark-400">{pipelineId?.slice(0, 8)}</span>
          </div>
          {Object.entries(pipelineData.stages_results || {}).map(([stage, res]: [string, any]) => (
            <div key={stage} className={`rounded-lg p-3 border ${
              res.status === 'passed' ? 'border-green-800 bg-green-950/30' :
              res.status === 'failed' ? 'border-red-800 bg-red-950/30' :
              'border-dark-700 bg-dark-800'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-white capitalize">{stage}</span>
                <div className="flex items-center gap-2">
                  {res.passed !== undefined && (
                    <span className="text-xs text-green-400">{res.passed} passed</span>
                  )}
                  {res.failed !== undefined && res.failed > 0 && (
                    <span className="text-xs text-red-400">{res.failed} failed</span>
                  )}
                  <StatusBadge status={res.status} />
                  <span className="text-xs text-dark-400">{res.duration_ms}ms</span>
                </div>
              </div>
              {res.output && (
                <pre className="text-xs text-dark-300 mt-1 max-h-20 overflow-auto">{res.output.slice(0, 400)}</pre>
              )}
            </div>
          ))}
          {pipelineData.logs && pipelineData.logs.length > 0 && (
            <details>
              <summary className="text-xs text-dark-400 cursor-pointer">View logs ({pipelineData.logs.length})</summary>
              <div className="mt-2 space-y-1">
                {pipelineData.logs.map((log: any, i: number) => (
                  <div key={i} className="text-xs text-dark-300 font-mono">{log.msg}</div>
                ))}
              </div>
            </details>
          )}
        </Section>
      )}
    </div>
  )
}

// ── Self-Improve Tab ───────────────────────────────────────────────────────────

function SelfImproveTab() {
  const { userId, selectedModel, selectedProvider } = useStore()
  const [failedTask, setFailedTask] = useState('Write a Python function to calculate fibonacci numbers')
  const [failureReason, setFailureReason] = useState('RecursionError: maximum recursion depth exceeded')
  const [originalOutput, setOriginalOutput] = useState('def fib(n):\n    return fib(n-1) + fib(n-2)')
  const [maxIter, setMaxIter] = useState(3)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await p10Api.selfImprove({
        failed_task: failedTask,
        failure_reason: failureReason,
        original_output: originalOutput,
        max_iterations: maxIter,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      setResult(r.data)
      if (r.data.status === 'fixed') toast.success(`Fixed in ${r.data.fixed_in_iteration} iteration(s)!`)
      else if (r.data.status === 'improved') toast.success('Improved!')
      else toast.error('Could not fully fix — best attempt provided')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Self-improvement failed')
    } finally {
      setRunning(false)
    }
  }, [failedTask, failureReason, originalOutput, maxIter, selectedModel, selectedProvider, userId])

  return (
    <div className="space-y-4">
      <Section title="🔄 Self-Improvement Loop">
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
          rows={2}
          placeholder="The task that failed..."
          value={failedTask}
          onChange={e => setFailedTask(e.target.value)}
        />
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-red-300 font-mono resize-none"
          rows={2}
          placeholder="Error / failure reason..."
          value={failureReason}
          onChange={e => setFailureReason(e.target.value)}
        />
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white font-mono resize-none"
          rows={4}
          placeholder="Original (failing) output/code..."
          value={originalOutput}
          onChange={e => setOriginalOutput(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <label className="text-xs text-dark-400">Max iterations:</label>
          <input
            type="number"
            min={1} max={5}
            value={maxIter}
            onChange={e => setMaxIter(+e.target.value)}
            className="w-16 bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-white text-center"
          />
        </div>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Improving...</> : <><RefreshCw size={14} /> Run Self-Improvement</>}
        </button>
      </Section>

      {result && (
        <Section title="🔄 Improvement Result">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={result.status} />
            {result.fixed_in_iteration && (
              <span className="text-xs text-dark-400">Fixed in iteration {result.fixed_in_iteration}</span>
            )}
          </div>
          {result.iterations?.map((iter: any, i: number) => (
            <details key={i} className="bg-dark-800 rounded-lg p-3">
              <summary className="text-xs font-semibold text-white cursor-pointer flex justify-between">
                <span>Iteration {iter.iteration}</span>
                <StatusBadge status={iter.status || 'unknown'} />
              </summary>
              <div className="mt-2 space-y-2">
                {iter.diagnosis && (
                  <div>
                    <p className="text-xs text-yellow-400 mb-1">Diagnosis:</p>
                    <pre className="text-xs text-dark-300 whitespace-pre-wrap">{iter.diagnosis.slice(0, 500)}</pre>
                  </div>
                )}
                {iter.improved_output && (
                  <div>
                    <p className="text-xs text-green-400 mb-1">Improved output:</p>
                    <CodeBlock code={iter.improved_output.slice(0, 800)} />
                  </div>
                )}
                {iter.execution && (
                  <div className={`text-xs rounded px-2 py-1 ${
                    iter.execution.exit_code === 0 ? 'text-green-300 bg-green-950/30' : 'text-red-300 bg-red-950/30'
                  }`}>
                    Exit code: {iter.execution.exit_code} | {iter.execution.output || iter.execution.error}
                  </div>
                )}
              </div>
            </details>
          ))}
          {result.final_output && (
            <div>
              <p className="text-xs text-green-400 mb-1">Final output:</p>
              <CodeBlock code={result.final_output} />
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── Task Graph Tab ─────────────────────────────────────────────────────────────

function TaskGraphTab() {
  const { userId, selectedModel, selectedProvider } = useStore()
  const [goal, setGoal] = useState('')
  const [context, setContext] = useState('')
  const [maxTasks, setMaxTasks] = useState(6)
  const [autoExecute, setAutoExecute] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  const run = useCallback(async () => {
    if (!goal.trim()) { toast.error('Enter a goal'); return }
    setRunning(true)
    setResult(null)
    try {
      const r = await p10Api.taskGraph({
        goal,
        context,
        max_tasks: maxTasks,
        auto_execute: autoExecute,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      setResult(r.data)
      toast.success('Task graph complete!')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Task graph failed')
    } finally {
      setRunning(false)
    }
  }, [goal, context, maxTasks, autoExecute, selectedModel, selectedProvider, userId])

  return (
    <div className="space-y-4">
      <Section title="🕸️ Long-Horizon Task Graph (DAG)">
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
          rows={2}
          placeholder="High-level goal (e.g. 'Build and deploy a full-stack todo app with authentication')..."
          value={goal}
          onChange={e => setGoal(e.target.value)}
        />
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
          rows={2}
          placeholder="Additional context (optional)..."
          value={context}
          onChange={e => setContext(e.target.value)}
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-dark-400">Max tasks:</label>
            <input
              type="number" min={2} max={20}
              value={maxTasks}
              onChange={e => setMaxTasks(+e.target.value)}
              className="w-16 bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-white text-center"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={e => setAutoExecute(e.target.checked)}
              className="w-4 h-4 accent-brand-500"
            />
            <span className="text-xs text-dark-300">Auto-execute after planning</span>
          </label>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Planning & Executing...</> : <><Network size={14} /> Generate Task Graph</>}
        </button>
      </Section>

      {result && (
        <Section title="🕸️ Task Graph Result">
          <StatusBadge status={result.status || 'completed'} />
          <div className="text-xs text-dark-400 mt-1">Goal: {result.goal}</div>
          {result.dag?.execution_order && (
            <div>
              <p className="text-xs text-dark-400 mb-2">Execution waves:</p>
              {result.dag.execution_order.map((wave: string[], wi: number) => (
                <div key={wi} className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-dark-500 w-16">Wave {wi + 1}:</span>
                  <div className="flex gap-1 flex-wrap">
                    {wave.map(tid => (
                      <span key={tid} className="px-2 py-0.5 bg-dark-700 text-xs text-white rounded">
                        {tid}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.task_results && Object.entries(result.task_results).map(([tid, res]: [string, any]) => (
            <details key={tid} className="bg-dark-800 rounded-lg p-3">
              <summary className="text-xs font-semibold text-white cursor-pointer">
                {tid}: {res.task_name || ''}
              </summary>
              <pre className="mt-2 text-xs text-dark-300 whitespace-pre-wrap">{res.result?.slice(0, 600)}</pre>
            </details>
          ))}
        </Section>
      )}
    </div>
  )
}

// ── Bug Fix Tab ────────────────────────────────────────────────────────────────

function BugFixTab() {
  const { userId, selectedModel, selectedProvider } = useStore()
  const [code, setCode] = useState("def divide(a, b):\n    return a / b\n\nprint(divide(10, 0))")
  const [error, setError] = useState('ZeroDivisionError: division by zero')
  const [language, setLanguage] = useState('python')
  const [maxAttempts, setMaxAttempts] = useState(3)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await p10Api.bugfix({
        code,
        error_message: error,
        language,
        max_attempts: maxAttempts,
        model: selectedModel,
        provider: selectedProvider,
        user_id: userId,
      })
      setResult(r.data)
      if (r.data.fixed) toast.success(`Bug fixed in attempt ${r.data.fixed_in_attempt}! ✅`)
      else toast.error('Could not fully fix — check attempts')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Bug fix failed')
    } finally {
      setRunning(false)
    }
  }, [code, error, language, maxAttempts, selectedModel, selectedProvider, userId])

  return (
    <div className="space-y-4">
      <Section title="🐛 Autonomous Bug Fixer">
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white font-mono resize-none"
          rows={5}
          placeholder="Paste buggy code here..."
          value={code}
          onChange={e => setCode(e.target.value)}
        />
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-red-300 font-mono resize-none"
          rows={2}
          placeholder="Error message or test failure..."
          value={error}
          onChange={e => setError(e.target.value)}
        />
        <div className="flex items-center gap-4">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-white"
          >
            {['python', 'javascript', 'typescript'].map(l => <option key={l}>{l}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-dark-400">Max attempts:</label>
            <input
              type="number" min={1} max={5}
              value={maxAttempts}
              onChange={e => setMaxAttempts(+e.target.value)}
              className="w-16 bg-dark-800 border border-dark-700 rounded px-2 py-1 text-xs text-white text-center"
            />
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Fixing...</> : <><Bug size={14} /> Fix Bug Autonomously</>}
        </button>
      </Section>

      {result && (
        <Section title="🔧 Fix Results">
          <div className="flex items-center gap-3 mb-2">
            <StatusBadge status={result.fixed ? 'fixed' : 'failed'} />
            {result.fixed_in_attempt && (
              <span className="text-xs text-dark-400">Fixed in attempt {result.fixed_in_attempt}</span>
            )}
          </div>
          {result.attempts?.map((att: any, i: number) => (
            <details key={i} className="bg-dark-800 rounded-lg p-3">
              <summary className="text-xs font-semibold text-white cursor-pointer flex justify-between">
                <span>Attempt {att.attempt}</span>
                <StatusBadge status={att.status || 'unknown'} />
              </summary>
              <div className="mt-2 space-y-2">
                {att.diagnosis && (
                  <pre className="text-xs text-yellow-300 whitespace-pre-wrap">{att.diagnosis.slice(0, 400)}</pre>
                )}
                {att.fixed_code && <CodeBlock code={att.fixed_code.slice(0, 600)} />}
                {att.verify_result && (
                  <div className={`text-xs rounded px-2 py-1 ${
                    att.verify_result.exit_code === 0 ? 'text-green-300 bg-green-950/30' : 'text-red-300 bg-red-950/30'
                  }`}>
                    Verify: exit={att.verify_result.exit_code} | {att.verify_result.output || att.verify_result.error}
                  </div>
                )}
              </div>
            </details>
          ))}
          {result.final_code && (
            <div>
              <p className="text-xs text-green-400 mb-1">Final code:</p>
              <CodeBlock code={result.final_code} />
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── Consensus Tab ─────────────────────────────────────────────────────────────

function ConsensusTab() {
  const { userId } = useStore()
  const [prompt, setPrompt] = useState('')
  const [strategy, setStrategy] = useState<'best_of' | 'synthesize' | 'majority'>('synthesize')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  const DEFAULT_MODELS = [
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
    { provider: 'gemini', model: 'gemini-2.5-flash-preview-05-20' },
  ]

  const run = useCallback(async () => {
    if (!prompt.trim()) { toast.error('Enter a prompt'); return }
    setRunning(true)
    setResult(null)
    try {
      const r = await p10Api.consensus({
        prompt,
        models: DEFAULT_MODELS,
        vote_strategy: strategy,
        user_id: userId,
      })
      setResult(r.data)
      toast.success(`Consensus complete via ${r.data.best_model}!`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Consensus failed')
    } finally {
      setRunning(false)
    }
  }, [prompt, strategy, userId])

  return (
    <div className="space-y-4">
      <Section title="🗳️ Multi-Model Consensus">
        <textarea
          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white resize-none"
          rows={3}
          placeholder="Prompt to run on multiple models..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          {(['best_of', 'synthesize', 'majority'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                strategy === s ? 'bg-orange-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="text-xs text-dark-400">
          Models: Gemini 2.0 Flash + Llama 3.3 70B + Gemini 2.5 Flash (parallel)
        </div>
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Running {DEFAULT_MODELS.length} models...</> : <><Vote size={14} /> Get Consensus</>}
        </button>
      </Section>

      {result && (
        <Section title="🗳️ Consensus Result">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-dark-400">Strategy: {result.strategy}</span>
            <span className="text-xs text-brand-400">Best: {result.best_model}</span>
          </div>
          {result.responses?.map((r: any, i: number) => (
            <details key={i} className="bg-dark-800 rounded-lg p-3">
              <summary className="text-xs font-semibold text-white cursor-pointer flex justify-between">
                <span>{r.provider}/{r.model}</span>
                <StatusBadge status={r.status} />
              </summary>
              <pre className="mt-2 text-xs text-dark-300 whitespace-pre-wrap">{r.response?.slice(0, 600)}</pre>
            </details>
          ))}
          {result.consensus && (
            <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-400 mb-1">🎯 Consensus Answer</p>
              <pre className="text-sm text-white whitespace-pre-wrap">{result.consensus}</pre>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── Status Tab ────────────────────────────────────────────────────────────────

function StatusTab() {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await p10Api.status()
      setStatus(r.data)
    } catch (e) {
      toast.error('Could not load Phase 10 status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-32 text-dark-400">
      <Loader2 size={20} className="animate-spin mr-2" /> Loading...
    </div>
  )

  if (!status) return null

  const caps = status.capabilities || {}
  const metrics = status.metrics || {}

  return (
    <div className="space-y-4">
      <Section title="⚡ Phase 10 Status">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{metrics.orchestrations}</div>
            <div className="text-xs text-dark-400">Orchestrations</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{metrics.cicd_runs}</div>
            <div className="text-xs text-dark-400">CI/CD Runs</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{metrics.bug_fixes}</div>
            <div className="text-xs text-dark-400">Bug Fixes</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{metrics.consensus_runs}</div>
            <div className="text-xs text-dark-400">Consensus Runs</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{metrics.total_agents_spawned}</div>
            <div className="text-xs text-dark-400">Agents Spawned</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{status.active_agents}</div>
            <div className="text-xs text-dark-400">Active Agents</div>
          </div>
        </div>
      </Section>

      <Section title="✅ Capabilities">
        <div className="grid grid-cols-1 gap-1">
          {Object.entries(caps).map(([key, enabled]) => (
            <div key={key} className="flex items-center gap-2">
              <span className={`text-xs ${enabled ? 'text-green-400' : 'text-red-400'}`}>
                {enabled ? '✅' : '❌'}
              </span>
              <span className="text-xs text-dark-300">
                {key.replace(/_/g, ' ').replace(/^10 /, '')}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex justify-center">
        <button
          onClick={load}
          className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
    </div>
  )
}

// ── Main Phase10Panel ──────────────────────────────────────────────────────────

export default function Phase10Panel() {
  const [activeTab, setActiveTab] = useState<P10Tab>('orchestrate')

  const renderTab = () => {
    switch (activeTab) {
      case 'orchestrate': return <OrchestrateTab />
      case 'cicd':        return <CICDTab />
      case 'selfimprove': return <SelfImproveTab />
      case 'taskgraph':   return <TaskGraphTab />
      case 'bugfix':      return <BugFixTab />
      case 'consensus':   return <ConsensusTab />
      case 'status':      return <StatusTab />
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-dark-900 border-b border-dark-800 px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Phase 10 — Multi-Agent Orchestration</h2>
            <p className="text-xs text-dark-400">True Autonomous AI Developer — Teams of specialized agents</p>
          </div>
        </div>
        {/* Sub-tabs */}
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.description}
                className={`
                  flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                  transition-all whitespace-nowrap
                  ${isActive
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'text-dark-400 hover:text-white hover:bg-dark-800'
                  }
                `}
              >
                <Icon size={12} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderTab()}
      </div>
    </div>
  )
}
