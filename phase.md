# Onehands Autonomous AI Developer — Phase 1-6 Complete

## Architecture
- **Backend**: FastAPI on Hugging Face Space (PYAE1994/openhands-genspark-agent)
- **Frontend**: React+Vite on Vercel (openhands-genspark-frontend.vercel.app)
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
