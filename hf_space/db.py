"""
db.py — Database + Redis Layer
Bulletproof: graceful fallback when DB/Redis unavailable
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urlparse, urlunparse

logger = logging.getLogger("db")

# ─── In-memory fallback ────────────────────────────────────────────────────────
_mem_conversations: Dict[str, Dict] = {}
_mem_messages: Dict[str, List[Dict]] = {}
_mem_memory: Dict[str, List[Dict]] = {}
_mem_executions: Dict[str, List[Dict]] = {}

# ─── Connection state ──────────────────────────────────────────────────────────
_pool = None      # asyncpg pool
_redis = None     # redis client
_db_ok = False
_redis_ok = False

# ─── URL fixes ────────────────────────────────────────────────────────────────
def _fix_db_url(url: str) -> str:
    """Re-encode the password portion so @ chars don't break the URL."""
    if not url:
        return url
    try:
        parsed = urlparse(url)
        if parsed.password and "@" in parsed.password:
            # percent-encode only the password
            safe_pw = quote_plus(parsed.password)
            netloc = f"{parsed.username}:{safe_pw}@{parsed.hostname}"
            if parsed.port:
                netloc += f":{parsed.port}"
            return urlunparse(parsed._replace(netloc=netloc))
    except Exception:
        pass
    return url

# ─── Init ─────────────────────────────────────────────────────────────────────
async def init_db():
    global _pool, _db_ok
    raw_url = os.environ.get("DATABASE_URL", "")
    if not raw_url:
        logger.warning("DATABASE_URL not set — using in-memory fallback")
        return
    url = _fix_db_url(raw_url)
    try:
        import asyncpg
        _pool = await asyncpg.create_pool(
            url,
            min_size=1,
            max_size=5,
            command_timeout=10,
            server_settings={"application_name": "onehands"},
        )
        await _ensure_tables()
        _db_ok = True
        logger.info("✅ PostgreSQL connected")
    except Exception as e:
        logger.warning(f"PostgreSQL unavailable ({e}) — using in-memory fallback")
        _pool = None
        _db_ok = False

async def init_redis():
    global _redis, _redis_ok
    raw_url = os.environ.get("REDIS_URL", "")
    if not raw_url:
        logger.warning("REDIS_URL not set — Redis disabled")
        return
    try:
        import redis.asyncio as aioredis
        _redis = await aioredis.from_url(
            raw_url,
            socket_connect_timeout=5,
            socket_timeout=5,
            decode_responses=True,
            ssl_cert_reqs=None,
        )
        await _redis.ping()
        _redis_ok = True
        logger.info("✅ Redis connected")
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}) — pub/sub disabled")
        _redis = None
        _redis_ok = False

async def close():
    global _pool, _redis
    if _pool:
        await _pool.close()
    if _redis:
        await _redis.aclose()

def is_db_ok() -> bool:
    return _db_ok

def is_redis_ok() -> bool:
    return _redis_ok

# ─── Table creation ───────────────────────────────────────────────────────────
async def _ensure_tables():
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'anonymous',
            title TEXT,
            model TEXT DEFAULT 'gemini-2.0-flash',
            provider TEXT DEFAULT 'gemini',
            task_type TEXT DEFAULT 'general',
            status TEXT DEFAULT 'active',
            created_at DOUBLE PRECISION DEFAULT extract(epoch from now()),
            updated_at DOUBLE PRECISION DEFAULT extract(epoch from now()),
            metadata JSONB DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            provider TEXT,
            model TEXT,
            token_count INTEGER DEFAULT 0,
            created_at DOUBLE PRECISION DEFAULT extract(epoch from now()),
            metadata JSONB DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS executions (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            code TEXT NOT NULL,
            language TEXT DEFAULT 'python',
            stdout TEXT,
            stderr TEXT,
            exit_code INTEGER,
            duration_ms INTEGER,
            sandbox TEXT DEFAULT 'local',
            created_at DOUBLE PRECISION DEFAULT extract(epoch from now())
        );
        CREATE TABLE IF NOT EXISTS agent_memory (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            conversation_id TEXT,
            content TEXT NOT NULL,
            memory_type TEXT DEFAULT 'fact',
            key TEXT,
            importance REAL DEFAULT 0.5,
            created_at DOUBLE PRECISION DEFAULT extract(epoch from now())
        );
        """)

# ─── Conversations ─────────────────────────────────────────────────────────────
async def create_conversation(
    user_id: str = "anonymous",
    title: Optional[str] = None,
    model: str = "gemini-2.0-flash",
    provider: str = "gemini",
    task_type: str = "general",
) -> Dict:
    conv = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title or "New Conversation",
        "model": model,
        "provider": provider,
        "task_type": task_type,
        "status": "active",
        "created_at": time.time(),
        "updated_at": time.time(),
        "metadata": {},
    }
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO conversations (id,user_id,title,model,provider,task_type,status,created_at,updated_at,metadata)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)""",
                    conv["id"], conv["user_id"], conv["title"], conv["model"],
                    conv["provider"], conv["task_type"], conv["status"],
                    conv["created_at"], conv["updated_at"], json.dumps(conv["metadata"]),
                )
        except Exception as e:
            logger.warning(f"DB create_conversation error: {e}")
    _mem_conversations[conv["id"]] = conv
    _mem_messages[conv["id"]] = []
    return conv

