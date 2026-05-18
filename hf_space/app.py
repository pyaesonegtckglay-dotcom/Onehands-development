"""
Onehands AI Backend — Hugging Face Space
=========================================
FastAPI backend for OpenHands/Onehands AI platform.

Stack:
  - FastAPI + uvicorn
  - Supabase (PostgreSQL) for persistence
  - Redis (Upstash) for pub/sub + SSE
  - Smart API routing (Gemini / SambaNova / GitHub LLM)
  - E2B sandboxed code execution
  - WebSocket + SSE for realtime events
"""

import os
import json
import uuid
import time
import asyncio
import logging
import httpx
import asyncpg
import redis.asyncio as aioredis

from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from smart_router import router as smart_router, Provider

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("onehands")

# ─── Environment (all secrets via HF Space Secrets / env vars) ────────────────
DATABASE_URL  = os.environ.get("DATABASE_URL", "")
REDIS_URL     = os.environ.get("REDIS_URL", "")
E2B_API_KEY   = os.environ.get("E2B_API_KEY", "")

FRONTEND_ORIGINS = [
    "https://onehands-development.vercel.app",
    "https://onehands.vercel.app",
    "https://pyaesonegtckglay-dotcom-onehands-development.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
    "*",
]

# ─── DB Pool ──────────────────────────────────────────────────────────────────
db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[aioredis.Redis] = None

async def get_db() -> asyncpg.Pool:
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    return db_pool

async def get_redis() -> aioredis.Redis:
    if not redis_client:
        raise HTTPException(status_code=503, detail="Redis not available")
    return redis_client

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client
    # Connect DB
    if DATABASE_URL:
        try:
            db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            logger.info("✅ Supabase/PostgreSQL connected")
            await init_db(db_pool)
        except Exception as e:
            logger.error(f"❌ DB connection failed: {e}")
    else:
        logger.warning("⚠️ DATABASE_URL not set — DB features disabled")

    # Connect Redis
    if REDIS_URL:
        try:
            redis_client = aioredis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                ssl_cert_reqs=None,
            )
            await redis_client.ping()
            logger.info("✅ Redis (Upstash) connected")
        except Exception as e:
            logger.error(f"❌ Redis connection failed: {e}")
    else:
        logger.warning("⚠️ REDIS_URL not set — realtime features disabled")

    yield

    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

async def init_db(pool: asyncpg.Pool):
    """Create tables if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id TEXT NOT NULL DEFAULT 'anonymous',
                title TEXT,
                model TEXT DEFAULT 'gemini-2.0-flash',
                provider TEXT DEFAULT 'gemini',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
                content TEXT NOT NULL,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS executions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id),
                language TEXT DEFAULT 'python',
                code TEXT NOT NULL,
                output TEXT,
                error TEXT,
                exit_code INT,
                duration_ms INT,
                sandbox_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS api_key_stats (
                id SERIAL PRIMARY KEY,
                provider TEXT NOT NULL,
                key_suffix TEXT NOT NULL,
                success_count INT DEFAULT 0,
                error_count INT DEFAULT 0,
                last_used TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(provider, key_suffix)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_executions_conv ON executions(conversation_id);
        """)
        logger.info("✅ DB schema initialized")

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Onehands AI Backend",
    description="OpenHands AI platform backend with smart multi-provider routing",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── WebSocket Manager ────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self.active.setdefault(room, []).append(ws)
        logger.info(f"WS connected room={room} total={len(self.active[room])}")

    def disconnect(self, ws: WebSocket, room: str):
        if room in self.active:
            self.active[room] = [c for c in self.active[room] if c != ws]

    async def broadcast(self, room: str, data: dict):
        conns = self.active.get(room, [])
        dead = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, room)

ws_manager = ConnectionManager()

# ─── Schemas ──────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: Optional[str] = None
    stream: bool = False

class ExecuteRequest(BaseModel):
    conversation_id: Optional[str] = None
    code: str
    language: str = "python"
    timeout: int = 30

class ConversationCreate(BaseModel):
    user_id: str = "anonymous"
    title: Optional[str] = None
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "Onehands AI Backend",
        "status": "running",
        "version": "1.0.0",
        "endpoints": ["/chat", "/execute", "/conversations", "/health", "/ws/{room}"],
    }

