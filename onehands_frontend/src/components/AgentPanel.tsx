import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Play, Square, Brain, Wrench, Code2, CheckCircle2,
  AlertCircle, ChevronRight, ChevronDown, Loader2, Bot,
  Lightbulb, FileText, Zap
} from 'lucide-react'
import { useStore } from '../store'
import { agentApi, conversationsApi } from '../api'
import toast from 'react-hot-toast'

const STEP_ICONS: Record<string, React.FC<any>> = {
  thought: Brain,
  tool_call: Wrench,
  execution: Code2,
  error: AlertCircle,
  final_answer: CheckCircle2,
}

const STEP_COLORS: Record<string, string> = {
  thought: 'border-purple-600 bg-purple-900/10',
  tool_call: 'border-yellow-600 bg-yellow-900/10',
  execution: 'border-green-600 bg-green-900/10',
  error: 'border-red-600 bg-red-900/10',
  final_answer: 'border-cyan-500 bg-cyan-900/10',
}

const STEP_ICON_COLORS: Record<string, string> = {
  thought: 'text-purple-400',
  tool_call: 'text-yellow-400',
  execution: 'text-green-400',
  error: 'text-red-400',
  final_answer: 'text-cyan-400',
}

interface TraceStepItem {
  step: number
  type: string
  content?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  status?: string
  error?: string
}

