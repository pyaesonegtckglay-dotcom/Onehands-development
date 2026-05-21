"""
Onehands AI Backend — Hugging Face Space
==========================================
Autonomous AI Developer Platform Backend

Phase 1: Smart LLM Routing (Gemini/SambaNova/GitHub with round-robin + fallback)
Phase 2: Persistent Conversations (Supabase PostgreSQL)
Phase 3: Realtime Streaming (SSE + WebSocket via Redis pub/sub)
Phase 4: Code Execution (E2B sandboxed Python)
Phase 5: Autonomous Agent Loop (multi-step planning + tool execution)
Phase 6: Memory System + Tool Calling + Advanced Planning

Stack:
  • FastAPI + uvicorn
  • Supabase (PostgreSQL via asyncpg)
  • Upstash Redis — pub/sub, SSE bridge, caching
  • Smart API Router — multi-provider LLM with auto-heal cooldowns
  • E2B — secure sandboxed code execution
  • WebSocket + SSE — realtime event streaming
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx
from fastapi import (
    BackgroundTasks, Depends, FastAPI, HTTPException, Request,
    WebSocket, WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import persistence as db
from smart_router import Provider, _to_gemini_format, router as smart_router
import phase9
import phase10

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
    "https://openhands-genspark-frontend.vercel.app",
    "https://openhands-genspark-frontend-*.vercel.app",
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
    logger.info("🚀 Onehands backend ready — Phase 1-10 active")
    yield
    await db.close()
    logger.info("🛑 Onehands backend shutdown")

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Onehands AI Backend",
    description=(
        "Autonomous AI Developer platform backend: "
        "Phase 1-9 complete — multi-provider LLM routing, code execution, "
        "persistent conversations, realtime streaming, agent loop, memory system, "
        "full-stack code generation, GitHub integration, Vercel/HF deployment, "
        "async task queue, test runner, code review, file workspace."
    ),
    version="10.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Phase 9 Router registration ─────────────────────────────────────────────
app.include_router(phase9.router)
app.include_router(phase10.router)

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
    user_id:         str   = "anonymous"

class StreamChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message:         str
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    temperature:     float = 0.7
    max_tokens:      int   = 4096
    system_prompt:   Optional[str] = None
    user_id:         str   = "anonymous"

class ExecuteRequest(BaseModel):
    conversation_id: Optional[str] = None
    code:            str
    language:        str = "python"
    timeout:         int = 30

class ConversationCreate(BaseModel):
    user_id:   str           = "anonymous"
    title:     Optional[str] = None
    model:     str           = "gemini-2.0-flash"
    provider:  str           = "gemini"
    task_type: str           = "general"

class AgentTaskRequest(BaseModel):
    task:            str
    conversation_id: Optional[str] = None
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    max_steps:       int   = Field(default=10, ge=1, le=25)
    execute_code:    bool  = True
    user_id:         str   = "anonymous"
    use_memory:      bool  = True
    system_prompt:   Optional[str] = None

class MemoryRequest(BaseModel):
    user_id:     str   = "anonymous"
    content:     str
    memory_type: str   = "fact"
    key:         Optional[str] = None
    importance:  float = 0.5
    conv_id:     Optional[str] = None

class ToolCallRequest(BaseModel):
    tool_name: str
    tool_input: dict = {}
    conversation_id: Optional[str] = None

class PlanRequest(BaseModel):
    task:            str
    conversation_id: Optional[str] = None
    model:           str   = "gemini-2.0-flash"
    provider:        str   = "gemini"
    user_id:         str   = "anonymous"

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_oai_messages(system: Optional[str], history: list, user_msg: str) -> list:
    msgs: list[dict] = []
    if system:
        msgs.append({"role": "system", "content": system})
    for row in history:
        role = row.get("role", "user")
        if role in ("user", "assistant", "system", "tool"):
            msgs.append({"role": role, "content": row.get("content", "")})
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
    system_prompt: Optional[str] = None,
) -> tuple[str, str, str]:
    """Returns (content, used_provider, used_model)."""
    if auto_fallback:
        result = await smart_router.auto_chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            preferred_provider=provider,
            preferred_model=model,
            system_prompt=system_prompt,
        )
        return result["content"], result["provider"], result["model"]

    # strict provider
    if provider == "gemini":
        gemini_msgs = _to_gemini_format(messages)
        r = await smart_router.call_gemini(
            model, gemini_msgs, temperature, max_tokens,
            system_instruction=system_prompt
        )
        content = r["candidates"][0]["content"]["parts"][0]["text"]
    elif provider == "sambanova":
        msgs = messages
        if system_prompt:
            msgs = [{"role": "system", "content": system_prompt}] + [m for m in messages if m.get("role") != "system"]
        r = await smart_router.call_sambanova(model, msgs, temperature, max_tokens)
        content = r["choices"][0]["message"]["content"]
    elif provider == "github_llm":
        msgs = messages
        if system_prompt:
            msgs = [{"role": "system", "content": system_prompt}] + [m for m in messages if m.get("role") != "system"]
        r = await smart_router.call_github_llm(model, msgs, temperature, max_tokens)
        content = r["choices"][0]["message"]["content"]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    return content, provider, model

def _extract_code(text: str, language: str = "python") -> Optional[str]:
    """Extract first code block from markdown text."""
    patterns = [
        rf"```{language}\n(.*?)```",
        r"```python\n(.*?)```",
        r"```\n(.*?)```",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.DOTALL)
        if m:
            return m.group(1).strip()
    return None

def _extract_all_code_blocks(text: str) -> list[dict]:
    """Extract all code blocks with their languages."""
    pattern = r"```(\w*)\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)
    return [{"language": lang or "python", "code": code.strip()} for lang, code in matches]

# ─── E2B Code Execution ───────────────────────────────────────────────────────

async def _e2b_run(code: str, language: str, timeout: int) -> dict:
    if not E2B_API_KEY:
        # Fallback: try subprocess execution for safe code
        return await _local_run(code, language, timeout)
    try:
        import e2b_code_interpreter as e2b
        start = time.time()
        sandbox = await asyncio.to_thread(e2b.Sandbox, api_key=E2B_API_KEY, timeout=timeout)
        execution = await asyncio.to_thread(sandbox.run_code, code)
        duration = int((time.time() - start) * 1000)
        await asyncio.to_thread(sandbox.kill)
        stdout = "\n".join(str(x) for x in (execution.logs.stdout or []))
        stderr = "\n".join(str(x) for x in (execution.logs.stderr or []))
        # Also get results (e.g., DataFrames, plots)
        results_text = ""
        if hasattr(execution, 'results') and execution.results:
            for r in execution.results:
                if hasattr(r, 'text') and r.text:
                    results_text += r.text + "\n"
        combined_output = stdout
        if results_text:
            combined_output = combined_output + "\n" + results_text if combined_output else results_text
        return {
            "output":      combined_output.strip(),
            "error":       stderr,
            "exit_code":   1 if stderr and not stdout else 0,
            "duration_ms": duration,
            "provider":    "e2b",
        }
    except Exception as e:
        logger.error("E2B execution failed: %s", e)
        return {"output": "", "error": str(e), "exit_code": 1, "duration_ms": 0, "provider": "e2b"}


async def _local_run(code: str, language: str, timeout: int) -> dict:
    """Fallback local execution (limited, no sandbox)."""
    import subprocess, sys
    start = time.time()
    try:
        if language == "python":
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    subprocess.run,
                    [sys.executable, "-c", code],
                    capture_output=True, text=True, timeout=timeout
                ),
                timeout=timeout + 2
            )
            duration = int((time.time() - start) * 1000)
            return {
                "output":      result.stdout.strip(),
                "error":       result.stderr.strip(),
                "exit_code":   result.returncode,
                "duration_ms": duration,
                "provider":    "local",
            }
        else:
            return {
                "output":      "",
                "error":       f"Local execution only supports Python. Language '{language}' requires E2B.",
                "exit_code":   1,
                "duration_ms": 0,
                "provider":    "local",
            }
    except asyncio.TimeoutError:
        return {"output": "", "error": "Execution timed out", "exit_code": 124, "duration_ms": timeout*1000, "provider": "local"}
    except Exception as e:
        return {"output": "", "error": str(e), "exit_code": 1, "duration_ms": 0, "provider": "local"}

# ─── Built-in Tools ───────────────────────────────────────────────────────────

BUILTIN_TOOLS = {
    "web_search": {
        "description": "Search the web for current information",
        "parameters": {"query": "string — the search query"},
    },
    "execute_python": {
        "description": "Execute Python code in a secure sandbox",
        "parameters": {"code": "string — Python code to execute", "timeout": "int — max seconds (default 30)"},
    },
    "read_url": {
        "description": "Fetch content from a URL",
        "parameters": {"url": "string — the URL to fetch"},
    },
    "write_memory": {
        "description": "Store a fact or information in memory",
        "parameters": {"content": "string — what to remember", "key": "string — optional key"},
    },
    "recall_memory": {
        "description": "Recall stored memories",
        "parameters": {"query": "string — what to search for"},
    },
    "create_file": {
        "description": "Create a file with content (in sandbox)",
        "parameters": {"filename": "string — file name", "content": "string — file content"},
    },
}

async def _execute_tool(
    tool_name: str,
    tool_input: dict,
    conv_id: Optional[str] = None,
    user_id: str = "anonymous",
) -> dict:
    """Execute a built-in tool and return result."""
    start = time.time()
    result = {"tool": tool_name, "input": tool_input, "output": "", "error": "", "status": "success"}

    try:
        if tool_name == "execute_python":
            code = tool_input.get("code", "")
            timeout = tool_input.get("timeout", 30)
            exec_result = await _e2b_run(code, "python", timeout)
            result["output"] = exec_result.get("output", "")
            if exec_result.get("error"):
                result["error"] = exec_result["error"]
                result["status"] = "error" if exec_result.get("exit_code", 0) != 0 else "success"

        elif tool_name == "web_search":
            query = tool_input.get("query", "")
            # Use DuckDuckGo instant answer API (free, no key needed)
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    abstract = data.get("AbstractText", "") or data.get("Answer", "")
                    related = [r.get("Text", "") for r in data.get("RelatedTopics", [])[:3] if isinstance(r, dict)]
                    if abstract:
                        result["output"] = f"Answer: {abstract}\n\nRelated: {'; '.join(related)}"
                    elif related:
                        result["output"] = "Related results: " + "; ".join(related)
                    else:
                        result["output"] = f"Search completed for: {query}. No direct answer found."
                else:
                    result["output"] = f"Search for '{query}' returned HTTP {resp.status_code}"

        elif tool_name == "read_url":
            url = tool_input.get("url", "")
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200:
                    content = resp.text[:3000]  # Limit to 3000 chars
                    result["output"] = content
                else:
                    result["error"] = f"HTTP {resp.status_code}"
                    result["status"] = "error"

        elif tool_name == "write_memory":
            content = tool_input.get("content", "")
            key = tool_input.get("key")
            await db.save_memory(user_id, content, conv_id, "fact", key, 0.7)
            result["output"] = f"Stored in memory: {content[:100]}"

        elif tool_name == "recall_memory":
            query = tool_input.get("query", "")
            memories = await db.get_memories(user_id, conv_id, limit=5)
            if memories:
                mem_texts = [f"- {m['content']}" for m in memories]
                result["output"] = "Recalled memories:\n" + "\n".join(mem_texts)
            else:
                result["output"] = "No memories found."

        elif tool_name == "create_file":
            filename = tool_input.get("filename", "output.txt")
            content = tool_input.get("content", "")
            # Execute via E2B
            code = f"""
