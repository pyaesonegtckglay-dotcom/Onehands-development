# 🤖 AUTONOMOUS AI DEVELOPER OS — MASTER BLUEPRINT
## Real Working System | HuggingFace Backend + Vercel Frontend

**Author:** Autonomous Build Plan  
**Date:** 2026-05-23  
**Target:** Real, live, fully working Autonomous AI Developer platform

---

## 🔍 DIAGNOSIS: WHY THE CURRENT SYSTEM FAILS

### Root Cause Analysis (from live testing):
```
PROBLEM 1: HF Space CPU=99.8%, Memory=97.3% → FREE TIER OVERLOADED
  → Phase9/Phase10 modules are TOO HEAVY (50KB each) → kills free tier
  → Fix: Single lean app.py with lazy loading

PROBLEM 2: db=false, redis=false → Connections crash on startup
  → asyncpg + redis connection pools fail silently → agent has no memory
  → Fix: Bulletproof connection with retry + in-memory fallback

PROBLEM 3: Agent "state=Failed" even on simple tasks
  → hello.py created, subprocess ran, stdout="" (empty) = "Failed"
  → Fix: Proper output detection, E2B direct execution

PROBLEM 4: /dev/workflow returns 404 on live HF
  → Local repo ≠ deployed HF Space (out of sync)
  → Fix: Proper HuggingFace Space sync via git push

PROBLEM 5: Frontend API URL mismatch / CORS issues
  → poe-agent.vercel.app calls wrong backend URL
  → Fix: Correct VITE_BACKEND_URL env var in Vercel settings

PROBLEM 6: No requirements.txt in hf_space/
  → Dockerfile copies ., requirements.txt doesn't exist → build fails
  → Fix: Generate proper requirements.txt
```

---

## 🏗️ ARCHITECTURE

```
┌──────────────────────────────────────────────────┐
│              FRONTEND (Vercel)                    │
│  poe-agent.vercel.app                             │
│  React 18 + Vite + TypeScript + TailwindCSS       │
│  • Chat Panel (SSE streaming)                     │
│  • Agent Panel (live task trace)                  │
│  • Code Execute Panel (E2B)                       │
│  • Dev Panel (Generate→Test→GitHub→Deploy)        │
│  • Memory Panel                                   │
│  • Health Dashboard                               │
└─────────────────┬────────────────────────────────┘
                  │ HTTPS/SSE/WS
┌─────────────────▼────────────────────────────────┐
│              BACKEND (HuggingFace Space)          │
│  PYAE1994/openhands-genspark-agent                │
│  FastAPI + uvicorn (port 7860)                    │
│  ┌─────────────────────────────────────────────┐ │
│  │  AGENT CORE (single lean app.py)            │ │
│  │  • LLM Router (Gemini/GitHub/SambaNova)     │ │
│  │  • ReAct Agent Loop                         │ │
│  │  • Tool Engine                              │ │
│  │  • Code Execution (E2B + local fallback)    │ │
│  │  • File Workspace                           │ │
│  │  • GitHub Ops                               │ │
│  │  • Deploy Agent (HF + Vercel)               │ │
│  └─────────────────────────────────────────────┘ │
└──────┬──────────────┬───────────────┬────────────┘
       │              │               │
┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
│  Supabase   │ │  Upstash  │ │    E2B      │
│  PostgreSQL │ │   Redis   │ │  Sandbox    │
│  (memory)   │ │ (pub/sub) │ │ (code exec) │
└─────────────┘ └───────────┘ └─────────────┘
```

---

## 📋 PHASES & STEPS (Exact Implementation Order)

---

### PHASE 0: REPOSITORY & INFRASTRUCTURE SETUP
**Goal:** Clean repo structure, proper secrets, HF Space configured

#### Step 0.1 — Create clean `hf_space/requirements.txt`
- All Python deps: fastapi, uvicorn, httpx, asyncpg, redis, e2b-code-interpreter, PyGithub
- Pinned versions for reproducibility

#### Step 0.2 — Fix `hf_space/Dockerfile`  
- Proper multi-stage build
- Health check corrected
- PORT=7860

#### Step 0.3 — Configure HuggingFace Space Secrets
Secrets to set in HF Space Settings → Variables tab:
```
GEMINI_KEY=<your gemini keys, comma-separated>
GITHUB_TOKEN=<your github personal access token>
DATABASE_URL=<your supabase postgresql connection string>
REDIS_URL=<your upstash redis connection string>
E2B_API_KEY=<your e2b api key>
HF_TOKEN=<your huggingface token>
VERCEL_TOKEN=<your vercel token>
```

#### Step 0.4 — Configure Vercel Environment Variables
```
VITE_BACKEND_URL=https://pyae1994-openhands-genspark-agent.hf.space
```

---

### PHASE 1: LEAN BACKEND CORE (app.py rewrite)
**Goal:** Single file, lean, production-ready FastAPI backend

