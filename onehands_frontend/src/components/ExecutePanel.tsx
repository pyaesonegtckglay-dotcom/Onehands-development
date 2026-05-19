import React, { useState } from 'react'
import { Play, Copy, Trash2, Loader2, Code2, CheckCircle, XCircle, Clock } from 'lucide-react'
import { useStore } from '../store'
import { executeApi } from '../api'
import toast from 'react-hot-toast'

const DEFAULT_CODE = `# Phase 4: E2B Sandboxed Code Execution
# Try any Python code — it runs in a secure sandbox

import math
import json

# Fibonacci sequence
def fibonacci(n):
    a, b = 0, 1
    seq = []
    for _ in range(n):
        seq.append(a)
        a, b = b, a + b
    return seq

fib = fibonacci(15)
print("Fibonacci:", fib)
print("Primes in Fibonacci:", [n for n in fib if n > 1 and all(n % i != 0 for i in range(2, int(math.sqrt(n))+1))])

# Data manipulation
data = {"numbers": [1, 2, 3, 4, 5], "sum": sum([1,2,3,4,5])}
print("\\nJSON output:", json.dumps(data, indent=2))
`

export default function ExecutePanel() {
  const {
    codeOutput, codeError, codeRunning,
    setCodeOutput, setCodeError, setCodeRunning,
    activeConversationId,
  } = useStore()

  const [code, setCode] = useState(DEFAULT_CODE)
  const [language, setLanguage] = useState('python')
  const [timeout, setTimeoutVal] = useState(30)
  const [duration, setDuration] = useState<number | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [provider, setProvider] = useState<string>('')

  const handleRun = async () => {
    if (!code.trim() || codeRunning) return
    setCodeRunning(true)
    setCodeOutput('')
    setCodeError('')
    setDuration(null)
    setExitCode(null)
    setProvider('')

    try {
      const r = await executeApi.run({
        code,
        language,
        timeout,
        conversation_id: activeConversationId || undefined,
      })
      setCodeOutput(r.data.output || '')
      setCodeError(r.data.error || '')
      setDuration(r.data.duration_ms)
      setExitCode(r.data.exit_code)
      setProvider(r.data.provider || '')

      if (r.data.exit_code === 0) {
        toast.success('Execution successful')
      } else {
        toast.error('Execution had errors')
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Execution failed'
      setCodeError(msg)
      toast.error(msg)
    } finally {
      setCodeRunning(false)
    }
  }

  const EXAMPLES: Record<string, string> = {
    fibonacci: DEFAULT_CODE,
    dataScience: `import statistics
import json

data = [12, 15, 14, 10, 18, 11, 13, 15, 17, 14, 12, 15]
print("Data:", data)
print(f"Mean: {statistics.mean(data):.2f}")
print(f"Median: {statistics.median(data)}")
print(f"Stdev: {statistics.stdev(data):.2f}")
print(f"Min: {min(data)}, Max: {max(data)}")

# Frequency count
from collections import Counter
freq = Counter(data)
print("\\nFrequency:", dict(sorted(freq.items())))
`,
    async_example: `import asyncio

async def fetch_data(name, delay):
    await asyncio.sleep(delay)
    return f"{name}: done after {delay}s"

async def main():
    tasks = [
        fetch_data("Task A", 0.1),
        fetch_data("Task B", 0.2),
        fetch_data("Task C", 0.05),
    ]
    results = await asyncio.gather(*tasks)
    for r in results:
        print(r)

asyncio.run(main())
`,
    oop: [
      "class BankAccount:",
      "    def __init__(self, owner, balance=0):",
      "        self.owner = owner",
      "        self._balance = balance",
      "        self._transactions = []",
      "",
      "    def deposit(self, amount):",
      "        if amount <= 0:",
      "            raise ValueError('Amount must be positive')",
      "        self._balance += amount",
      "        self._transactions.append(('deposit', amount))",
      "        return self",
      "",
      "    def withdraw(self, amount):",
      "        if amount > self._balance:",
      "            raise ValueError('Insufficient funds')",
      "        self._balance -= amount",
      "        self._transactions.append(('withdraw', amount))",
      "        return self",
      "",
      "    @property",
      "    def balance(self):",
      "        return self._balance",
      "",
      "    def statement(self):",
      "        print('Account:', self.owner)",
      "        for t_type, amount in self._transactions:",
      "            print(' ', t_type, '$', round(amount, 2))",
      "        print('  Balance $', round(self._balance, 2))",
      "",
      "acc = BankAccount('John')",
      "acc.deposit(1000).deposit(500).withdraw(200).withdraw(100)",
      "acc.statement()",
    ].join("\n"),
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Editor panel */}
      <div className="flex-1 flex flex-col border-r border-dark-800">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-dark-800 bg-dark-900">
          <Code2 size={16} className="text-green-400" />
          <span className="text-sm font-medium text-white">Code Execution</span>
          <span className="text-xs text-dark-500">Phase 4 — E2B Sandbox</span>

          <div className="ml-auto flex items-center gap-2">
            {/* Language selector */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input-field text-xs py-1 w-28"
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="bash">Bash</option>
            </select>

            {/* Examples */}
            <select
              onChange={(e) => e.target.value && setCode(EXAMPLES[e.target.value])}
              className="input-field text-xs py-1 w-36"
              defaultValue=""
            >
              <option value="">Examples...</option>
              <option value="fibonacci">Fibonacci + Primes</option>
              <option value="dataScience">Statistics</option>
              <option value="async_example">Async/Await</option>
              <option value="oop">OOP / Classes</option>
            </select>

            {/* Timeout */}
            <select
              value={timeout}
              onChange={(e) => setTimeoutVal(Number(e.target.value))}
              className="input-field text-xs py-1 w-24"
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>120s</option>
            </select>

            <button
              onClick={() => setCode('')}
              className="btn-secondary text-xs px-2 py-1 flex items-center gap-1"
              title="Clear editor"
            >
              <Trash2 size={12} />
            </button>

            <button
              onClick={handleRun}
              disabled={!code.trim() || codeRunning}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2"
            >
              {codeRunning ? (
                <><Loader2 size={14} className="animate-spin" /> Running...</>
              ) : (
                <><Play size={14} /> Run</>
              )}
            </button>
          </div>
        </div>

        {/* Code editor */}
        <div className="flex-1 overflow-hidden">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full h-full bg-dark-950 text-dark-200 font-mono text-sm p-4 
                       resize-none outline-none border-0 leading-relaxed"
            spellCheck={false}
            placeholder="# Enter Python code here..."
          />
        </div>
      </div>

      {/* Output panel */}
      <div className="w-96 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-dark-800 bg-dark-900">
          <span className="text-sm font-medium text-white">Output</span>
          {duration !== null && (
            <div className="flex items-center gap-2">
              {exitCode === 0 ? (
                <CheckCircle size={14} className="text-green-400" />
              ) : (
                <XCircle size={14} className="text-red-400" />
              )}
              <span className="text-xs text-dark-400">
                {duration}ms {provider && `· ${provider}`}
              </span>
            </div>
          )}
        </div>

        {/* Output content */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-sm">
          {!codeOutput && !codeError && !codeRunning ? (
            <div className="text-dark-600 text-sm text-center py-8">
              Run code to see output here
            </div>
          ) : codeRunning ? (
            <div className="flex items-center gap-2 text-dark-400">
              <Loader2 size={14} className="animate-spin text-brand-400" />
              <span>Executing in E2B sandbox...</span>
            </div>
          ) : (
            <>
              {codeOutput && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-green-500 font-medium">stdout</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(codeOutput)}
                      className="text-xs text-dark-500 hover:text-white flex items-center gap-1"
                    >
                      <Copy size={10} /> copy
                    </button>
                  </div>
                  <pre className="text-green-300 whitespace-pre-wrap leading-relaxed">
                    {codeOutput}
                  </pre>
                </div>
              )}
              {codeError && (
                <div className="mt-3">
                  <span className="text-xs text-red-400 font-medium">stderr</span>
                  <pre className="text-red-300 whitespace-pre-wrap mt-1 leading-relaxed">
                    {codeError}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