with open('/tmp/{filename}', 'w') as f:
    f.write({repr(content)})
print(f"File created: /tmp/{filename} ({len(content)} bytes)")
"""
            exec_result = await _e2b_run(code, "python", 15)
            result["output"] = exec_result.get("output", f"File {filename} created")

        else:
            result["error"] = f"Unknown tool: {tool_name}"
            result["status"] = "error"

    except Exception as e:
        result["error"] = str(e)
        result["status"] = "error"

    result["duration_ms"] = int((time.time() - start) * 1000)
    return result

# ─── Routes: root / health ────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service":  "Onehands AI Backend",
        "version":  "10.0.0",
        "status":   "running",
        "phases":   "1-10 active",
        "docs":     "/docs",
        "endpoints": [
            "/chat", "/chat/stream", "/execute",
            "/agent/task", "/agent/plan",
            "/conversations", "/memory",
            "/tools", "/tools/execute",
            "/health", "/health/keys",
            "/ws/{room}", "/models",
            # Phase 9
            "/dev/generate", "/dev/github", "/dev/deploy",
            "/dev/test", "/dev/review", "/dev/workflow",
            "/dev/metrics", "/dev/stacks",
            "/tasks", "/tasks/{task_id}",
            "/workspace/files",
            # Phase 10
            "/p10/orchestrate", "/p10/cicd", "/p10/self-improve",
            "/p10/task-graph", "/p10/bugfix", "/p10/consensus",
            "/p10/agents", "/p10/agent-memory", "/p10/stream-code",
            "/p10/status", "/p10/workspace-search",
        ],
    }

@app.get("/health")
async def health():
    redis_ok = await db.redis_ping()
    db_ok = db.db_connected()
    github_ok = bool(os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_PAT", ""))
    p9_metrics = phase9._metrics
    return {
        "status":       "ok" if (db_ok and redis_ok) else ("partial" if (db_ok or redis_ok) else "degraded"),
        "version":      "9.0.0",
        "database":     "connected" if db_ok else "disconnected",
        "redis":        "connected" if redis_ok else "disconnected",
        "e2b":          "configured" if E2B_API_KEY else "not_configured",
        "github":       "configured" if github_ok else "not_configured",
        "smart_router": smart_router.health(),
        "phases":       {
            "phase1_llm_routing":    True,
            "phase2_persistence":    db_ok,
            "phase3_realtime":       redis_ok,
            "phase4_code_exec":      bool(E2B_API_KEY),
            "phase5_agent_loop":     True,
            "phase6_memory_tools":   True,
            "phase9_code_gen":       True,
            "phase9_github_agent":   github_ok,
            "phase9_async_tasks":    True,
            "phase9_deploy_agent":   True,
            "phase9_test_runner":    bool(E2B_API_KEY),
            "phase9_code_review":    True,
            "phase9_workspace":      True,
            "phase9_workflow":       True,
        # Phase 10
        "phase10_multi_agent":     True,
        "phase10_cicd":            True,
        "phase10_self_improve":    True,
        "phase10_task_graph":      True,
        "phase10_bugfix":          True,
        "phase10_consensus":       True,
        "phase10_streaming":       True,
        "phase10_agent_memory":    True,
        },
        "phase9_stats": {
            "total_tasks":      p9_metrics["total_tasks"],
            "code_generations": p9_metrics["code_generations"],
            "github_ops":       p9_metrics["github_ops"],
            "deployments":      p9_metrics["deployments"],
            "tests_run":        p9_metrics["tests_run"],
            "reviews_done":     p9_metrics["reviews_done"],
        },
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
        task_type=data.task_type,
    )
    if not row:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return row

@app.get("/conversations")
async def list_conversations(user_id: str = "anonymous"):
    return await db.list_conversations(user_id)

@app.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    row = await db.get_conversation(conv_id)
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return row

@app.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str):
    return await db.get_conversation_messages(conv_id)

@app.get("/conversations/{conv_id}/executions")
async def get_executions(conv_id: str):
    return await db.get_executions(conv_id)

@app.get("/conversations/{conv_id}/tool-calls")
async def get_tool_calls(conv_id: str):
    return await db.get_tool_calls(conv_id)

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
            user_id=req.user_id,
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
            system_prompt=req.system_prompt,
        )
    except Exception as e:
        logger.error("chat error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    # Save & emit
    msg_id = await db.save_message(conv_id, "assistant", content, used_provider, used_model)
    await _emit(conv_id, {"type": "message", "role": "assistant", "content": content})

    return {
        "conv_id":  conv_id,
        "msg_id":   msg_id,
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
            user_id=req.user_id,
            title=req.message[:60], model=req.model, provider=req.provider
        )
        conv_id = str(row["id"]) if row else str(uuid.uuid4())

    history  = await db.get_conversation_messages(conv_id)
    messages = _build_oai_messages(req.system_prompt, history, req.message)
    await db.save_message(conv_id, "user", req.message)

    async def event_gen() -> AsyncGenerator[str, None]:
        full_text = ""
        used_provider = req.provider
        used_model = req.model

        # Emit start event
        yield f"data: {json.dumps({'type': 'start', 'conv_id': conv_id})}\\n\\n"

        try:
            if req.provider == "gemini":
                gemini_msgs = _to_gemini_format(messages)
                gen = smart_router.stream_gemini(
                    req.model, gemini_msgs,
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
                yield f"data: {json.dumps({'error': f'Unknown provider: {req.provider}'})}\\n\\n"
                return

            async for chunk in gen:
                full_text += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'conv_id': conv_id})}\\n\\n"

        except Exception as e:
            logger.warning("stream error, falling back to non-streaming: %s", e)
            # fallback to non-streaming with auto_fallback
            try:
                content, used_provider, used_model = await _llm_call(
                    provider=req.provider, model=req.model,
                    messages=messages, temperature=req.temperature,
                    max_tokens=req.max_tokens, auto_fallback=True,
                    system_prompt=req.system_prompt,
                )
                full_text = content
                # Stream it word-by-word for UX
                words = content.split(" ")
                for i, word in enumerate(words):
                    chunk = word + (" " if i < len(words)-1 else "")
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'conv_id': conv_id})}\\n\\n"
                    if i % 5 == 0:
                        await asyncio.sleep(0.01)
            except Exception as e2:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e2)})}\\n\\n"
                return

        await db.save_message(conv_id, "assistant", full_text, used_provider, used_model)
        await _emit(conv_id, {"type": "done", "conv_id": conv_id, "content": full_text})
        yield f"data: {json.dumps({'type': 'done', 'conv_id': conv_id, 'provider': used_provider, 'model': used_model})}\\n\\n"

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
            yield 'data: {"error":"Redis not available"}\\n\\n'
            return
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"room:{conv_id}")
        try:
            while True:
                if await request.is_disconnected():
                    break
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg["type"] == "message":
                    yield f"data: {msg['data']}\\n\\n"
                else:
                    yield ": keepalive\\n\\n"
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

            # Handle chat messages via WebSocket
            if msg.get("type") == "chat":
                conv_id = msg.get("conv_id", room)
                user_msg = msg.get("message", "")
                model = msg.get("model", "gemini-2.0-flash")
                provider = msg.get("provider", "gemini")

                await ws_mgr.broadcast(room, {"type": "ack", "conv_id": conv_id})

                try:
                    history = await db.get_conversation_messages(conv_id)
                    messages = _build_oai_messages(None, history, user_msg)
                    await db.save_message(conv_id, "user", user_msg)

                    content, used_provider, used_model = await _llm_call(
                        provider=provider, model=model,
                        messages=messages, temperature=0.7,
                        max_tokens=2048, auto_fallback=True,
                    )
                    await db.save_message(conv_id, "assistant", content, used_provider, used_model)
                    await ws_mgr.broadcast(room, {
                        "type": "message",
                        "role": "assistant",
                        "content": content,
                        "conv_id": conv_id,
                        "provider": used_provider,
                        "model": used_model,
                    })
                except Exception as e:
                    await ws_mgr.broadcast(room, {"type": "error", "error": str(e)})
            else:
                await ws_mgr.broadcast(room, msg)

    except WebSocketDisconnect:
        ws_mgr.disconnect(ws, room)
    except Exception as e:
        logger.error("WS error room=%s: %s", room, e)
        ws_mgr.disconnect(ws, room)

# ─── Code Execution (E2B) ─────────────────────────────────────────────────────

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

# ─── Tools ────────────────────────────────────────────────────────────────────

@app.get("/tools")
async def list_tools():
    """Phase 6: List available tools."""
    return {
        "tools": [
            {"name": name, **info}
            for name, info in BUILTIN_TOOLS.items()
        ]
    }

@app.post("/tools/execute")
async def execute_tool(req: ToolCallRequest, request: Request):
    """Phase 6: Execute a specific tool."""
    user_id = request.headers.get("X-User-ID", "anonymous")
    result = await _execute_tool(req.tool_name, req.tool_input, req.conversation_id, user_id)

    if req.conversation_id:
        await db.save_tool_call(
            req.conversation_id, None, req.tool_name,
            req.tool_input, result.get("output", ""),
            result.get("status", "success"), result.get("duration_ms", 0)
        )
        await _emit(req.conversation_id, {"type": "tool_result", **result})

    return result

# ─── Memory System ────────────────────────────────────────────────────────────

@app.post("/memory")
async def save_memory(req: MemoryRequest):
    """Phase 6: Save a memory."""
    ok = await db.save_memory(
        req.user_id, req.content, req.conv_id,
        req.memory_type, req.key, req.importance
    )
    return {"saved": ok, "content": req.content[:100]}

@app.get("/memory")
async def get_memory(
    user_id: str = "anonymous",
    conv_id: Optional[str] = None,
    memory_type: Optional[str] = None,
    limit: int = 20,
):
    """Phase 6: Retrieve memories."""
    memories = await db.get_memories(user_id, conv_id, memory_type, limit)
    return {"memories": memories, "count": len(memories)}

@app.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    """Phase 6: Delete a memory."""
    if not db.get_db():
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        async with db.get_db().acquire() as conn:
            await conn.execute("DELETE FROM agent_memory WHERE id=$1", memory_id)
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Agent Planning ───────────────────────────────────────────────────────────

PLANNER_SYSTEM = """You are an expert AI planning assistant for the Onehands autonomous agent.