@app.get("/health")
async def health():
    db_ok = db_pool is not None
    redis_ok = False
    try:
        if redis_client:
            await redis_client.ping()
            redis_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if (db_ok and redis_ok) else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "redis": "connected" if redis_ok else "disconnected",
        "smart_router": smart_router.health(),
        "timestamp": time.time(),
    }

@app.get("/health/keys")
async def health_keys():
    return smart_router.health()

# ─── Conversations ────────────────────────────────────────────────────────────

@app.post("/conversations")
async def create_conversation(data: ConversationCreate, pool=Depends(get_db)):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO conversations(user_id, title, model, provider)
               VALUES($1,$2,$3,$4) RETURNING *""",
            data.user_id, data.title or "New conversation", data.model, data.provider
        )
    return dict(row)

@app.get("/conversations")
async def list_conversations(user_id: str = "anonymous", pool=Depends(get_db)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50",
            user_id
        )
    return [dict(r) for r in rows]

@app.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str, pool=Depends(get_db)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC",
            conv_id
        )
    return [dict(r) for r in rows]

@app.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, pool=Depends(get_db)):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM conversations WHERE id=$1", conv_id)
    return {"deleted": True}

# ─── Chat ─────────────────────────────────────────────────────────────────────

def _build_messages(system_prompt: Optional[str], history: list, user_msg: str) -> list:
    msgs = []
    if system_prompt:
        msgs.append({"role": "system", "content": system_prompt})
    for row in history:
        msgs.append({"role": row["role"], "content": row["content"]})
    msgs.append({"role": "user", "content": user_msg})
    return msgs

async def _save_message(pool, conv_id: str, role: str, content: str):
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO messages(conversation_id, role, content) VALUES($1,$2,$3)",
                conv_id, role, content
            )
            await conn.execute(
                "UPDATE conversations SET updated_at=NOW() WHERE id=$1", conv_id
            )
    except Exception as e:
        logger.error(f"Failed to save message: {e}")

async def _publish_event(room: str, event: dict):
    """Publish to Redis pub/sub for SSE/WS broadcast."""
    try:
        if redis_client:
            await redis_client.publish(f"room:{room}", json.dumps(event))
    except Exception as e:
        logger.warning(f"Redis publish failed: {e}")

@app.post("/chat")
async def chat(req: ChatRequest, pool=Depends(get_db)):
    # Get/create conversation
    conv_id = req.conversation_id
    if not conv_id:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO conversations(user_id, title, model, provider) VALUES($1,$2,$3,$4) RETURNING id",
                "anonymous", req.message[:50], req.model, req.provider
            )
            conv_id = str(row["id"])

    # Fetch history
    async with pool.acquire() as conn:
        history = await conn.fetch(
            "SELECT role, content FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 20",
            conv_id
        )

    messages = _build_messages(req.system_prompt, history, req.message)

    # Save user message
    await _save_message(pool, conv_id, "user", req.message)

    try:
        if req.provider == "gemini":
            # Convert to Gemini format
            gemini_msgs = []
            for m in messages:
                role = "user" if m["role"] in ("user", "system") else "model"
                gemini_msgs.append({"role": role, "parts": [{"text": m["content"]}]})
            result = await smart_router.call_gemini(
                model=req.model,
                messages=gemini_msgs,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )
            reply = result["candidates"][0]["content"]["parts"][0]["text"]

        elif req.provider == "sambanova":
            result = await smart_router.call_sambanova(
                model=req.model,
                messages=messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )
            reply = result["choices"][0]["message"]["content"]

        elif req.provider == "github_llm":
            result = await smart_router.call_github_llm(
                model=req.model,
                messages=messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )
            reply = result["choices"][0]["message"]["content"]

        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    # Save assistant reply
    await _save_message(pool, conv_id, "assistant", reply)

    # Publish to realtime
    await _publish_event(conv_id, {
        "type": "message",
        "role": "assistant",
        "content": reply,
        "conv_id": conv_id,
    })
    await ws_manager.broadcast(conv_id, {
        "type": "message",
        "role": "assistant",
        "content": reply,
    })

    return {
        "conv_id": conv_id,
        "role": "assistant",
        "content": reply,
        "model": req.model,
        "provider": req.provider,
    }

# ─── SSE Stream ───────────────────────────────────────────────────────────────

@app.get("/chat/stream/{conv_id}")
async def sse_stream(conv_id: str, request: Request):
    """SSE endpoint — subscribe to Redis channel for a conversation."""
    async def event_generator() -> AsyncGenerator[str, None]:
        if not redis_client:
            yield "data: {\"error\":\"Redis not available\"}\n\n"
            return

        pubsub = redis_client.pubsub()
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
                await asyncio.sleep(0.1)
        finally:
            await pubsub.unsubscribe(f"room:{conv_id}")
            await pubsub.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws/{room}")
async def websocket_endpoint(ws: WebSocket, room: str):
    await ws_manager.connect(ws, room)
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            msg["echo"] = True
            await ws_manager.broadcast(room, msg)
    except WebSocketDisconnect:
        ws_manager.disconnect(ws, room)
    except Exception as e:
        logger.error(f"WS error: {e}")
        ws_manager.disconnect(ws, room)

# ─── Code Execution (E2B) ─────────────────────────────────────────────────────

async def run_e2b_sandbox(code: str, language: str, timeout: int) -> dict:
    """Execute code in E2B sandbox."""
    if not E2B_API_KEY:
        return {"output": "", "error": "E2B_API_KEY not configured", "exit_code": 1, "duration_ms": 0}
    try:
        import e2b_code_interpreter as e2b
        sandbox = await asyncio.to_thread(
            e2b.Sandbox,
            api_key=E2B_API_KEY,
            timeout=timeout,
        )
        start = time.time()
        execution = await asyncio.to_thread(sandbox.run_code, code)
        duration = int((time.time() - start) * 1000)
        await asyncio.to_thread(sandbox.kill)

        stdout = "\n".join(execution.logs.stdout) if execution.logs.stdout else ""
        stderr = "\n".join(execution.logs.stderr) if execution.logs.stderr else ""

        return {
            "output": stdout,
            "error": stderr,
            "exit_code": 0 if not stderr else 1,
            "duration_ms": duration,
        }
    except Exception as e:
        return {
            "output": "",
            "error": str(e),
            "exit_code": 1,
            "duration_ms": 0,
        }

@app.post("/execute")
async def execute_code(req: ExecuteRequest, pool=Depends(get_db)):
    result = await run_e2b_sandbox(req.code, req.language, req.timeout)
    if req.conversation_id and pool:
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO executions(conversation_id, language, code, output, error, exit_code, duration_ms)
                       VALUES($1,$2,$3,$4,$5,$6,$7)""",
                    req.conversation_id, req.language, req.code,
                    result["output"], result["error"], result["exit_code"], result["duration_ms"]
                )
        except Exception as e:
            logger.warning(f"Failed to save execution: {e}")

    if req.conversation_id:
        await _publish_event(req.conversation_id, {"type": "execution", **result})
        await ws_manager.broadcast(req.conversation_id, {"type": "execution", **result})

    return result

# ─── Models List ──────────────────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    return {
        "gemini": [
            {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "context": 1048576},
            {"id": "gemini-2.0-flash-thinking-exp", "name": "Gemini 2.0 Flash Thinking", "context": 32768},
            {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "context": 2097152},
            {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "context": 1048576},
        ],
        "sambanova": [
            {"id": "Meta-Llama-3.3-70B-Instruct", "name": "Llama 3.3 70B", "context": 131072},
            {"id": "Meta-Llama-3.1-405B-Instruct", "name": "Llama 3.1 405B", "context": 16384},
            {"id": "DeepSeek-R1", "name": "DeepSeek R1", "context": 32768},
            {"id": "Qwen2.5-72B-Instruct", "name": "Qwen 2.5 72B", "context": 32768},
        ],
        "github_llm": [
            {"id": "gpt-4o", "name": "GPT-4o", "context": 128000},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "context": 128000},
            {"id": "Meta-Llama-3.1-70B-Instruct", "name": "Llama 3.1 70B (GitHub)", "context": 131072},
            {"id": "Mistral-large-2407", "name": "Mistral Large", "context": 131072},
        ],
    }

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=7860,
        log_level="info",
        workers=1,
    )
