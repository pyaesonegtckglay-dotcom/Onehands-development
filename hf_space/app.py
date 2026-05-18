"""
Onehands AI Backend — Hugging Face Space
==========================================
Full-featured FastAPI backend for the Onehands autonomous AI platform.

Stack:
  • FastAPI + uvicorn
  • Supabase (PostgreSQL via asyncpg) — conversations, messages, executions
  • Upstash Redis — pub/sub, SSE bridge, caching
  • Smart API Router — Gemini / SambaNova / GitHub LLM with auto-heal cooldowns
  • E2B — secure sandboxed code execution
  • WebSocket + SSE — realtime event streaming
  • Agent Loop — autonomous task planning & multi-step execution
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import httpx
from fastapi import (
    Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import persistence as db
from smart_router import Provider, _to_gemini_format, router as smart_router

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("onehands")

# ─── Config ───────────────────────────────────────────────────────────────────
E2B_API_KEY = os.environ.get("E2B_API_KEY", "")

ALLOWED_ORIGINS: list[str] = [
    "https://onehands-development.vercel.app",
    "https://onehands.vercel.app",
    "https://pyaesonegtckglay-dotcom-onehands-development.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "*",
]

# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await db.init_redis()
    logger.info("🚀 Onehands backend ready")
    yield
    await db.close()
    logger.info("🛑 Onehands backend shutdown")

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Onehands AI Backend",
    description=(
        "Autonomous AI platform backend: multi-provider LLM routing, "
        "code execution, persistent conversations, realtime streaming."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── WebSocket manager ────────────────────────────────────────────────────────

class WSManager:
    def __init__(self):
        self._rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self._rooms.setdefault(room, []).append(ws)
        logger.info("WS+ room=%s total=%d", room, len(self._rooms[room]))

    def disconnect(self, ws: WebSocket, room: str):
        self._rooms[room] = [c for c in self._rooms.get(room, []) if c is not ws]

    async def broadcast(self, room: str, data: dict):
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(room, [])):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, room)

ws_mgr = WSManager()

# ─── Schemas ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message:         str
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    temperature:     float = 0.7
    max_tokens:      int   = 4096
    system_prompt:   Optional[str] = None
    stream:          bool  = False
    auto_fallback:   bool  = True

class StreamChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message:         str
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    temperature:     float = 0.7
    max_tokens:      int   = 4096
    system_prompt:   Optional[str] = None

class ExecuteRequest(BaseModel):
    conversation_id: Optional[str] = None
    code:            str
    language:        str = "python"
    timeout:         int = 30

class ConversationCreate(BaseModel):
    user_id:  str            = "anonymous"
    title:    Optional[str]  = None
    model:    str            = "gemini-2.0-flash"
    provider: str            = "gemini"

class AgentTaskRequest(BaseModel):
    task:            str
    conversation_id: Optional[str] = None
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    max_steps:       int   = Field(default=8, ge=1, le=20)
    execute_code:    bool  = True
    user_id:         str   = "anonymous"

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_oai_messages(system: Optional[str], history: list, user_msg: str) -> list:
    msgs: list[dict] = []
    if system:
        msgs.append({"role": "system", "content": system})
    for row in history:
        msgs.append({"role": row["role"], "content": row["content"]})
    msgs.append({"role": "user", "content": user_msg})
    return msgs

async def _emit(conv_id: str, event: dict):
    """Publish to Redis + broadcast via WS."""
    await db.publish_event(conv_id, event)
    await ws_mgr.broadcast(conv_id, event)

async def _llm_call(
    provider: str,
    model: str,
    messages: list,
    temperature: float,
    max_tokens: int,
    auto_fallback: bool = True,
) -> tuple[str, str, str]:
    """Returns (content, used_provider, used_model)."""
    if auto_fallback:
        result = await smart_router.auto_chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            preferred_provider=provider,
            preferred_model=model,
        )
        return result["content"], result["provider"], result["model"]

    # strict provider
    if provider == "gemini":
        r = await smart_router.call_gemini(
            model, _to_gemini_format(messages), temperature, max_tokens
        )
        content = r["candidates"][0]["content"]["parts"][0]["text"]
    elif provider == "sambanova":
        r = await smart_router.call_sambanova(model, messages, temperature, max_tokens)
        content = r["choices"][0]["message"]["content"]
    elif provider == "github_llm":
        r = await smart_router.call_github_llm(model, messages, temperature, max_tokens)
        content = r["choices"][0]["message"]["content"]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    return content, provider, model

# ─── Routes: root / health ────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service":  "Onehands AI Backend",
        "version":  "2.0.0",
        "status":   "running",
        "docs":     "/docs",
        "endpoints": [
            "/chat", "/chat/stream", "/execute",
            "/agent/task", "/conversations",
            "/health", "/health/keys",
            "/ws/{room}", "/models",
        ],
    }

@app.get("/health")
async def health():
    redis_ok = await db.redis_ping()
    return {
        "status":       "ok" if (db.db_connected() and redis_ok) else "degraded",
        "database":     "connected" if db.db_connected() else "disconnected",
        "redis":        "connected" if redis_ok else "disconnected",
        "smart_router": smart_router.health(),
        "timestamp":    time.time(),
    }

@app.get("/health/keys")
async def health_keys():
    return smart_router.health()

@app.post("/health/reload-keys")
async def reload_keys():
    smart_router._reload_keys()
    return {"status": "reloaded", "health": smart_router.health()}

# ─── Conversations ────────────────────────────────────────────────────────────

@app.post("/conversations", status_code=201)
async def create_conversation(data: ConversationCreate):
    row = await db.create_conversation(
        user_id=data.user_id,
        title=data.title or "New conversation",
        model=data.model,
        provider=data.provider,
    )
    if not row:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return row

@app.get("/conversations")
async def list_conversations(user_id: str = "anonymous"):
    return await db.list_conversations(user_id)

@app.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str):
    return await db.get_conversation_messages(conv_id)

@app.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    ok = await db.delete_conversation(conv_id)
    return {"deleted": ok}

# ─── Chat ─────────────────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(req: ChatRequest):
    # Ensure conversation
    conv_id = req.conversation_id
    if not conv_id:
        row = await db.create_conversation(
            title=req.message[:60],
            model=req.model,
            provider=req.provider,
        )
        conv_id = str(row["id"]) if row else str(uuid.uuid4())

    # History
    history = await db.get_conversation_messages(conv_id)
    messages = _build_oai_messages(req.system_prompt, history, req.message)

    # Save user msg
    await db.save_message(conv_id, "user", req.message)

    try:
        content, used_provider, used_model = await _llm_call(
            provider=req.provider,
            model=req.model,
            messages=messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            auto_fallback=req.auto_fallback,
        )
    except Exception as e:
        logger.error("chat error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    # Save & emit
    await db.save_message(conv_id, "assistant", content, used_provider, used_model)
    await _emit(conv_id, {"type": "message", "role": "assistant", "content": content})

    return {
        "conv_id":  conv_id,
        "role":     "assistant",
        "content":  content,
        "model":    used_model,
        "provider": used_provider,
    }

# ─── Streaming chat ───────────────────────────────────────────────────────────

@app.post("/chat/stream")
async def chat_stream(req: StreamChatRequest):
    """SSE streaming chat endpoint."""
    conv_id = req.conversation_id
    if not conv_id:
        row = await db.create_conversation(
            title=req.message[:60], model=req.model, provider=req.provider
        )
        conv_id = str(row["id"]) if row else str(uuid.uuid4())

    history  = await db.get_conversation_messages(conv_id)
    messages = _build_oai_messages(req.system_prompt, history, req.message)
    await db.save_message(conv_id, "user", req.message)

    async def event_gen() -> AsyncGenerator[str, None]:
        full_text = ""
        try:
            if req.provider == "gemini":
                gen = smart_router.stream_gemini(
                    req.model, _to_gemini_format(messages),
                    req.temperature, req.max_tokens,
                )
            elif req.provider == "sambanova":
                gen = smart_router.stream_sambanova(
                    req.model, messages, req.temperature, req.max_tokens
                )
            elif req.provider == "github_llm":
                gen = smart_router.stream_github_llm(
                    req.model, messages, req.temperature, req.max_tokens
                )
            else:
                yield f"data: {json.dumps({'error': f'Unknown provider: {req.provider}'})}\n\n"
                return

            async for chunk in gen:
                full_text += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'conv_id': conv_id})}\n\n"

        except Exception as e:
            logger.error("stream error: %s", e)
            # fallback to non-streaming
            try:
                content, used_provider, used_model = await _llm_call(
                    provider=req.provider, model=req.model,
                    messages=messages, temperature=req.temperature,
                    max_tokens=req.max_tokens, auto_fallback=True,
                )
                full_text = content
                yield f"data: {json.dumps({'type': 'chunk', 'content': content, 'conv_id': conv_id})}\n\n"
            except Exception as e2:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e2)})}\n\n"
                return

        await db.save_message(conv_id, "assistant", full_text, req.provider, req.model)
        await _emit(conv_id, {"type": "done", "conv_id": conv_id, "content": full_text})
        yield f"data: {json.dumps({'type': 'done', 'conv_id': conv_id})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── SSE subscribe ────────────────────────────────────────────────────────────

@app.get("/chat/stream/{conv_id}")
async def sse_subscribe(conv_id: str, request: Request):
    """Subscribe to events for a conversation room via SSE."""
    async def gen() -> AsyncGenerator[str, None]:
        redis = db.get_redis()
        if not redis:
            yield 'data: {"error":"Redis not available"}\n\n'
            return
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"room:{conv_id}")
        try:
            while True:
                if await request.is_disconnected():
                    break
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg["type"] == "message":
                    yield f"data: {msg['data']}\n\n"
                else:
                    yield ": keepalive\n\n"
                await asyncio.sleep(0.05)
        finally:
            await pubsub.unsubscribe(f"room:{conv_id}")
            await pubsub.aclose()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws/{room}")
async def websocket_ep(ws: WebSocket, room: str):
    await ws_mgr.connect(ws, room)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"raw": data}
            await ws_mgr.broadcast(room, msg)
    except WebSocketDisconnect:
        ws_mgr.disconnect(ws, room)
    except Exception as e:
        logger.error("WS error room=%s: %s", room, e)
        ws_mgr.disconnect(ws, room)

# ─── Code Execution (E2B) ─────────────────────────────────────────────────────

async def _e2b_run(code: str, language: str, timeout: int) -> dict:
    if not E2B_API_KEY:
        return {"output": "", "error": "E2B_API_KEY not configured", "exit_code": 1, "duration_ms": 0}
    try:
        import e2b_code_interpreter as e2b
        start = time.time()
        sandbox = await asyncio.to_thread(e2b.Sandbox, api_key=E2B_API_KEY, timeout=timeout)
        execution = await asyncio.to_thread(sandbox.run_code, code)
        duration = int((time.time() - start) * 1000)
        await asyncio.to_thread(sandbox.kill)
        stdout = "\n".join(execution.logs.stdout or [])
        stderr = "\n".join(execution.logs.stderr or [])
        return {
            "output":      stdout,
            "error":       stderr,
            "exit_code":   1 if stderr else 0,
            "duration_ms": duration,
        }
    except Exception as e:
        return {"output": "", "error": str(e), "exit_code": 1, "duration_ms": 0}

@app.post("/execute")
async def execute_code(req: ExecuteRequest):
    result = await _e2b_run(req.code, req.language, req.timeout)
    if req.conversation_id:
        await db.save_execution(
            req.conversation_id, req.language, req.code,
            result["output"], result["error"],
            result["exit_code"], result["duration_ms"],
        )
        await _emit(req.conversation_id, {"type": "execution", **result})
    return result

# ─── Agent Loop ───────────────────────────────────────────────────────────────

AGENT_SYSTEM = """You are Onehands — an autonomous AI developer agent.

