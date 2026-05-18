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

# Onehands AI Backend v2.0

**Autonomous AI platform backend** for the Onehands development system.

## Features

- 🔑 **Smart API Routing** — Gemini / SambaNova / GitHub LLM with round-robin, cooldown & auto-heal
- 🔄 **Auto-Fallback** — if one provider fails, automatically tries the next
- 🤖 **Agent Loop** — autonomous multi-step task planning & execution
- 🧪 **E2B Code Execution** — secure sandboxed Python execution
- 🗄️ **Supabase/PostgreSQL** — persistent conversations, messages, executions
- ⚡ **Upstash Redis** — pub/sub realtime events
- 🌐 **WebSocket + SSE** — realtime streaming
- 📡 **Streaming LLM** — SSE token-by-token streaming for all providers

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/health/keys` | API key pool status |
| POST | `/health/reload-keys` | Hot-reload API keys |
| POST | `/chat` | Chat (non-streaming) |
| POST | `/chat/stream` | Chat (streaming SSE) |
| GET | `/chat/stream/{conv_id}` | Subscribe to conversation events |
| WS | `/ws/{room}` | WebSocket room |
| POST | `/execute` | Run code in E2B sandbox |
| POST | `/agent/task` | Autonomous agent task |
| GET | `/conversations` | List conversations |
| POST | `/conversations` | Create conversation |
| GET | `/conversations/{id}/messages` | Get messages |
| DELETE | `/conversations/{id}` | Delete conversation |
| GET | `/models` | Available models |

## Required Environment Variables (HF Space Secrets)

```
GEMINI_KEY=key1,key2,...
SAMBANOVA_KEY=key1,key2,...
GITHUB_KEY=key1,key2,...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
E2B_API_KEY=...
```