Given a task, create a detailed step-by-step execution plan.
Return your plan as a JSON object with this exact structure:
{
  "task_summary": "brief summary of the task",
  "estimated_steps": 5,
  "complexity": "low|medium|high",
  "requires_code": true/false,
  "requires_web": false,
  "steps": [
    {
      "step": 1,
      "action": "search|execute_python|reason|write_memory|read_url|create_file|respond",
      "description": "what to do in this step",
      "input": "what input is needed",
      "expected_output": "what output is expected"
    }
  ]
}

Be precise and actionable. Each step should be atomic and measurable."""

@app.post("/agent/plan")
async def create_agent_plan(req: PlanRequest):
    """Phase 5+6: Create a detailed execution plan for a task."""
    messages = [
        {"role": "user", "content": f"Create a detailed execution plan for this task:\n\n{req.task}"}
    ]

    try:
        content, used_provider, used_model = await _llm_call(
            provider=req.provider,
            model=req.model,
            messages=messages,
            temperature=0.3,
            max_tokens=2048,
            auto_fallback=True,
            system_prompt=PLANNER_SYSTEM,
        )

        # Try to parse JSON from response
        plan_data = {}
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            try:
                plan_data = json.loads(json_match.group())
            except Exception:
                plan_data = {"task_summary": req.task, "steps": [{"step": 1, "description": content}]}
        else:
            plan_data = {"task_summary": req.task, "raw_plan": content}

        # Save plan to DB
        plan_id = None
        if req.conversation_id:
            plan_id = await db.create_plan(
                req.conversation_id, req.task,
                plan_data.get("steps", [])
            )

        return {
            "plan_id":   plan_id,
            "task":      req.task,
            "plan":      plan_data,
            "provider":  used_provider,
            "model":     used_model,
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

# ─── Agent Loop ───────────────────────────────────────────────────────────────

AGENT_SYSTEM = """You are Onehands — an autonomous AI developer agent.