async def list_conversations(user_id: str = "anonymous") -> List[Dict]:
    if _pool:
        try:
            async with _pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT * FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50",
                    user_id
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.warning(f"DB list_conversations error: {e}")
    return [c for c in _mem_conversations.values() if c["user_id"] == user_id]

async def get_conversation(conv_id: str) -> Optional[Dict]:
    if _pool:
        try:
            async with _pool.acquire() as conn:
                row = await conn.fetchrow("SELECT * FROM conversations WHERE id=$1", conv_id)
                return dict(row) if row else None
        except Exception as e:
            logger.warning(f"DB get_conversation error: {e}")
    return _mem_conversations.get(conv_id)

async def delete_conversation(conv_id: str):
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute("DELETE FROM conversations WHERE id=$1", conv_id)
        except Exception as e:
            logger.warning(f"DB delete_conversation error: {e}")
    _mem_conversations.pop(conv_id, None)
    _mem_messages.pop(conv_id, None)

# ─── Messages ─────────────────────────────────────────────────────────────────
async def save_message(
    conv_id: str,
    role: str,
    content: str,
    provider: str = "",
    model: str = "",
    token_count: int = 0,
) -> Dict:
    msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": conv_id,
        "role": role,
        "content": content,
        "provider": provider,
        "model": model,
        "token_count": token_count,
        "created_at": time.time(),
    }
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO messages (id,conversation_id,role,content,provider,model,token_count,created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                    msg["id"], msg["conversation_id"], msg["role"], msg["content"],
                    msg["provider"], msg["model"], msg["token_count"], msg["created_at"],
                )
                await conn.execute(
                    "UPDATE conversations SET updated_at=$1 WHERE id=$2",
                    time.time(), conv_id
                )
        except Exception as e:
            logger.warning(f"DB save_message error: {e}")
    if conv_id not in _mem_messages:
        _mem_messages[conv_id] = []
    _mem_messages[conv_id].append(msg)
    return msg

async def get_messages(conv_id: str, limit: int = 50) -> List[Dict]:
    if _pool:
        try:
            async with _pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2",
                    conv_id, limit
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.warning(f"DB get_messages error: {e}")
    return _mem_messages.get(conv_id, [])[-limit:]

# ─── Executions ───────────────────────────────────────────────────────────────
async def save_execution(
    conv_id: Optional[str],
    code: str,
    language: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    duration_ms: int,
    sandbox: str = "local",
) -> Dict:
    exc = {
        "id": str(uuid.uuid4()),
        "conversation_id": conv_id,
        "code": code,
        "language": language,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "sandbox": sandbox,
        "created_at": time.time(),
    }
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO executions (id,conversation_id,code,language,stdout,stderr,exit_code,duration_ms,sandbox,created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    exc["id"], exc["conversation_id"], exc["code"], exc["language"],
                    exc["stdout"], exc["stderr"], exc["exit_code"], exc["duration_ms"],
                    exc["sandbox"], exc["created_at"],
                )
        except Exception as e:
            logger.warning(f"DB save_execution error: {e}")
    if conv_id:
        _mem_executions.setdefault(conv_id, []).append(exc)
    return exc

# ─── Memory ───────────────────────────────────────────────────────────────────
async def save_memory(
    user_id: str,
    content: str,
    memory_type: str = "fact",
    key: Optional[str] = None,
    importance: float = 0.5,
    conv_id: Optional[str] = None,
) -> Dict:
    mem = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "conversation_id": conv_id,
        "content": content,
        "memory_type": memory_type,
        "key": key,
        "importance": importance,
        "created_at": time.time(),
    }
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO agent_memory (id,user_id,conversation_id,content,memory_type,key,importance,created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                    mem["id"], mem["user_id"], mem["conversation_id"], mem["content"],
                    mem["memory_type"], mem["key"], mem["importance"], mem["created_at"],
                )
        except Exception as e:
            logger.warning(f"DB save_memory error: {e}")
    _mem_memory.setdefault(user_id, []).append(mem)
    return mem

async def get_memories(user_id: str, limit: int = 10) -> List[Dict]:
    if _pool:
        try:
            async with _pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT * FROM agent_memory WHERE user_id=$1 ORDER BY importance DESC, created_at DESC LIMIT $2",
                    user_id, limit
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.warning(f"DB get_memories error: {e}")
    mems = _mem_memory.get(user_id, [])
    return sorted(mems, key=lambda x: x.get("importance", 0), reverse=True)[:limit]

# ─── Redis pub/sub ─────────────────────────────────────────────────────────────
async def publish_event(channel: str, event: Dict):
    if _redis and _redis_ok:
        try:
            await _redis.publish(channel, json.dumps(event))
        except Exception as e:
            logger.debug(f"Redis publish error: {e}")

async def subscribe_events(channel: str):
    """Async generator for Redis subscription."""
    if not (_redis and _redis_ok):
        return
    pubsub = _redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                try:
                    yield json.loads(msg["data"])
                except Exception:
                    pass
    finally:
        await pubsub.unsubscribe(channel)
