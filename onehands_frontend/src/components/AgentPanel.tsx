import React, { useState } from 'react'
import { Bot, Play, ChevronDown, ChevronRight, Tool, Eye, Brain, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import toast from 'react-hot-toast'
import { useStore, AgentStep, AgentResult } from '../store'
import { agentApi, setBackendUrl, BACKEND_URL } from '../api'

function StepCard({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(isLast || false)
  const hasAction = !!step.action
  const hasFinal = !!step.final_answer

  return (
    <div className="border border-dark-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-dark-800 hover:bg-dark-750 transition-colors text-left"
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
          hasFinal ? 'bg-green-600 text-white' : 'bg-primary-600 text-white'
        }`}>
          {step.step}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-dark-200 truncate">{step.thought?.slice(0, 100) || 'Processing...'}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {hasAction && (
              <span className="text-xs bg-dark-700 text-primary-300 px-2 py-0.5 rounded-full">
                🔧 {step.action}
              </span>
            )}
            {hasFinal && (
              <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">
                ✅ Final Answer
              </span>
            )}
            {step.provider && (
              <span className="text-xs text-dark-500">{step.provider}</span>
            )}
          </div>
        </div>
        {expanded ? <ChevronDown size={14} className="text-dark-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-dark-500 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 bg-dark-900 border-t border-dark-700">
          {/* Thought */}
          {step.thought && (
            <div>
              <div className="flex items-center gap-1 text-xs text-dark-500 mb-1">
                <Brain size={10} /> THOUGHT
              </div>
              <p className="text-sm text-dark-300">{step.thought}</p>
            </div>
          )}

          {/* Action */}
          {step.action && (
            <div>
              <div className="flex items-center gap-1 text-xs text-dark-500 mb-1">
                <Zap size={10} /> ACTION: {step.action}
              </div>
              <pre className="text-xs bg-dark-800 rounded-lg p-2 overflow-x-auto text-primary-300">
                {typeof step.action_input === 'object'
                  ? JSON.stringify(step.action_input, null, 2)
                  : String(step.action_input || '')
                }
              </pre>
            </div>
          )}

          {/* Observation */}
          {step.observation && (
            <div>
              <div className="flex items-center gap-1 text-xs text-dark-500 mb-1">
                <Eye size={10} /> OBSERVATION
              </div>
              <pre className="text-xs bg-dark-800 rounded-lg p-2 overflow-x-auto text-green-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {step.observation}
              </pre>
            </div>
          )}

          {/* Final Answer */}
          {step.final_answer && (
            <div>
              <div className="flex items-center gap-1 text-xs text-green-500 mb-1">
                <CheckCircle size={10} /> FINAL ANSWER
              </div>
              <div className="text-sm text-dark-200 bg-dark-800 rounded-lg p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.final_answer}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentPanel() {
  const { settings, userId, setAgentResult, agentResult, setAgentRunning, agentRunning } = useStore()
  const [task, setTask] = useState('')
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps || 10)

  const runTask = async () => {
    if (!task.trim() || agentRunning) return
    setAgentRunning(true)
    setAgentResult(null)

    if (settings.backendUrl !== BACKEND_URL) setBackendUrl(settings.backendUrl)

    try {
      const res = await agentApi.task({
        task: task.trim(),
        provider: settings.provider,
        model: settings.model,
        max_steps: maxSteps,
        execute_code: settings.autoExecuteCode,
        use_memory: settings.useMemory,
        user_id: userId,
        system_prompt: settings.systemPrompt || undefined,
      })
      setAgentResult(res.data)
      toast.success(`Agent completed: ${res.data.status}`)
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message
      toast.error(`Agent error: ${msg}`)
    } finally {
      setAgentRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Input area */}
      <div className="p-4 border-b border-dark-800 space-y-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary-400" />
          <h2 className="text-white font-semibold">Autonomous Agent</h2>
          <span className="text-xs text-dark-500 bg-dark-800 px-2 py-0.5 rounded-full">ReAct Loop</span>
        </div>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Give the agent a task... e.g. 'Write a Python fibonacci function, test it, and show the results'"
          rows={3}
          className="input-field w-full resize-none text-sm"
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-dark-400">Max steps:</label>
            <input
              type="number"
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              min={1} max={25}
              className="input-field w-16 text-xs py-1 px-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-dark-400">Provider:</label>
            <select
              value={settings.provider}
              onChange={(e) => useStore.getState().updateSettings({ provider: e.target.value })}
              className="input-field text-xs py-1 px-2"
            >
              <option value="gemini">Gemini</option>
              <option value="github">GitHub (GPT)</option>
              <option value="sambanova">SambaNova</option>
            </select>
          </div>
          <button
            onClick={runTask}
            disabled={!task.trim() || agentRunning}
            className="btn-primary flex items-center gap-2 ml-auto"
          >
            <Play size={14} />
            {agentRunning ? 'Running...' : 'Run Agent'}
          </button>
        </div>
        {agentRunning && (
          <div className="flex items-center gap-2 text-sm text-primary-400 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" />
            Agent is thinking and acting...
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {agentResult && (
          <>
            {/* Summary */}
            <div className="bg-dark-800 rounded-xl p-4 flex items-start gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                agentResult.status === 'completed' ? 'bg-green-600' : 'bg-red-600'
              }`}>
                {agentResult.status === 'completed' ? <CheckCircle size={18} className="text-white" /> : <XCircle size={18} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${agentResult.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                    {agentResult.status.toUpperCase()}
                  </span>
                  <span className="text-xs text-dark-500">
                    {agentResult.steps_taken} steps
                  </span>
                  {agentResult.duration_ms && (
                    <span className="text-xs text-dark-500 flex items-center gap-1">
                      <Clock size={10} />
                      {(agentResult.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <p className="text-xs text-dark-400 mt-1 truncate">{agentResult.task}</p>
              </div>
            </div>

            {/* Final Answer */}
            {agentResult.final_answer && (
              <div className="bg-dark-800 rounded-xl p-4 border border-green-800">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={14} className="text-green-400" />
                  <span className="text-sm font-semibold text-green-400">Final Answer</span>
                </div>
                <div className="text-sm text-dark-200 prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentResult.final_answer}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Steps */}
            <div>
              <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wide mb-2">
                Execution Trace ({agentResult.history.length} steps)
              </h3>
              <div className="space-y-2">
                {agentResult.history.map((step, idx) => (
                  <StepCard
                    key={step.step}
                    step={step}
                    isLast={idx === agentResult.history.length - 1}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {!agentResult && !agentRunning && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <Bot size={40} className="text-dark-600" />
            <p className="text-dark-500 text-sm">Enter a task above and click Run Agent</p>
            <div className="grid grid-cols-1 gap-2 max-w-xs">
              {[
                'Write a Python fibonacci function and test it',
                'Search for the latest FastAPI features',
                'Create a simple REST API with Python',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setTask(s)}
                  className="text-xs text-left bg-dark-800 hover:bg-dark-700 rounded-xl p-3 text-dark-400 hover:text-dark-200 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