Given a task, you:
1. PLAN: Break it into numbered steps
2. EXECUTE: For each step, either write reasoning OR generate code
3. CODE: When writing code, wrap it in ```python ... ``` blocks
4. OBSERVE: After code runs, use the output to guide next step
5. FINISH: When done, summarize results

Rules:
- Be concise, action-oriented
- One code block per step maximum
- If a step requires browsing or file I/O, describe what you'd do
- Always end with a FINAL ANSWER section
"""

def _extract_code(text: str) -> Optional[str]:
    """Extract first python code block from markdown text."""
    import re
    pattern = r"```(?:python)?\n(.*?)```"
    m = re.search(pattern, text, re.DOTALL)
    return m.group(1).strip() if m else None

@app.post("/agent/task")
async def agent_task(req: AgentTaskRequest):
    """
    Autonomous agent loop:
    1. Create/use conversation
    2. LLM plans & executes step-by-step
    3. Code blocks run in E2B sandbox
    4. Results fed back to LLM
    5. Returns full trace
    """
    conv_id = req.conversation_id
    if not conv_id:
        row = await db.create_conversation(
            user_id=req.user_id,
            title=f"Agent: {req.task[:50]}",
            model=req.model,
            provider=req.provider,
        )
        conv_id = str(row["id"]) if row else str(uuid.uuid4())

    await db.save_message(conv_id, "user", req.task)
    await _emit(conv_id, {"type": "agent_start", "task": req.task, "conv_id": conv_id})

    messages: list[dict] = [
        {"role": "system", "content": AGENT_SYSTEM},
        {"role": "user",   "content": f"TASK: {req.task}"},
    ]

    trace: list[dict] = []
    step = 0

    while step < req.max_steps:
        step += 1
        logger.info("Agent step %d/%d  conv=%s", step, req.max_steps, conv_id)

        # LLM call
        try:
            content, used_provider, used_model = await _llm_call(
                provider=req.provider,
                model=req.model,
                messages=messages,
                temperature=0.3,
                max_tokens=2048,
                auto_fallback=True,
            )
        except Exception as e:
            error_msg = f"LLM failed at step {step}: {e}"
            trace.append({"step": step, "type": "error", "content": error_msg})
            break

        messages.append({"role": "assistant", "content": content})
        await db.save_message(conv_id, "assistant", content, used_provider, used_model)
        await _emit(conv_id, {
            "type":     "agent_step",
            "step":     step,
            "content":  content,
            "provider": used_provider,
            "model":    used_model,
        })
        trace.append({"step": step, "type": "thought", "content": content})

        # Execute code if present
        if req.execute_code:
            code = _extract_code(content)
            if code:
                exec_result = await _e2b_run(code, "python", 30)
                await db.save_execution(
                    conv_id, "python", code,
                    exec_result["output"], exec_result["error"],
                    exec_result["exit_code"], exec_result["duration_ms"],
                )
                await _emit(conv_id, {
                    "type": "agent_execution",
                    "step": step,
                    **exec_result,
                })
                trace.append({"step": step, "type": "execution", **exec_result})

                # Feed result back
                obs = f"[Code execution result]\noutput: {exec_result['output']}\nerror: {exec_result['error']}\nexit_code: {exec_result['exit_code']}"
                messages.append({"role": "user", "content": obs})

        # Check if done
        if any(kw in content.lower() for kw in ("final answer", "task complete", "done.", "finished.")):
            break

    await _emit(conv_id, {"type": "agent_done", "steps": step, "conv_id": conv_id})

    return {
        "conv_id": conv_id,
        "task":    req.task,
        "steps":   step,
        "trace":   trace,
    }

# ─── Models ───────────────────────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    return {
        "gemini": [
            {"id": "gemini-2.0-flash",              "name": "Gemini 2.0 Flash",          "context": 1048576},
            {"id": "gemini-2.0-flash-thinking-exp", "name": "Gemini 2.0 Flash Thinking", "context": 32768},
            {"id": "gemini-1.5-pro",                "name": "Gemini 1.5 Pro",            "context": 2097152},
            {"id": "gemini-1.5-flash",              "name": "Gemini 1.5 Flash",          "context": 1048576},
        ],
        "sambanova": [
            {"id": "Meta-Llama-3.3-70B-Instruct",  "name": "Llama 3.3 70B",    "context": 131072},
            {"id": "Meta-Llama-3.1-405B-Instruct", "name": "Llama 3.1 405B",   "context": 16384},
            {"id": "DeepSeek-R1",                  "name": "DeepSeek R1",       "context": 32768},
            {"id": "Qwen2.5-72B-Instruct",         "name": "Qwen 2.5 72B",     "context": 32768},
        ],
        "github_llm": [
            {"id": "gpt-4o",                          "name": "GPT-4o",                   "context": 128000},
            {"id": "gpt-4o-mini",                     "name": "GPT-4o Mini",              "context": 128000},
            {"id": "Meta-Llama-3.1-70B-Instruct",     "name": "Llama 3.1 70B (GitHub)",   "context": 131072},
            {"id": "Mistral-large-2407",              "name": "Mistral Large",             "context": 131072},
        ],
    }

# ─── Entry ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 7860)),
        log_level="info",
        workers=1,
    )
