import React, { useState } from 'react'
import { Play, RefreshCw, Terminal, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { executeApi, setBackendUrl, BACKEND_URL } from '../api'

const SAMPLE_CODE: Record<string, string> = {
  python: `# Python example
import math

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Test it
for i in range(10):
    print(f"fib({i}) = {fibonacci(i)}")

# Math example
print(f"\\nπ = {math.pi:.10f}")
print(f"e = {math.e:.10f}")
`,
  javascript: `// JavaScript example
const fibonacci = (n) => {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
};

for (let i = 0; i < 10; i++) {
  console.log(\`fib(\${i}) = \${fibonacci(i)}\`);
}
`,
  bash: `#!/bin/bash
echo "System info:"
echo "Date: $(date)"
echo "Uptime: $(uptime)"
echo ""
echo "Python version: $(python3 --version)"
echo "Node version: $(node --version 2>/dev/null || echo 'not installed')"
`,
}

export default function ExecutePanel() {
  const { settings, setLastExecution, lastExecution } = useStore()
  const [code, setCode] = useState(SAMPLE_CODE.python)
  const [language, setLanguage] = useState('python')
  const [timeout, setTimeoutVal] = useState(30)
  const [running, setRunning] = useState(false)

  const changeLanguage = (lang: string) => {
    setLanguage(lang)
    if (SAMPLE_CODE[lang]) setCode(SAMPLE_CODE[lang])
  }

  const runCode = async () => {
    if (!code.trim() || running) return
    if (settings.backendUrl !== BACKEND_URL) setBackendUrl(settings.backendUrl)
    setRunning(true)

    try {
      const res = await executeApi.run({ code, language, timeout })
      setLastExecution(res.data)
      if (res.data.exit_code === 0) {
        toast.success(`Executed in ${res.data.duration_ms}ms (${res.data.sandbox})`)
      } else {
        toast.error(`Exit code: ${res.data.exit_code}`)
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-dark-800 bg-dark-950">
        <Terminal size={16} className="text-primary-400" />
        <span className="text-sm font-medium text-white">Code Execution</span>
        <div className="flex gap-1 ml-auto">
          {['python', 'javascript', 'bash'].map((lang) => (
            <button
              key={lang}
              onClick={() => changeLanguage(lang)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                language === lang ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={timeout}
          onChange={(e) => setTimeoutVal(Number(e.target.value))}
          min={5} max={120}
          className="input-field w-16 text-xs py-1 px-2"
          title="Timeout (seconds)"
        />
        <button
          onClick={runCode}
          disabled={running || !code.trim()}
          className="btn-primary flex items-center gap-1.5"
        >
          {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 min-h-0 p-4">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full h-full bg-dark-900 text-dark-100 font-mono text-sm p-4 rounded-xl border border-dark-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none"
            spellCheck={false}
            placeholder="Write your code here..."
          />
        </div>

        {/* Output area */}
        {lastExecution && (
          <div className="border-t border-dark-800 p-4 bg-dark-950 max-h-60">
            <div className="flex items-center gap-2 mb-2">
              {lastExecution.exit_code === 0
                ? <CheckCircle size={14} className="text-green-400" />
                : <XCircle size={14} className="text-red-400" />
              }
              <span className="text-xs text-dark-400">
                exit code: {lastExecution.exit_code} •
                {lastExecution.duration_ms}ms •
                sandbox: {lastExecution.sandbox}
              </span>
            </div>

            {lastExecution.stdout && (
              <div>
                <p className="text-xs text-dark-500 mb-1">stdout:</p>
                <pre className="text-xs text-green-300 bg-dark-900 rounded-lg p-3 overflow-auto max-h-28 whitespace-pre-wrap">
                  {lastExecution.stdout}
                </pre>
              </div>
            )}

            {lastExecution.stderr && (
              <div className="mt-2">
                <p className="text-xs text-dark-500 mb-1">stderr:</p>
                <pre className="text-xs text-red-300 bg-dark-900 rounded-lg p-3 overflow-auto max-h-20 whitespace-pre-wrap">
                  {lastExecution.stderr}
                </pre>
              </div>
            )}

            {!lastExecution.stdout && !lastExecution.stderr && (
              <p className="text-xs text-dark-500">
                No output (exit code: {lastExecution.exit_code})
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
