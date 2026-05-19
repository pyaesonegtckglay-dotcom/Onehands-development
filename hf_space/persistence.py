"""
Persistence layer: Supabase (PostgreSQL) + Redis (Upstash).

Provides:
  - DB pool (asyncpg) for conversations, messages, executions, memory, tool_calls
  - Redis pub/sub for realtime SSE/WebSocket bridging
  - Auto-init schema on startup
  - Graceful degradation when DB/Redis unavailable
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, unquote, urlparse, urlunparse

logger = logging.getLogger(__name__)

# ─── Connection state ─────────────────────────────────────────────────────────

_db_pool = None          # asyncpg.Pool
_redis = None            # redis.asyncio.Redis


def _fix_db_url(url: str) -> str:
    """
    Fix DATABASE_URL that may have unencoded special chars in password (e.g. @ in psaespw@1994).
    Uses last-@ strategy: everything before the final @ is userinfo (user:pass),
    everything after is host:port/dbname.
    Supports both postgresql:// and postgres:// schemes.
    """
    if not url:
        return url

    # Normalise scheme
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]

    # Strip scheme prefix
    prefix = "postgresql://"
    if not url.startswith(prefix):
        return url
    rest = url[len(prefix):]  # user:pass@host:port/db

    # Split at the LAST @ — handles @ inside passwords
    last_at = rest.rfind("@")
    if last_at == -1:
        return url  # no userinfo — return as-is

    userinfo = rest[:last_at]   # "user:pass" (pass may already be encoded)
    hostinfo = rest[last_at+1:] # "host:port/db"

    colon = userinfo.find(":")
    if colon == -1:
        return url  # can't parse
    raw_user = userinfo[:colon]
    raw_pass = userinfo[colon+1:]

    # Unquote first to avoid double-encoding, then re-encode cleanly
    clean_pass = unquote(raw_pass)
    clean_user = unquote(raw_user)
    encoded_pass = quote_plus(clean_pass)
    encoded_user = quote_plus(clean_user)

    return f"postgresql://{encoded_user}:{encoded_pass}@{hostinfo}"


async def init_db() -> bool:
    """Connect to Supabase PostgreSQL. Returns True on success."""
    global _db_pool
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        logger.warning("DATABASE_URL not set — DB persistence disabled")
        return False
    db_url = _fix_db_url(db_url)
    logger.info("DB connecting to: ***@%s", db_url.split("@")[-1] if "@" in db_url else "???")
    try:
        import asyncpg
        _db_pool = await asyncio.wait_for(
            asyncpg.create_pool(
                db_url,
                min_size=1,
                max_size=8,
                command_timeout=30,
                ssl="require",
            ),
            timeout=20,
        )
        await _create_schema()
        logger.info("✅ Supabase/PostgreSQL connected")
        return True
    except asyncio.TimeoutError:
        logger.error("❌ DB connection TIMEOUT (20s)")
        _db_pool = None
        return False
    except Exception as e:
        logger.error("❌ DB connection failed: %s — %s", type(e).__name__, e)
        _db_pool = None
        return False


async def init_redis() -> bool:
    """Connect to Upstash Redis (TLS). Returns True on success."""
    global _redis
    redis_url = os.environ.get("REDIS_URL", "")
    if not redis_url:
        logger.warning("REDIS_URL not set — Redis realtime disabled")
        return False
    # Upstash requires TLS — upgrade redis:// → rediss:// automatically
    if redis_url.startswith("redis://"):
        redis_url = "rediss://" + redis_url[len("redis://"):]
    try:
        import redis.asyncio as aioredis
        # ssl_cert_reqs param removed — not supported in newer redis-py
        _redis = aioredis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        await asyncio.wait_for(_redis.ping(), timeout=10)
        logger.info("✅ Redis (Upstash TLS) connected")
        return True
    except asyncio.TimeoutError:
        logger.error("❌ Redis connection TIMEOUT")
        _redis = None
        return False
    except Exception as e:
        logger.error("❌ Redis connection failed: %s", e)
        _redis = None
        return False


async def close():
    global _db_pool, _redis
    if _db_pool:
        await _db_pool.close()
    if _redis:
        await _redis.aclose()


# ─── Schema init ──────────────────────────────────────────────────────────────

async def _create_schema():
    async with _db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id TEXT NOT NULL DEFAULT 'anonymous',
                title TEXT DEFAULT 'New conversation',
                model TEXT DEFAULT 'gemini-2.0-flash',
                provider TEXT DEFAULT 'gemini',
                task_type TEXT DEFAULT 'general',
                status TEXT DEFAULT 'active',
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
                content TEXT NOT NULL,
                provider TEXT,
                model TEXT,
                tool_calls JSONB DEFAULT NULL,
                tool_call_id TEXT DEFAULT NULL,
                metadata JSONB DEFAULT '{}',
                tokens_used INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS executions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
                language TEXT DEFAULT 'python',
                code TEXT NOT NULL,
                output TEXT DEFAULT '',
                error TEXT DEFAULT '',
                exit_code INT DEFAULT 0,
                duration_ms INT DEFAULT 0,
                sandbox_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS agent_memory (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id TEXT NOT NULL DEFAULT 'anonymous',
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                memory_type TEXT DEFAULT 'fact',
                key TEXT,
                content TEXT NOT NULL,
                importance FLOAT DEFAULT 0.5,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS tool_calls (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                tool_name TEXT NOT NULL,
                tool_input JSONB DEFAULT '{}',
                tool_output TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                duration_ms INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS agent_plans (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                task TEXT NOT NULL,
                steps JSONB DEFAULT '[]',
                current_step INT DEFAULT 0,
                status TEXT DEFAULT 'pending',
                result TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_executions_conv ON executions(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_user ON agent_memory(user_id, conversation_id);
            CREATE INDEX IF NOT EXISTS idx_tool_calls_conv ON tool_calls(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_plans_conv ON agent_plans(conversation_id);
        """)
    logger.info("✅ DB schema ready")


