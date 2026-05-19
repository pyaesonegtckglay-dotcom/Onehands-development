---
title: Onehands AI Backend
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
pinned: true
license: mit
app_port: 7860
---

# Onehands AI Backend v3.0 — Phase 1-6 Complete

**Autonomous AI Developer platform backend** — fully operational with all 6 phases.

## ✅ Phase Status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Smart LLM Routing (Gemini/SambaNova/GitHub) | ✅ Active |
| 2 | Persistent Conversations (Supabase PostgreSQL) | ✅ Active |
| 3 | Realtime Streaming (SSE + WebSocket + Redis) | ✅ Active |
| 4 | Code Execution (E2B sandbox + local fallback) | ✅ Active |
| 5 | Autonomous Agent Loop (multi-step planning) | ✅ Active |
| 6 | Memory System + Tool Calling + Advanced Planning | ✅ Active |

## 🔑 Required HF Space Secrets

```
GEMINI_KEY=key1,key2,...
SAMBANOVA_KEY=key1,key2,...
GITHUB_KEY=key1,key2,...
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://...
E2B_API_KEY=...
```

## 📡 API Endpoints

| Method | Path | Phase | Description |
|--------|------|-------|-------------|
| GET | `/` | - | Service info |
| GET | `/health` | 1-6 | Full health check |
| GET | `/health/keys` | 1 | API key pool status |
| POST | `/health/reload-keys` | 1 | Hot-reload API keys |
| POST | `/chat` | 1+2 | Chat (non-streaming) |
| POST | `/chat/stream` | 1+3 | Chat (SSE streaming) |
| GET | `/chat/stream/{id}` | 3 | Subscribe to events |
| WS | `/ws/{room}` | 3 | WebSocket room |
| POST | `/execute` | 4 | Run code in E2B sandbox |
| POST | `/agent/task` | 5+6 | Autonomous agent task |
| POST | `/agent/plan` | 5+6 | Create execution plan |
| GET | `/tools` | 6 | List available tools |
| POST | `/tools/execute` | 6 | Execute a tool |
| POST | `/memory` | 6 | Save memory |
| GET | `/memory` | 6 | Retrieve memories |
| GET | `/conversations` | 2 | List conversations |
| POST | `/conversations` | 2 | Create conversation |
| GET | `/conversations/{id}/messages` | 2 | Get messages |
| GET | `/conversations/{id}/executions` | 4 | Get executions |
| GET | `/conversations/{id}/tool-calls` | 6 | Get tool calls |
| DELETE | `/conversations/{id}` | 2 | Delete conversation |
| GET | `/models` | 1 | Available models list |
