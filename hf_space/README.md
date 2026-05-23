---
title: Onehands AI Developer
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
pinned: true
license: mit
app_port: 7860
---

# Onehands Autonomous AI Developer v12.0

**Real autonomous AI developer platform** — not just talk, it actually CODES, EXECUTES, and DEPLOYS.

## ✅ What Works

| Feature | Endpoint | Status |
|---------|----------|--------|
| Multi-provider chat | POST /chat | ✅ |
| Streaming chat | POST /chat/stream | ✅ |
| ReAct agent loop | POST /agent/task | ✅ |
| Code execution | POST /execute | ✅ E2B + local |
| Project generation | POST /dev/generate | ✅ |
| GitHub operations | POST /dev/github | ✅ |
| Full dev workflow | POST /dev/workflow | ✅ |
| Code intelligence | POST /dev/explain etc | ✅ |
| Async tasks | POST /tasks | ✅ |
| File workspace | POST /workspace/files | ✅ |
| Memory system | POST /memory | ✅ |

## 🔑 Required Secrets (HF Space Settings → Variables)

```
GEMINI_KEY=key1,key2,...          # Google Gemini API keys
GITHUB_TOKEN=ghp_xxx              # GitHub token (for LLM + GitHub ops)
SAMBANOVA_KEY=xxx                 # SambaNova API key  
DATABASE_URL=postgresql://...     # Supabase PostgreSQL
REDIS_URL=redis://...             # Upstash Redis
E2B_API_KEY=e2b_xxx               # E2B code execution sandbox
HF_TOKEN=hf_xxx                   # HuggingFace token
VERCEL_TOKEN=vcp_xxx              # Vercel deploy token
```

## 🚀 Quick Start

```bash
# Chat
curl -X POST https://pyae1994-openhands-genspark-agent.hf.space/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "provider": "gemini"}'

# Run autonomous agent task
curl -X POST https://pyae1994-openhands-genspark-agent.hf.space/agent/task \
  -H "Content-Type: application/json" \
  -d '{"task": "Write and run a Python fibonacci function", "max_steps": 5}'

# Generate a full project
curl -X POST https://pyae1994-openhands-genspark-agent.hf.space/dev/workflow \
  -H "Content-Type: application/json" \
  -d '{"description": "REST API for todo list", "stack": "python-fastapi"}'
```

## 📡 All API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/models` | Available models |
| POST | `/chat` | Chat (non-streaming) |
| POST | `/chat/stream` | Chat (SSE streaming) |
| WS | `/ws/{room}` | WebSocket |
| POST | `/execute` | Run code in E2B |
| POST | `/agent/task` | Autonomous agent |
| POST | `/agent/plan` | Generate plan |
| POST | `/memory` | Save memory |
| GET | `/memory` | Get memories |
| POST | `/conversations` | Create conversation |
| GET | `/conversations` | List conversations |
| POST | `/dev/generate` | Generate project |
| POST | `/dev/workflow` | Full dev workflow |
| POST | `/dev/github` | GitHub operations |
| POST | `/dev/deploy` | Deploy to Vercel/HF |
| POST | `/dev/explain` | Explain code |
| POST | `/dev/refactor` | Refactor code |
| POST | `/dev/debug` | Debug code |
| POST | `/dev/review` | Review code |
| POST | `/tasks` | Submit async task |
| GET | `/tasks/{id}` | Get task status |
| POST | `/workspace/files` | Create file |
| GET | `/workspace/files` | List files |