# ─── Conversation helpers ─────────────────────────────────────────────────────

async def create_conversation(
    user_id: str = "anonymous",
    title: str = "New conversation",
    model: str = "gemini-2.0-flash",
    provider: str = "gemini",
    task_type: str = "general",
    metadata: dict = None,
) -> Optional[dict]:
    if not _db_pool:
        # Return a fake conversation for DB-less mode
        import uuid
        return {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "title": title,
            "model": model,
            "provider": provider,
            "task_type": task_type,
            "status": "active",
            "metadata": metadata or {},
            "created_at": None,
            "updated_at": None,
        }
    try:
        async with _db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO conversations(user_id, title, model, provider, task_type, metadata)
                   VALUES($1,$2,$3,$4,$5,$6) RETURNING *""",
                user_id, title, model, provider, task_type,
                json.dumps(metadata or {})
            )
        return dict(row)
    except Exception as e:
        logger.error("create_conversation failed: %s", e)
        return None


async def list_conversations(user_id: str = "anonymous", limit: int = 50) -> List[dict]:
    if not _db_pool:
        return []
    try:
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2",
                user_id, limit
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("list_conversations failed: %s", e)
        return []


async def get_conversation(conv_id: str) -> Optional[dict]:
    if not _db_pool:
        return None
    try:
        async with _db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM conversations WHERE id=$1", conv_id
            )
        return dict(row) if row else None
    except Exception as e:
        logger.error("get_conversation failed: %s", e)
        return None


async def update_conversation_status(conv_id: str, status: str) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE conversations SET status=$1, updated_at=NOW() WHERE id=$2",
                status, conv_id
            )
        return True
    except Exception as e:
        logger.error("update_conversation_status failed: %s", e)
        return False


async def get_conversation_messages(conv_id: str, limit: int = 40) -> List[dict]:
    if not _db_pool:
        return []
    try:
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2",
                conv_id, limit
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("get_conversation_messages failed: %s", e)
        return []


async def save_message(
    conv_id: str,
    role: str,
    content: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    tool_calls: Optional[list] = None,
    tool_call_id: Optional[str] = None,
    tokens_used: int = 0,
    metadata: dict = None,
) -> Optional[str]:
    if not _db_pool:
        return None
    try:
        async with _db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO messages(conversation_id, role, content, provider, model,
                   tool_calls, tool_call_id, tokens_used, metadata)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
                conv_id, role, content, provider, model,
                json.dumps(tool_calls) if tool_calls else None,
                tool_call_id,
                tokens_used,
                json.dumps(metadata or {})
            )
            await conn.execute(
                "UPDATE conversations SET updated_at=NOW() WHERE id=$1", conv_id
            )
        return str(row["id"])
    except Exception as e:
        logger.error("save_message failed: %s", e)
        return None


async def save_execution(
    conv_id: Optional[str],
    language: str,
    code: str,
    output: str,
    error: str,
    exit_code: int,
    duration_ms: int,
) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO executions(conversation_id, language, code, output, error, exit_code, duration_ms)
                   VALUES($1,$2,$3,$4,$5,$6,$7)""",
                conv_id, language, code, output, error, exit_code, duration_ms
            )
        return True
    except Exception as e:
        logger.error("save_execution failed: %s", e)
        return False


