# Onehands Autonomous AI Developer — Phase 1-10 Complete

## Architecture
- **Backend**: FastAPI on Hugging Face Space (PYAE1994/openhands-genspark-agent)
- **Frontend**: React 18 + Vite + TypeScript on Vercel (poe-agent.vercel.app)
- **Database**: Supabase PostgreSQL (conversations, messages, executions, memory, tool_calls, plans)
- **Cache/Realtime**: Upstash Redis (pub/sub, SSE bridge)
- **Code Execution**: E2B sandbox + local fallback
- **LLM Providers**: Gemini, SambaNova, GitHub Models, OpenAI, Anthropic, Groq, OpenRouter

## Phase 1: Smart LLM Routing ✅
- Multi-provider routing: Gemini / SambaNova / GitHub Models / OpenAI / Anthropic / Groq / OpenRouter
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
- Multi-step task planning (up to 50 steps, configurable)
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
- Zustand state management with persistence (v2 store)
- **Error Boundary**: catches crashes, shows reload button
- **Chat Panel**: SSE streaming, markdown rendering, code highlighting, provider badges
- **Agent Panel**: Task runner with real-time trace, step visualization, tool call display
- **Execute Panel**: Code editor, language selector, E2B output display
- **Memory Panel**: Memory viewer/creator with importance rating
- **Health Panel**: Live system status, phase indicators, API key pool status
- **Settings Panel**: 6 sub-tabs: LLM, API Keys, Agent, UI, System, About
  - Multi-key management for all providers
  - Agent config (max steps, auto-execute, memory)
  - Full API key management (masked inputs with show/hide)
- **Dev Panel**: Full Phase 9 developer workflow
- **Connector Panel**: Universal platform connector (30+ platforms)
- Sidebar with conversation history

## Phase 9: True Autonomous AI Developer ✅
The agent doesn't just TALK about coding — it actually DOES it end-to-end.

### 9.1 Full-Stack Code Generator
- Generate complete production-ready projects from natural language
- Supported stacks: `python-fastapi`, `node-express`, `react-vite`, `fullstack-python`, `fullstack-node`
- LLM-powered architecture planning → file-by-file code generation
- Auto-includes Dockerfile, test files, README.md
- Endpoints: `POST /dev/generate`, `GET /dev/stacks`

### 9.2 GitHub Developer Agent
- Full GitHub REST API integration
- Operations: list_repos, create_repo, get_tree, get_file, create_branch, commit_files, create_pr, list_prs
- Endpoint: `POST /dev/github`

### 9.3 Async Task Queue
- All long-running tasks run in background
- Real-time progress tracking with step-by-step log
- Endpoints: `POST /tasks`, `GET /tasks/{id}`, `GET /tasks/{id}/result`, `GET /tasks`

### 9.4 Deploy Agent (Vercel + HuggingFace)
- Deploy project files to Vercel (v13 deployment API)
- Deploy project files to HuggingFace Spaces
- Endpoint: `POST /dev/deploy`

### 9.5 Test Runner
- AI auto-generates pytest/jest tests from source code
- Executes tests in E2B sandbox
- Endpoint: `POST /dev/test`

### 9.6 File Workspace
- Per-user in-memory file sandbox
- Endpoints: `POST/GET /workspace/files`, `GET/DELETE /workspace/files/{filename}`

### 9.8 Code Review Agent
- AI-powered code review (bug detection, security, performance, style)
- Endpoint: `POST /dev/review`

### 9.9 Full Developer Workflow (Generate → Test → GitHub → Deploy)
- One-shot autonomous developer workflow
- Endpoint: `POST /dev/workflow`

### 9.9 Metrics Dashboard
- Endpoint: `GET /dev/metrics`

## Phase 10: Universal Connector + Real Autonomous AI Developer ✅

### 10.1 Universal Platform Connector (30+ platforms)
- Connect any platform with token/API key
- **Code/Dev**: GitHub, GitLab, HuggingFace, E2B
- **AI Models**: OpenAI, Anthropic, Groq, OpenRouter
- **Deploy**: Vercel, Netlify, Railway, Heroku, AWS, GCP, Azure
- **Database**: Supabase, Firebase, MongoDB, PostgreSQL, Redis
- **Project Mgmt**: Jira, Notion, Linear, Trello
- **Messaging**: Slack, Discord, Telegram
- **Design**: Figma
- **Browser**: BrowserBase
- **Automation**: Zapier
- **Custom**: Any HTTP API
- Test connectivity with one click
- Agent can use any connected platform autonomously
- Endpoints: `POST /connector/test`, `POST /connector/call`, `GET /connector/platforms`

### 10.2 Browser Agent
- Visit URLs and extract text/HTML/links/JSON
- Web search via DuckDuckGo API
- Endpoints: `POST /browser/visit`, `POST /browser/search`

### 10.3 Code Intelligence Suite
- **Explain**: Understand any code
- **Refactor**: Improve code quality
- **Debug**: Fix bugs with error context
- **Document**: Generate docstrings/docs
- **Convert**: Translate between programming languages
- Endpoints: `POST /dev/explain`, `/dev/refactor`, `/dev/debug`, `/dev/document`, `/dev/convert`

### 10.4 Collaboration Notifications
- Send notifications to Slack/Discord/Telegram when tasks complete
- Endpoint: `POST /collab/notify`

### 10.5 Custom Tool Registry
- Agent can register new tools dynamically
- Tools persist in-process
- Endpoints: `POST /agent/tools/register`, `GET /agent/tools/custom`

## Frontend Phase 10: Connector Panel ✅
- **Universal Connector** tab in header
- Category sidebar: All, Code, AI, Deploy, Database, Project, Messaging, Design, Cloud, Automation, Custom
- Search/filter connectors
- Per-connector expand → fill credentials → Test & Save
- Connected badges shown in header
- Connected count badge on Connector tab
- Credentials masked (show/hide toggle)
- Per-connector status (ok/error/testing)
- Last tested timestamp