function TraceStepCard({ item }: { item: TraceStepItem }) {
  const [expanded, setExpanded] = useState(item.type !== 'thought' || (item.content?.length || 0) < 300)
  const Icon = STEP_ICONS[item.type] || Brain
  const colorClass = STEP_COLORS[item.type] || STEP_COLORS.thought
  const iconColor = STEP_ICON_COLORS[item.type] || STEP_ICON_COLORS.thought

  return (
    <div className={`border-l-2 pl-3 py-2 rounded-r-lg ${colorClass} mb-2 animate-slide-up`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Icon size={14} className={iconColor} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${iconColor}`}>
          {item.type.replace('_', ' ')} {item.step && `— Step ${item.step}`}
        </span>
        {item.tool && (
          <span className="text-xs bg-yellow-900/30 text-yellow-300 px-2 py-0.5 rounded border border-yellow-800/50">
            {item.tool}
          </span>
        )}
        {item.status === 'error' && (
          <span className="text-xs bg-red-900/30 text-red-300 px-2 py-0.5 rounded border border-red-800/50">
            ERROR
          </span>
        )}
        {(item.content || item.output) && (
          <span className="ml-auto text-dark-500">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {item.content && (
            <div className="text-sm text-dark-200 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm">
                {item.content.slice(0, 2000)}
              </ReactMarkdown>
            </div>
          )}
          {item.input && (
            <div className="mt-1">
              <span className="text-xs text-dark-500">Input:</span>
              <pre className="text-xs bg-dark-950 text-dark-300 p-2 rounded mt-1 overflow-x-auto">
                {JSON.stringify(item.input, null, 2)}
              </pre>
            </div>
          )}
          {item.output && (
            <div className="mt-1">
              <span className="text-xs text-dark-500">Output:</span>
              <pre className="text-xs bg-dark-950 text-green-300 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">
                {item.output.slice(0, 2000)}
              </pre>
            </div>
          )}
          {item.error && (
            <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded mt-1">
              {item.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentPanel() {
  const {
    userId, selectedModel, selectedProvider,
    agentRunning, agentTrace, agentFinalAnswer, agentSteps,
    setAgentRunning, addAgentTrace, clearAgentTrace, setAgentFinalAnswer, setAgentSteps,
    addConversation, setActiveConversation,
  } = useStore()

  const [task, setTask] = useState('')
  const [maxSteps, setMaxSteps] = useState(10)
  const [executeCode, setExecuteCode] = useState(true)
  const [useMemory, setUseMemory] = useState(true)
  const [activeConvId, setActiveConvId] = useState<string | null>(null)

  const EXAMPLE_TASKS = [
    "Calculate the first 20 Fibonacci numbers and find which ones are prime",
    "Write a Python function to parse JSON, add error handling, and test it with sample data",
    "Create a simple REST API design for a todo app with CRUD operations",
    "Analyze the time complexity of bubble sort vs quicksort with examples",
    "Generate a markdown report about the benefits of async programming",
  ]

  const handleRun = async () => {
    const taskText = task.trim()
    if (!taskText || agentRunning) return

    clearAgentTrace()
    setAgentFinalAnswer('')
    setAgentRunning(true)
    setAgentSteps(0)

    // Create conversation
    let convId: string | null = null
    try {
      const r = await conversationsApi.create({
        user_id: userId,
        title: `Agent: ${taskText.slice(0, 50)}`,
        model: selectedModel,
        provider: selectedProvider,
        task_type: 'agent',
      })
      convId = r.data.id
      setActiveConvId(convId)
      addConversation(r.data)
      setActiveConversation(convId)
    } catch {
      // Continue without DB
    }

    try {
      const r = await agentApi.runTask({
        task: taskText,
        conversation_id: convId || undefined,
        model: selectedModel,
        provider: selectedProvider,
        max_steps: maxSteps,
        execute_code: executeCode,
        user_id: userId,
        use_memory: useMemory,
      })

      const data = r.data
      setAgentSteps(data.steps || 0)
      setAgentFinalAnswer(data.final_answer || '')

      // Populate trace
      if (data.trace && Array.isArray(data.trace)) {
        for (const step of data.trace) {
          addAgentTrace(step)
        }
      }

      toast.success(`Agent completed in ${data.steps} steps`)
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || err.message || 'Agent failed'
      toast.error(errMsg)
      addAgentTrace({ step: 0, type: 'error', content: errMsg })
    } finally {
      setAgentRunning(false)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel - task input */}
      <div className="w-80 flex-shrink-0 border-r border-dark-800 flex flex-col p-4 gap-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-purple-400" />
          <h2 className="font-semibold text-white">Autonomous Agent</h2>
        </div>
        <p className="text-xs text-dark-400">
          Phase 5+6: Multi-step autonomous planning with tool calling, code execution & memory.
        </p>

        {/* Task input */}
        <div>
          <label className="text-xs text-dark-400 mb-1 block font-medium">Task</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what you want the agent to do..."
            rows={4}
            className="input-field text-sm resize-none"
            disabled={agentRunning}
          />
        </div>

        {/* Options */}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-dark-400 mb-1 block">Max Steps: {maxSteps}</label>
            <input
              type="range" min={1} max={20} value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              className="w-full accent-brand-500"
              disabled={agentRunning}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={executeCode}
              onChange={(e) => setExecuteCode(e.target.checked)}
              className="rounded accent-brand-500"
              disabled={agentRunning}
            />
            <span className="text-xs text-dark-300">Execute code blocks</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={useMemory}
              onChange={(e) => setUseMemory(e.target.checked)}
              className="rounded accent-brand-500"
              disabled={agentRunning}
            />
            <span className="text-xs text-dark-300">Use memory system</span>
          </label>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!task.trim() || agentRunning}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {agentRunning ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Running... ({agentSteps} steps)
            </>
          ) : (
            <>
              <Play size={16} />
              Run Agent
            </>
          )}
        </button>

        {/* Examples */}
        <div>
          <p className="text-xs text-dark-500 mb-2 font-medium">EXAMPLES</p>
          <div className="space-y-1.5">
            {EXAMPLE_TASKS.map((t) => (
              <button
                key={t}
                onClick={() => setTask(t)}
                disabled={agentRunning}
                className="w-full text-left text-xs text-dark-400 hover:text-white px-2 py-1.5 
                           rounded bg-dark-800/50 hover:bg-dark-800 transition-colors 
                           border border-dark-700/50 hover:border-dark-600 leading-relaxed"
              >
                <Lightbulb size={10} className="inline mr-1 text-yellow-500" />
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - trace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-dark-800 bg-dark-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-sm font-medium text-white">Execution Trace</span>
            {agentTrace.length > 0 && (
              <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded">
                {agentTrace.length} events
              </span>
            )}
          </div>
          {agentTrace.length > 0 && !agentRunning && (
            <button
              onClick={clearAgentTrace}
              className="text-xs text-dark-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Trace content */}
        <div className="flex-1 overflow-y-auto p-4">
          {agentTrace.length === 0 && !agentRunning ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Bot size={40} className="text-dark-600 mb-4" />
              <p className="text-dark-400 text-sm">No agent runs yet</p>
              <p className="text-dark-600 text-xs mt-1">Enter a task and click "Run Agent"</p>
            </div>
          ) : (
            <>
              {agentRunning && agentTrace.length === 0 && (
                <div className="flex items-center gap-3 p-3 bg-dark-900 border border-dark-800 rounded-lg mb-3">
                  <Loader2 size={16} className="animate-spin text-brand-400" />
                  <span className="text-sm text-dark-300">Agent starting...</span>
                </div>
              )}

              {agentTrace.map((step, i) => (
                <TraceStepCard key={`${step.step}-${step.type}-${i}`} item={step} />
              ))}

              {agentRunning && (
                <div className="flex items-center gap-3 p-3 bg-dark-900 border border-dark-700 rounded-lg mt-2">
                  <Loader2 size={14} className="animate-spin text-brand-400" />
                  <span className="text-xs text-dark-400">
                    Step {agentSteps} / {maxSteps} — thinking...
                  </span>
                </div>
              )}

              {/* Final Answer */}
              {agentFinalAnswer && (
                <div className="mt-4 p-4 bg-cyan-900/20 border border-cyan-700/50 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={16} className="text-cyan-400" />
                    <span className="text-sm font-semibold text-cyan-300">Final Answer</span>
                  </div>
                  <div className="prose prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {agentFinalAnswer}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