#### Step 1.1 — LLM Smart Router (`smart_router.py`)
- Multi-provider: Gemini 2.0 Flash, GitHub gpt-4o-mini, SambaNova
- Round-robin key selection
- Per-key cooldown (429→60s, 401→300s, 5xx→30s)
- Auto-fallback chain: gemini → github → sambanova
- **FIXED:** Async streaming support
- **FIXED:** Correct response parsing per provider

#### Step 1.2 — Database Layer (`db.py`)
- asyncpg connection pool (min=1, max=5)  
- **FIXED:** URL encoding for special chars in password (@)
- **FIXED:** Graceful in-memory fallback (no crash on DB failure)
- Tables: conversations, messages, executions, memory, tool_calls
- Auto-create tables on startup

#### Step 1.3 — Main Application (`app.py`)
- Single file, all routes (NO heavy phase9/phase10 imports)
- **FIXED:** All routes included, no 404s
- CORS: allow all (*)
- Startup: init DB + Redis (non-blocking, fallback OK)

---

### PHASE 2: AGENT CORE ENGINE
**Goal:** Real working ReAct agent that actually executes tasks

#### Step 2.1 — ReAct Agent Loop
```
LOOP (max_steps):
  1. THINK: LLM analyzes task + history → generates thought
  2. ACT: Parse action from LLM output (tool_name + input)
  3. EXECUTE: Run the tool, get real output
  4. OBSERVE: Feed output back to LLM
  5. CHECK: "FINAL ANSWER:" → done
```

**FIXED Issues:**
- Proper output detection (stdout="" is NOT failure)
- Code blocks auto-extracted and executed
- Tool results properly parsed
- Max steps respected

#### Step 2.2 — Tool Engine (8 Built-in Tools)
```python
TOOLS = {
  "execute_code":   Run Python/JS/Bash in E2B sandbox
  "web_search":     DuckDuckGo search → real results
  "read_url":       HTTP content fetch
  "create_file":    Create file in workspace
  "read_file":      Read file from workspace
  "list_files":     List workspace files
  "github_op":      GitHub create/commit/PR operations
  "write_memory":   Save to persistent memory
}
```

#### Step 2.3 — E2B Code Execution
- **PRIMARY:** e2b-code-interpreter (isolated sandbox)
- **FALLBACK:** subprocess with timeout (safe Python/bash)
- **FIXED:** Proper stdout/stderr capture
- **FIXED:** Result includes both print() output AND return values
- Timeout: 30s default, 120s max

---

### PHASE 3: STREAMING & REALTIME
**Goal:** Token-by-token streaming that works

#### Step 3.1 — SSE Streaming Chat
- POST /chat/stream → Server-Sent Events
- Real token streaming from Gemini/OpenAI APIs
- Fallback: chunked word-by-word if streaming fails
- Keepalive pings every 15s

#### Step 3.2 — WebSocket Support
- /ws/{room} for bi-directional real-time
- Agent progress events pushed via WebSocket
- Broadcast to all subscribers in room

#### Step 3.3 — Redis Pub/Sub (optional, graceful)
- Publish agent events to Redis channel
- SSE bridge subscribes to Redis
- If Redis unavailable → direct WebSocket only

---

### PHASE 4: DEVELOPER WORKFLOW (Core Feature)
**Goal:** Real autonomous code generation and deployment

#### Step 4.1 — Code Generator
- Input: natural language description + stack
- Output: complete project files (main.py, tests, Dockerfile, README)
- LLM generates file-by-file with proper structure
- Files saved to per-user workspace

#### Step 4.2 — GitHub Integration (REAL)
- list_repos, create_repo, get_file, create_branch
- commit_files (batch commit multiple files)
- create_pr (auto PR with description)
- **FIXED:** Uses PyGitHub library with proper auth

#### Step 4.3 — Async Task Queue
- POST /tasks → returns task_id immediately
- Background execution with progress tracking
- GET /tasks/{id} → poll status/progress/result
- In-memory queue (Redis-backed when available)

#### Step 4.4 — Deploy Agent
- **HuggingFace Deploy:** Push files via HF Hub API
- **Vercel Deploy:** POST to Vercel deployments API v13
- Returns live URL on success

#### Step 4.5 — Dev Workflow (One-Shot)
- POST /dev/workflow → full pipeline:
  1. Generate code
  2. Run tests
  3. Push to GitHub (if token provided)
  4. Deploy (if requested)
  5. Return live URL + report

---

### PHASE 5: PERSISTENT MEMORY
**Goal:** Agent remembers across sessions

#### Step 5.1 — Memory System
- Save facts, task results, skills, preferences
- Importance scoring (0.0-1.0)
- Per-user + per-conversation scope
- Retrieve top-N memories by relevance

#### Step 5.2 — Conversation History
- All messages saved to DB
- History injected into agent context (last 20 msgs)
- System prompt preserved

---

### PHASE 6: FRONTEND (React + Vite)
**Goal:** Clean, fast, fully functional UI

