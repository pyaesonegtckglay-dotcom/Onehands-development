# Onehands Autonomous AI Developer — Phase 1-9 Complete

## Architecture
- **Backend**: FastAPI on Hugging Face Space (PYAE1994/openhands-genspark-agent)
- **Frontend**: React+Vite on Vercel (poe-agent.vercel.app)
- **Database**: Supabase PostgreSQL (conversations, messages, executions, memory, tool_calls, plans)
- **Cache/Realtime**: Upstash Redis (pub/sub, SSE bridge)
- **Code Execution**: E2B sandbox + local fallback
- **LLM Providers**: Gemini, SambaNova, GitHub Models

## Phase 1: Smart LLM Routing ✅
- Multi-provider routing: Gemini / SambaNova / GitHub Models
- Round-robin key selection across multiple API keys
- Per-key cooldown on rate limits (429) → 60s cooldown
- Hard fail cooldown on auth errors (401/403) → 300s
- Server errors (5xx) → 30s cooldown
- Auto-heal: cooldown expires → key becomes available
- Auto-fallback: if preferred provider fails, tries next
- Hot-reload API keys without restart
- Endpoints: POST /chat, GET /health/keys, POST /health/reload-keys

## Phase 2: Persistent Conversations ✅
- Supabase PostgreSQL with asyncpg connection pool (1-8 connections)
- DB URL password encoding fix (handles @ in password)
- Graceful degradation when DB unavailable (in-memory fallback)
- Tables: conversations, messages, executions, agent_memory, tool_calls, agent_plans
- CRUD for conversations with metadata, status tracking
- Message history with role, provider, model, token count
- Endpoints: POST/GET /conversations, GET /conversations/{id}/messages

## Phase 3: Realtime Streaming ✅
- SSE (Server-Sent Events) for token-by-token streaming
- POST /chat/stream → streaming response
- GET /chat/stream/{conv_id} → subscribe to conversation events
- WebSocket rooms (/ws/{room}) with bi-directional chat
- Redis pub/sub bridge for SSE (Upstash Redis with TLS)
- Fallback: non-streaming mode if streaming fails, with word-by-word simulation
- keepalive pings every 50ms to prevent timeouts

## Phase 4: Code Execution ✅
- E2B sandboxed execution (isolated containers)
- Supports Python, JavaScript, Bash
- Local subprocess fallback when E2B key not available
- Captures stdout, stderr, exit code, duration
- Results saved to executions table
- Events emitted via Redis/WebSocket
- Endpoint: POST /execute

## Phase 5: Autonomous Agent Loop ✅
- Multi-step task planning (up to 25 steps)
- LLM generates PLAN → THINK → ACT → OBSERVE cycle
- Code block detection and auto-execution
- Tool call parsing from agent responses (TOOL: tool_name | {input})
- Dynamic memory context injection
- Done detection via FINAL ANSWER keyword or completion keywords
- Full execution trace returned with step-by-step breakdown
- Endpoints: POST /agent/task, POST /agent/plan

## Phase 6: Memory System + Tool Calling ✅
- **Memory System**: save/retrieve agent memories with importance scoring
  - Types: fact, task_result, preference, skill
  - Per-user and per-conversation scoping
  - Importance-based retrieval (0.0-1.0)
  - Endpoints: POST/GET /memory

- **Built-in Tools**:
  - execute_python: Run code in E2B sandbox
  - web_search: DuckDuckGo instant answers API
  - read_url: HTTP content fetching
  - write_memory: Store information
  - recall_memory: Retrieve stored info
  - create_file: Create files in sandbox
  - Endpoints: GET /tools, POST /tools/execute

- **Planning Engine**: Task decomposition into JSON-structured steps
  - Complexity estimation (low/medium/high)
  - Step-by-step execution plan with expected I/O
  - Endpoint: POST /agent/plan

- **Tool Call Persistence**: All tool calls logged to DB with input/output/status/duration

