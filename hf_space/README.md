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

# Onehands AI Backend

FastAPI backend for the Onehands AI development platform.

## Features
- 🔑 Smart API routing (Gemini, SambaNova, GitHub LLM) with cooldown & auto-heal
- 🗄️ Supabase/PostgreSQL for conversation persistence
- ⚡ Redis (Upstash) for realtime pub/sub + SSE
- 🧪 E2B sandboxed code execution
- 🔌 WebSocket support
- 🌐 REST API

## Endpoints
- `GET /` — service info
- `GET /health` — health check
- `GET /health/keys` — API key health stats
- `POST /chat` — send a chat message
- `GET /chat/stream/{conv_id}` — SSE stream for conversation
- `WS /ws/{room}` — WebSocket room
- `POST /execute` — run code in E2B sandbox
- `GET /conversations` — list conversations
- `POST /conversations` — create conversation
- `GET /conversations/{id}/messages` — get messages
- `GET /models` — list available models