#### Step 6.1 — Core Layout
- Sidebar: conversation list + new chat button
- Main area: tabbed panels
- Header: status indicators, settings

#### Step 6.2 — Chat Panel (REAL SSE streaming)
- Message input → POST /chat/stream
- SSE consumer: displays tokens as they arrive
- Markdown rendering with code highlighting
- Provider badge showing which LLM responded

#### Step 6.3 — Agent Panel (REAL task execution)
- Task input → POST /agent/task
- Live step-by-step trace display
- Tool call visualization (what tool, what input, what output)
- Final result display

#### Step 6.4 — Dev Panel (REAL autonomous workflow)
- Description input + stack selector
- One-click: Generate → Test → GitHub → Deploy
- Live progress log
- Download generated files as ZIP
- View deployed URL

#### Step 6.5 — Code Execute Panel
- Monaco-style code editor
- Run → POST /execute → show output
- Language: Python/JS/Bash

#### Step 6.6 — Health Dashboard
- Live /health polling every 30s
- Status: DB ✅/❌, Redis ✅/❌, E2B ✅/❌, Providers
- API key pool status

#### Step 6.7 — Settings Panel
- Backend URL configuration
- API keys for all providers
- Agent settings (max steps, temperature)
- Persisted to localStorage

---

### PHASE 7: DEPLOYMENT & SYNC
**Goal:** Both HF Space and Vercel are live and working

#### Step 7.1 — HuggingFace Space Deployment
- Push `hf_space/` directory to HF Space repo
- Via: `git push` to `https://huggingface.co/spaces/PYAE1994/openhands-genspark-agent`
- Trigger Docker build on HF
- Verify /health returns status OK

#### Step 7.2 — Vercel Deployment
- Push frontend to GitHub repo
- Vercel auto-deploys from GitHub
- Set VITE_BACKEND_URL env var
- Verify poe-agent.vercel.app loads

#### Step 7.3 — End-to-End Verification
- Chat: send message → get streaming response ✅
- Agent: run task → see steps → get result ✅
- Dev workflow: generate project → GitHub push ✅
- Health: all green ✅

---

## 📁 FILE STRUCTURE

```
hf_space/                    ← HuggingFace Space (backend)
├── app.py                   ← Main FastAPI app (ALL routes, lean)
├── smart_router.py          ← LLM multi-provider router
├── db.py                    ← Database + Redis layer
├── agent.py                 ← ReAct agent loop + tools
├── developer.py             ← Code gen + GitHub + Deploy
├── requirements.txt         ← Python dependencies
├── Dockerfile               ← Container config
└── README.md                ← HF Space card

onehands_frontend/           ← Vercel (frontend)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts               ← All API calls
│   ├── store.ts             ← Zustand state
│   └── components/
│       ├── ChatPanel.tsx
│       ├── AgentPanel.tsx
│       ├── DevPanel.tsx
│       ├── ExecutePanel.tsx
│       ├── HealthPanel.tsx
│       ├── SettingsPanel.tsx
│       └── Sidebar.tsx
├── package.json
├── vite.config.ts
└── vercel.json
```

---

## ✅ SUCCESS CRITERIA

| Feature | Test | Expected |
|---------|------|----------|
| Chat | POST /chat {"message":"hi"} | Response from LLM |
| Stream | POST /chat/stream | SSE tokens arrive |
| Agent | POST /agent/task {"task":"write hello.py"} | File created, code run |
| Dev Generate | POST /dev/generate | Files returned |
| Dev Workflow | POST /dev/workflow | Full pipeline result |
| GitHub | POST /dev/github op=list_repos | Repo list |
| Health | GET /health | db=true OR fallback, e2b=true |
| Frontend | poe-agent.vercel.app | App loads, chat works |

---

## ⚠️ KEY FIXES APPLIED

1. **requirements.txt** — was missing, Docker build failed
2. **Agent "Failed" state** — fixed: empty stdout ≠ failure
3. **/dev/workflow 404** — fixed: sync HF Space with latest code
4. **db/redis crash** — fixed: non-blocking init, fallback mode
5. **CPU/Memory overload** — fixed: removed heavy imports, lazy loading
6. **CORS** — fixed: allow all origins
7. **Streaming** — fixed: proper async generator with keepalive

---

## 🚀 EXECUTION ORDER

```
STEP 1: Write hf_space/requirements.txt
STEP 2: Rewrite hf_space/db.py (lean, bulletproof)
STEP 3: Rewrite hf_space/smart_router.py (fixed providers)
STEP 4: Rewrite hf_space/agent.py (real ReAct loop)
STEP 5: Write hf_space/developer.py (code gen + GitHub + deploy)
STEP 6: Rewrite hf_space/app.py (all routes, lean)
STEP 7: Rewrite onehands_frontend (fix API calls)
STEP 8: Push hf_space/ to HuggingFace via git
STEP 9: Push frontend to GitHub → Vercel auto-deploy
STEP 10: Verify both are live and working
```