async def delete_conversation(conv_id: str) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute("DELETE FROM conversations WHERE id=$1", conv_id)
        return True
    except Exception as e:
        logger.error("delete_conversation failed: %s", e)
        return False


# ─── Memory helpers ───────────────────────────────────────────────────────────

async def save_memory(
    user_id: str,
    content: str,
    conv_id: Optional[str] = None,
    memory_type: str = "fact",
    key: Optional[str] = None,
    importance: float = 0.5,
    metadata: dict = None,
) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_memory(user_id, conversation_id, memory_type, key, content, importance, metadata)
                   VALUES($1,$2,$3,$4,$5,$6,$7)""",
                user_id, conv_id, memory_type, key, content, importance,
                json.dumps(metadata or {})
            )
        return True
    except Exception as e:
        logger.error("save_memory failed: %s", e)
        return False


async def get_memories(
    user_id: str = "anonymous",
    conv_id: Optional[str] = None,
    memory_type: Optional[str] = None,
    limit: int = 20,
) -> List[dict]:
    if not _db_pool:
        return []
    try:
        conditions = ["user_id=$1"]
        params: list = [user_id]
        idx = 2
        if conv_id:
            conditions.append(f"conversation_id=${idx}")
            params.append(conv_id)
            idx += 1
        if memory_type:
            conditions.append(f"memory_type=${idx}")
            params.append(memory_type)
            idx += 1
        params.append(limit)
        where = " AND ".join(conditions)
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT * FROM agent_memory WHERE {where} ORDER BY importance DESC, created_at DESC LIMIT ${idx}",
                *params
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("get_memories failed: %s", e)
        return []


# ─── Tool calls helpers ───────────────────────────────────────────────────────

async def save_tool_call(
    conv_id: str,
    message_id: Optional[str],
    tool_name: str,
    tool_input: dict,
    tool_output: str,
    status: str = "success",
    duration_ms: int = 0,
) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO tool_calls(conversation_id, message_id, tool_name, tool_input, tool_output, status, duration_ms)
                   VALUES($1,$2,$3,$4,$5,$6,$7)""",
                conv_id, message_id, tool_name, json.dumps(tool_input),
                tool_output, status, duration_ms
            )
        return True
    except Exception as e:
        logger.error("save_tool_call failed: %s", e)
        return False


async def get_tool_calls(conv_id: str, limit: int = 20) -> List[dict]:
    if not _db_pool:
        return []
    try:
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM tool_calls WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $2",
                conv_id, limit
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("get_tool_calls failed: %s", e)
        return []


# ─── Agent plan helpers ───────────────────────────────────────────────────────

async def create_plan(
    conv_id: str,
    task: str,
    steps: list,
) -> Optional[str]:
    if not _db_pool:
        import uuid
        return str(uuid.uuid4())
    try:
        async with _db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO agent_plans(conversation_id, task, steps)
                   VALUES($1,$2,$3) RETURNING id""",
                conv_id, task, json.dumps(steps)
            )
        return str(row["id"])
    except Exception as e:
        logger.error("create_plan failed: %s", e)
        return None


async def update_plan(
    plan_id: str,
    current_step: int,
    status: str,
    result: str = "",
) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                """UPDATE agent_plans SET current_step=$1, status=$2, result=$3, updated_at=NOW()
                   WHERE id=$4""",
                current_step, status, result, plan_id
            )
        return True
    except Exception as e:
        logger.error("update_plan failed: %s", e)
        return False


async def get_executions(conv_id: str, limit: int = 10) -> List[dict]:
    if not _db_pool:
        return []
    try:
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM executions WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $2",
                conv_id, limit
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("get_executions failed: %s", e)
        return []


# ─── Redis helpers ────────────────────────────────────────────────────────────

async def publish_event(room: str, event: dict) -> bool:
    if not _redis:
        return False
    try:
        await _redis.publish(f"room:{room}", json.dumps(event))
        return True
    except Exception as e:
        logger.warning("Redis publish failed: %s", e)
        return False


async def cache_set(key: str, value: Any, ttl: int = 3600) -> bool:
    if not _redis:
        return False
    try:
        await _redis.setex(key, ttl, json.dumps(value))
        return True
    except Exception as e:
        logger.warning("Redis cache_set failed: %s", e)
        return False


async def cache_get(key: str) -> Optional[Any]:
    if not _redis:
        return None
    try:
        val = await _redis.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.warning("Redis cache_get failed: %s", e)
        return None


async def redis_ping() -> bool:
    if not _redis:
        return False
    try:
        await _redis.ping()
        return True
    except Exception:
        return False


def db_connected() -> bool:
    return _db_pool is not None


def redis_connected() -> bool:
    return _redis is not None


def get_redis():
    return _redis


def get_db():
    return _db_pool