## Frontend (onehands_frontend/) ✅
- React 18 + Vite + TypeScript
- TailwindCSS dark theme design
- Zustand state management with persistence
- **Chat Panel**: SSE streaming, markdown rendering, code highlighting, provider badges
- **Agent Panel**: Task runner with real-time trace, step visualization, tool call display
- **Execute Panel**: Code editor, language selector, E2B output display
- **Memory Panel**: Memory viewer/creator with importance rating
- **Health Panel**: Live system status, phase indicators, API key pool status
- **Settings Panel**: Provider/model/temperature/max_tokens/system_prompt configuration
- Sidebar with conversation history

## Phase 9: True Autonomous AI Developer ✅
The agent doesn't just TALK about coding — it actually DOES it end-to-end.

### 9.1 Full-Stack Code Generator
- Generate complete production-ready projects from natural language description
- Supported stacks: `python-fastapi`, `node-express`, `react-vite`, `fullstack-python`, `fullstack-node`
- LLM-powered architecture planning → file-by-file code generation
- Auto-includes Dockerfile, test files, README.md
- Python syntax validation via E2B
- Files saved to user workspace automatically
- Endpoints: `POST /dev/generate`, `GET /dev/stacks`

### 9.2 GitHub Developer Agent
- Full GitHub REST API integration (via PAT token)
- Operations: `list_repos`, `create_repo`, `get_tree`, `get_file`, `create_branch`, `commit_files`, `create_pr`, `list_prs`
- Supports committing multiple files in one operation
- Auto-creates PR with detailed description
- Endpoint: `POST /dev/github`

### 9.3 Async Task Queue
- All long-running tasks (generate, test, deploy, workflow) run in background
- Real-time progress tracking with step-by-step log
- Redis-augmented in-memory task store
- Poll status with `GET /tasks/{task_id}`
- Get full result with `GET /tasks/{task_id}/result`
- List user's tasks with `GET /tasks`
- Endpoints: `POST /tasks`, `GET /tasks/{id}`, `GET /tasks/{id}/result`, `GET /tasks`

### 9.4 Deploy Agent (Vercel + HuggingFace)
- Deploy project files to **Vercel** (v13 deployment API)
- Deploy project files to **HuggingFace Spaces** (Hub API)
- Supports env var injection for secrets
- Returns deployment URL immediately
- Endpoint: `POST /dev/deploy`

### 9.5 Test Runner
- AI auto-generates pytest/jest/vitest tests from source code
- Executes tests in E2B sandbox (isolated)
- Returns: pass/fail counts, test output, exit code, summary
- Supports Python (pytest) and JavaScript (basic node)
- Endpoint: `POST /dev/test`

### 9.6 File Workspace
- Per-user in-memory file sandbox (persisted across requests)
- CRUD operations on project files
- Generated project files auto-saved here
- Endpoints: `POST/GET /workspace/files`, `GET/DELETE /workspace/files/{filename}`

### 9.8 Code Review Agent
- AI-powered code review (bug detection, security, performance, style)
- Returns structured JSON: score (1-10), issues with severity, suggestions
- Review types: `full`, `security`, `performance`, `style`
- Endpoint: `POST /dev/review`

### 9.9 Full Developer Workflow (Generate → Test → GitHub → Deploy)
- One-shot autonomous developer workflow
- Step 1: Generate full project code
- Step 2: Run tests (if Python)
- Step 3: Push to GitHub (create branch + commit all files + open PR)
- Step 4: Deploy to Vercel or HuggingFace
- Returns: task_id for progress polling, full report on completion
- Endpoint: `POST /dev/workflow`

### 9.9 Metrics Dashboard
- Live agent capability metrics
- Task success rates, operation counts by type
- Uptime, recent task history
- Endpoint: `GET /dev/metrics`

## Frontend Phase 9 Panel (DevPanel) ✅
- **Generate Tab**: Describe project → choose stack → watch files generate live
- **GitHub Tab**: Perform GitHub operations (list/clone/commit/PR)
- **Deploy Tab**: Deploy to Vercel or HuggingFace with one click
- **Test Tab**: Paste code → AI generates + runs tests → see results
- **Review Tab**: Paste code → get AI code review with issue list + score
- **Workflow Tab**: Full end-to-end autonomous developer workflow
- **Metrics Tab**: Live dashboard with success rates, operation counts
- **Tasks Panel**: Real-time task progress tracker with step logs
- **Workspace Panel**: Browse and view generated project files