You have access to the following tools:
- execute_python(code): Run Python code in a secure sandbox
- web_search(query): Search the web
- read_url(url): Fetch content from a URL
- write_memory(content, key): Store information
- recall_memory(query): Retrieve stored info
- create_file(filename, content): Create files

Given a task, you:
1. PLAN: Break it into numbered steps
2. THINK: Reason about each step
3. ACT: Call a tool if needed — use format: TOOL: tool_name | {"param": "value"}
4. OBSERVE: Process tool output
5. REPEAT: Until task is complete
6. FINISH: End with FINAL ANSWER: <your answer>

Response format for each step:
STEP N: <description>
THOUGHT: <reasoning>
ACTION: TOOL: tool_name | {"param": "value"}   (or "none" if no tool needed)
OBSERVATION: <tool output will be inserted here>
...
FINAL ANSWER: <complete answer to the task>"""

@app.post("/agent/task")
async def agent_task(req: AgentTaskRequest):
    """
    Phase 5+6: Autonomous agent loop:
    1. Create/use conversation
    2. LLM plans & executes step-by-step
    3. Tool calls executed and results fed back
    4. Memory stored/retrieved
    5. Returns full trace
    """
    conv_id = req.conversation_id
    if not conv_id:
        row = await db.create_conversation(
            user_id=req.user_id,
            title=f"Agent: {req.task[:50]}",
            model=req.model,
            provider=req.provider,
            task_type="agent",
        )
        conv_id = str(row["id"]) if row else str(uuid.uuid4())

    await db.save_message(conv_id, "user", req.task)
    await _emit(conv_id, {"type": "agent_start", "task": req.task, "conv_id": conv_id})

    # Load relevant memories
    memory_context = ""
    if req.use_memory:
        memories = await db.get_memories(req.user_id, conv_id, limit=5)
        if memories:
            mem_texts = [f"- {m['content']}" for m in memories]
            memory_context = "\n\nRelevant memories:\n" + "\n".join(mem_texts)

    system_prompt = req.system_prompt or AGENT_SYSTEM
    if memory_context:
        system_prompt += memory_context

    messages: list[dict] = [
        {"role": "user", "content": f"TASK: {req.task}"},
    ]

    trace: list[dict] = []
    step = 0
    final_answer = ""

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
                system_prompt=system_prompt,
            )
        except Exception as e:
            error_msg = f"LLM failed at step {step}: {e}"
            trace.append({"step": step, "type": "error", "content": error_msg})
            await _emit(conv_id, {"type": "agent_error", "step": step, "error": error_msg})
            break

        messages.append({"role": "assistant", "content": content})
        msg_id = await db.save_message(conv_id, "assistant", content, used_provider, used_model)

        await _emit(conv_id, {
            "type":     "agent_step",
            "step":     step,
            "content":  content,
            "provider": used_provider,
            "model":    used_model,
        })
        trace.append({"step": step, "type": "thought", "content": content})

        # Check for FINAL ANSWER
        final_match = re.search(r"FINAL ANSWER:\s*(.*?)(?:\n\n|\Z)", content, re.DOTALL)
        if final_match:
            final_answer = final_match.group(1).strip()
            trace.append({"step": step, "type": "final_answer", "content": final_answer})
            break

        # Parse tool calls from content
        tool_called = False
        tool_pattern = r"(?:ACTION:|TOOL:)\s*(?:TOOL:\s*)?(\w+)\s*\|\s*(\{.*?\})"
        tool_matches = re.findall(tool_pattern, content, re.DOTALL)

        for tool_name, tool_input_str in tool_matches:
            try:
                tool_input = json.loads(tool_input_str)
            except Exception:
                tool_input = {"raw": tool_input_str}

            logger.info("Agent tool call: %s  input=%s", tool_name, tool_input)
            await _emit(conv_id, {
                "type": "tool_call",
                "step": step,
                "tool": tool_name,
                "input": tool_input,
            })

            tool_result = await _execute_tool(tool_name, tool_input, conv_id, req.user_id)
            tool_called = True

            # Save tool call to DB
            await db.save_tool_call(
                conv_id, msg_id, tool_name,
                tool_input, tool_result.get("output", ""),
                tool_result.get("status", "success"),
                tool_result.get("duration_ms", 0),
            )

            await _emit(conv_id, {
                "type":   "tool_result",
                "step":   step,
                "tool":   tool_name,
                "output": tool_result.get("output", ""),
                "error":  tool_result.get("error", ""),
                "status": tool_result.get("status", "success"),
            })

            trace.append({
                "step":   step,
                "type":   "tool_call",
                "tool":   tool_name,
                "input":  tool_input,
                "output": tool_result.get("output", ""),
                "status": tool_result.get("status"),
            })

            # Feed tool result back to LLM
            obs = f"OBSERVATION: Tool {tool_name} result:\nOutput: {tool_result.get('output', 'No output')}"
            if tool_result.get("error"):
                obs += f"\nError: {tool_result['error']}"
            messages.append({"role": "user", "content": obs})

        # Execute standalone code blocks (Phase 4)
        if req.execute_code and not tool_called:
            code_blocks = _extract_all_code_blocks(content)
            for block in code_blocks[:2]:  # Max 2 blocks per step
                lang = block["language"]
                code = block["code"]
                if len(code) < 5:
                    continue

                exec_result = await _e2b_run(code, lang, 30)
                await db.save_execution(
                    conv_id, lang, code,
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

        # Check if done via keywords
        done_keywords = (
            "final answer", "task complete", "task completed",
            "i have completed", "done.", "finished.", "complete.",
            "## summary", "## result"
        )
        if any(kw in content.lower() for kw in done_keywords) and not final_answer:
            final_answer = content
            break

    # Auto-save important result to memory
    if final_answer and req.use_memory:
        await db.save_memory(
            req.user_id, f"Task: {req.task[:100]} → Result: {final_answer[:200]}",
            conv_id, "task_result", importance=0.8
        )

    await _emit(conv_id, {
        "type": "agent_done",
        "steps": step,
        "conv_id": conv_id,
        "final_answer": final_answer,
    })

    return {
        "conv_id":      conv_id,
        "task":         req.task,
        "steps":        step,
        "final_answer": final_answer,
        "trace":        trace,
    }

# ─── Models ───────────────────────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    return {
        "gemini": [
            {"id": "gemini-2.0-flash",              "name": "Gemini 2.0 Flash",          "context": 1048576, "free": True},
            {"id": "gemini-2.0-flash-thinking-exp", "name": "Gemini 2.0 Flash Thinking", "context": 32768,   "free": True},
            {"id": "gemini-1.5-pro",                "name": "Gemini 1.5 Pro",            "context": 2097152, "free": True},
            {"id": "gemini-1.5-flash",              "name": "Gemini 1.5 Flash",          "context": 1048576, "free": True},
            {"id": "gemini-2.5-flash-preview-05-20","name": "Gemini 2.5 Flash Preview",  "context": 1048576, "free": True},
        ],
        "sambanova": [
            {"id": "Meta-Llama-3.3-70B-Instruct",  "name": "Llama 3.3 70B",    "context": 131072},
            {"id": "Meta-Llama-3.1-405B-Instruct", "name": "Llama 3.1 405B",   "context": 16384},
            {"id": "DeepSeek-R1",                  "name": "DeepSeek R1",       "context": 32768},
            {"id": "Qwen2.5-72B-Instruct",         "name": "Qwen 2.5 72B",     "context": 32768},
            {"id": "Qwen3-32B",                    "name": "Qwen 3 32B",        "context": 131072},
        ],
        "github_llm": [
            {"id": "gpt-4o",                          "name": "GPT-4o",                   "context": 128000},
            {"id": "gpt-4o-mini",                     "name": "GPT-4o Mini",              "context": 128000},
            {"id": "Meta-Llama-3.1-70B-Instruct",     "name": "Llama 3.1 70B (GitHub)",   "context": 131072},
            {"id": "Mistral-large-2407",              "name": "Mistral Large",             "context": 131072},
            {"id": "DeepSeek-R1",                     "name": "DeepSeek R1 (GitHub)",      "context": 65536},
        ],
    }

# ─── Entry ────────────────────────────────────────────────────────────────────

@app.post("/debug/reconnect")
async def debug_reconnect():
    """Force reconnect to DB and Redis — useful after secrets are updated."""
    import os, traceback as tb
    from urllib.parse import quote_plus, unquote
    db_error = None
    redis_error = None

    # Try DB connect with detailed error capture
    db_result = False
    try:
        db_result = await db.init_db()
    except Exception as e:
        db_error = str(e)

    # Try Redis connect
    redis_result = False
    try:
        redis_result = await db.init_redis()
    except Exception as e:
        redis_error = str(e)

    # Show the decoded DB URL (masked) for debugging
    raw_url = os.environ.get("DATABASE_URL", "")
    db_url_info = "not_set"
    if raw_url:
        try:
            rest = raw_url.split("://", 1)[1]
            last_at = rest.rfind("@")
            host_part = rest[last_at+1:] if last_at >= 0 else "parse_error"
            db_url_info = f"***@{host_part}"
        except Exception:
            db_url_info = "parse_error"

    return {
        "db_reconnect": "success" if db_result else "failed",
        "redis_reconnect": "success" if redis_result else "failed",
        "db_connected": db.db_connected(),
        "redis_connected": db.redis_connected(),
        "db_error": db_error,
        "redis_error": redis_error,
        "db_url_debug": db_url_info,
    }


@app.get("/debug/env")
async def debug_env():
    """Show sanitized env vars for debugging."""
    import os
    def mask(v): return f"***{v[-4:]}" if v and len(v) > 4 else ("set" if v else "not_set")
    return {
        "DATABASE_URL": mask(os.environ.get("DATABASE_URL", "")),
        "REDIS_URL": mask(os.environ.get("REDIS_URL", "")),
        "E2B_API_KEY": mask(os.environ.get("E2B_API_KEY", "")),
        "GEMINI_KEYS": f"{len(os.environ.get('GEMINI_KEYS','').split(','))} keys" if os.environ.get("GEMINI_KEYS") else "not_set",
        "SAMBANOVA_KEYS": f"{len(os.environ.get('SAMBANOVA_KEYS','').split(','))} keys" if os.environ.get("SAMBANOVA_KEYS") else "not_set",
        "GITHUB_KEYS": f"{len(os.environ.get('GITHUB_KEYS','').split(','))} keys" if os.environ.get("GITHUB_KEYS") else "not_set",
        "GITHUB_TOKEN": mask(os.environ.get("GITHUB_TOKEN", "") or os.environ.get("GITHUB_PAT", "")),
        "VERCEL_TOKEN": mask(os.environ.get("VERCEL_TOKEN", "")),
        "HF_TOKEN": mask(os.environ.get("HF_TOKEN", "")),
    }


# ─── Phase 9: Register LLM + E2B callbacks ───────────────────────────────────
# Done after all functions are defined so they're available for injection

phase9.register_llm_fn(_llm_call)
phase9.register_e2b_fn(_e2b_run)
phase9.register_emit_fn(_emit)
phase9.register_execute_tool_fn(_execute_tool)

phase10.register_llm_fn(_llm_call)
phase10.register_e2b_fn(_e2b_run)
phase10.register_emit_fn(_emit)
phase10.register_execute_tool_fn(_execute_tool)

logger.info("✅ Phase 9 + 10 callbacks registered")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 7860)),
        log_level="info",
        workers=1,
    )
