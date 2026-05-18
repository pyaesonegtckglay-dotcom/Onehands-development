"""
Persistence layer: Supabase (PostgreSQL) + Redis (Upstash).

Provides:
  - DB pool (asyncpg) for conversations, messages, executions
  - Redis pub/sub for realtime SSE/WebSocket bridging
  - Auto-init schema on startup
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, AsyncGenerator, Dict, List, Optional
from urllib.parse import unquote

logger = logging.getLogger(__name__)

# ─── Connection state ─────────────────────────────────────────────────────────

_db_pool = None          # asyncpg.Pool
_redis = None            # redis.asyncio.Redis


async def init_db() -> bool:
    """Connect to Supabase PostgreSQL. Returns True on success."""
    global _db_pool
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        logger.warning("DATABASE_URL not set — DB persistence disabled")
        return False
    # asyncpg expects real @ character, not %40
    db_url = unquote(db_url)
    try:
        import asyncpg
        _db_pool = await asyncpg.create_pool(
            db_url,
            min_size=1,
            max_size=8,
            command_timeout=30,
            ssl="require",
        )
        await _create_schema()
        logger.info("✅ Supabase/PostgreSQL connected")
        return True
    except Exception as e:
        logger.error("❌ DB connection failed: %s", e)
        return False


async def init_redis() -> bool:
    """Connect to Upstash Redis. Returns True on success."""
    global _redis
    redis_url = os.environ.get("REDIS_URL", "")
    if not redis_url:
        logger.warning("REDIS_URL not set — Redis realtime disabled")
        return False
    try:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            ssl_cert_reqs=None,
        )
        await _redis.ping()
        logger.info("✅ Redis (Upstash) connected")
        return True
    except Exception as e:
        logger.error("❌ Redis connection failed: %s", e)
        return False


async def close():
    global _db_pool, _redis
    if _db_pool:
        await _db_pool.close()
    if _redis:
        await _redis.close()


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
                metadata JSONB DEFAULT '{}',
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

            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_executions_conv ON executions(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
        """)
    logger.info("✅ DB schema ready")


# ─── Conversation helpers ─────────────────────────────────────────────────────

async def create_conversation(
    user_id: str = "anonymous",
    title: str = "New conversation",
    model: str = "gemini-2.0-flash",
    provider: str = "gemini",
) -> Optional[dict]:
    if not _db_pool:
        return None
    try:
        async with _db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO conversations(user_id, title, model, provider)
                   VALUES($1,$2,$3,$4) RETURNING *""",
                user_id, title, model, provider
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
) -> bool:
    if not _db_pool:
        return False
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO messages(conversation_id, role, content, provider, model)
                   VALUES($1,$2,$3,$4,$5)""",
                conv_id, role, content, provider, model
            )
            await conn.execute(
                "UPDATE conversations SET updated_at=NOW() WHERE id=$1", conv_id
            )
        return True
    except Exception as e:
        logger.error("save_message failed: %s", e)
        return False


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
