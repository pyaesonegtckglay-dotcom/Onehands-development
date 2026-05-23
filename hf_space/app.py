"""
Onehands Autonomous AI Developer — Backend
HuggingFace Space: PYAE1994/openhands-genspark-agent
Port: 7860

All phases in one lean file:
- Phase 1: Smart LLM Routing (Gemini/GitHub/SambaNova)
- Phase 2: Persistent Conversations (Supabase PostgreSQL)
- Phase 3: Realtime Streaming (SSE + WebSocket)
- Phase 4: Code Execution (E2B + local fallback)
- Phase 5: Autonomous Agent Loop (ReAct)
- Phase 6: Memory System
- Phase 7: Developer Workflow (Generate→Test→GitHub→Deploy)
- Phase 8: Code Intelligence
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import persistence as db
from smart_router import Provider, _to_gemini_format, router as smart_router
import phase9
import phase10
import agent as ag

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("onehands")

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Onehands AI Developer...")
    await db.init_db()
    await db.init_redis()
    logger.info("🚀 Onehands backend ready — Phase 1-10 active")
    yield
    await db.close()
    logger.info("🛑 Onehands shutdown")

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Onehands AI Backend",
    description=(
        "Autonomous AI Developer platform backend: "
        "Phase 1-10 complete — multi-provider LLM routing, code execution, "
        "persistent conversations, realtime streaming, agent loop, memory system, "
        "full-stack code generation, GitHub integration, Vercel/HF deployment, "
        "async task queue, test runner, code review, file workspace, "
        "multi-agent orchestration."
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

# ─── Phase 9 + 10 Router registration ───────────────────────────────────────────
app.include_router(phase9.router)
app.include_router(phase10.router)

# ─── WebSocket manager ────────────────────────────────────────────────────────
class WSManager:
    def __init__(self):
        self._rooms: Dict[str, List[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self._rooms.setdefault(room, []).append(ws)

    def disconnect(self, ws: WebSocket, room: str):
        self._rooms[room] = [c for c in self._rooms.get(room, []) if c is not ws]

    async def broadcast(self, room: str, data: dict):
        dead = []
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
    message: str
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: Optional[str] = None
    auto_fallback: bool = True
    user_id: str = "anonymous"

class AgentTaskRequest(BaseModel):
    task: str
    conversation_id: Optional[str] = None
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    max_steps: int = Field(default=10, ge=1, le=25)
    execute_code: bool = True
    user_id: str = "anonymous"
    use_memory: bool = True
    system_prompt: Optional[str] = None

class PlanRequest(BaseModel):
    task: str
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"

class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = Field(default=30, ge=1, le=120)
    conversation_id: Optional[str] = None

class ConversationCreate(BaseModel):
    user_id: str = "anonymous"
    title: Optional[str] = None
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    task_type: str = "general"

class MemoryRequest(BaseModel):
    user_id: str = "anonymous"
    content: str
    memory_type: str = "fact"
    key: Optional[str] = None
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    conversation_id: Optional[str] = None

class DevGenerateRequest(BaseModel):
    description: str
    stack: str = "python-fastapi"
    include_tests: bool = True
    include_dockerfile: bool = True
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"

class DevWorkflowRequest(BaseModel):
    description: str
    stack: str = "python-fastapi"
    provider: str = "gemini"
    model: str = "gemini-2.0-flash"
    user_id: str = "anonymous"
    github_token: Optional[str] = None
    github_repo: Optional[str] = None
    vercel_token: Optional[str] = None
    hf_token: Optional[str] = None
    deploy_to: Optional[str] = None
    run_tests: bool = True

class GitHubRequest(BaseModel):
    operation: str
    github_token: Optional[str] = None
    repo_name: Optional[str] = None
    repo: Optional[str] = None
    files: Optional[Dict[str, str]] = None
    message: Optional[str] = None
    branch: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    head: Optional[str] = None
    base: Optional[str] = None
    description: Optional[str] = None
    private: bool = False

class DeployRequest(BaseModel):
    target: str  # "vercel" | "huggingface"
    project_name: str
    files: Dict[str, str]
    vercel_token: Optional[str] = None
    hf_token: Optional[str] = None
    space_id: Optional[str] = None

class CodeIntelRequest(BaseModel):
    operation: str  # explain | refactor | debug | document | convert | review
    code: str
    language: str = "python"
    context: str = ""
    provider: str = "gemini"
    model: str = "gemini-2.0-flash"

class AsyncTaskRequest(BaseModel):
    task_type: str
    payload: Dict[str, Any] = {}
    user_id: str = "anonymous"

async def _e2b_run(code: str, language: str, timeout: int) -> dict:
    if not E2B_API_KEY:
        # Fallback: try subprocess execution for safe code
        return await _local_run(code, language, timeout)
    try:
        import e2b_code_interpreter as e2b
        import inspect
        start = time.time()
        
        # Handle both old and new E2B SDK APIs
        sandbox_cls = e2b.Sandbox if hasattr(e2b, 'Sandbox') else e2b.CodeInterpreter
        
        # New E2B SDK (v1.x): uses os.environ E2B_API_KEY automatically, no api_key kwarg
        # Old E2B SDK (v0.x): accepts api_key=
        try:
            # Try new API first (v1.x) — no api_key kwarg
            os.environ["E2B_API_KEY"] = E2B_API_KEY
            # v1.x uses context manager or direct create
            if hasattr(sandbox_cls, 'create'):
                sandbox = await asyncio.to_thread(sandbox_cls.create)
            else:
                sandbox = await asyncio.to_thread(sandbox_cls)
        except TypeError:
            # Fallback to old API
            sandbox = await asyncio.to_thread(sandbox_cls, api_key=E2B_API_KEY, timeout=timeout)
        
        execution = await asyncio.to_thread(sandbox.run_code, code)
        duration = int((time.time() - start) * 1000)
        try:
            await asyncio.to_thread(sandbox.kill)
        except Exception:
            pass
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
        logger.error("E2B execution failed: %s — falling back to local", e)
        return await _local_run(code, language, timeout)


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
class WorkspaceFileRequest(BaseModel):
    filename: str
    content: str
    user_id: str = "anonymous"

# ─── Root & Health ─────────────────────────────────────────────────────────────
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
        "service": "Onehands Autonomous AI Developer",
        "version": "12.0.0",
        "status": "running",
        "phases": {
            "phase_1": "Smart LLM Routing ✅",
            "phase_2": "Persistent Conversations ✅",
            "phase_3": "Realtime Streaming ✅",
            "phase_4": "Code Execution (E2B) ✅",
            "phase_5": "ReAct Agent Loop ✅",
            "phase_6": "Memory System ✅",
            "phase_7": "Dev Workflow ✅",
            "phase_8": "Code Intelligence ✅",
        },
        "providers": smart_router.health(),
        "db": "connected" if db.is_db_ok() else "fallback",
        "redis": "connected" if db.is_redis_ok() else "disabled",
        "e2b": "configured" if ag.E2B_API_KEY else "not_configured",
    }

@app.get("/health")
async def health():
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory().percent
    except Exception:
        cpu = 0.0
        mem = 0.0

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
        "status": "healthy",
        "db": db.is_db_ok(),
        "redis": db.is_redis_ok(),
        "e2b": bool(ag.E2B_API_KEY),
        "providers": smart_router.health(),
        "system": {"cpu_percent": cpu, "memory_percent": mem},
        "timestamp": time.time(),
    }

@app.get("/health/keys")
async def health_keys():
    return smart_router.health()

@app.post("/health/reload-keys")
async def reload_keys():
    smart_router.reload_keys()
    return {"status": "reloaded", "health": smart_router.health()}

@app.get("/models")
async def list_models():
    return {
        "models": [
            {"provider": "gemini", "model": "gemini-2.0-flash", "description": "Google Gemini 2.0 Flash"},
            {"provider": "gemini", "model": "gemini-1.5-pro", "description": "Google Gemini 1.5 Pro"},
            {"provider": "github", "model": "gpt-4o-mini", "description": "OpenAI GPT-4o Mini via GitHub"},
            {"provider": "github", "model": "gpt-4o", "description": "OpenAI GPT-4o via GitHub"},
            {"provider": "sambanova", "model": "Meta-Llama-3.1-8B-Instruct", "description": "Meta Llama 3.1 8B"},
            {"provider": "sambanova", "model": "Meta-Llama-3.1-70B-Instruct", "description": "Meta Llama 3.1 70B"},
        ]
    }

# ─── Conversations ──────────────────────────────────────────────────────────
@app.post("/conversations", status_code=201)
async def create_conversation(req: ConversationCreate):
    conv = await db.create_conversation(
        user_id=req.user_id,
        title=req.title,
        model=req.model,
        provider=req.provider,
        task_type=req.task_type,
    )
    return conv

@app.get("/conversations")
async def list_conversations(user_id: str = "anonymous"):
    return {"conversations": await db.list_conversations(user_id)}

@app.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv

@app.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str):
    return {"messages": await db.get_messages(conv_id)}

@app.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await db.delete_conversation(conv_id)
    return {"status": "deleted"}

# ─── Chat ───────────────────────────────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    # Get conversation history
    history = []
    if req.conversation_id:
        msgs = await db.get_messages(req.conversation_id, limit=20)
        history = [{"role": m["role"], "content": m["content"]} for m in msgs]

    messages = history + [{"role": "user", "content": req.message}]

    result = await smart_router.auto_chat(
        messages=messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        preferred_provider=req.provider,
        preferred_model=req.model,
        system_prompt=req.system_prompt,
    )

    # Save messages
    if req.conversation_id:
        await db.save_message(req.conversation_id, "user", req.message)
        await db.save_message(
            req.conversation_id, "assistant", result["content"],
            provider=result["provider"], model=result["model"]
        )

    return {
        "content": result["content"],
        "provider": result["provider"],
        "model": result["model"],
        "conversation_id": req.conversation_id,
    }

@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    history = []
    if req.conversation_id:
        msgs = await db.get_messages(req.conversation_id, limit=20)
        history = [{"role": m["role"], "content": m["content"]} for m in msgs]

    messages = history + [{"role": "user", "content": req.message}]
    full_response = []

    async def event_generator():
        nonlocal full_response
        try:
            async for chunk in smart_router.auto_stream(
                messages=messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                preferred_provider=req.provider,
                preferred_model=req.model,
                system_prompt=req.system_prompt,
            ):
                full_response.append(chunk)
                data = json.dumps({"type": "token", "content": chunk})
                yield f"data: {data}\n\n"

            # Save to DB after streaming
            if req.conversation_id:
                full_text = "".join(full_response)
                await db.save_message(req.conversation_id, "user", req.message)
                await db.save_message(req.conversation_id, "assistant", full_text,
                                     provider=req.provider, model=req.model)

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

# ─── WebSocket ───────────────────────────────────────────────────────────────
@app.websocket("/ws/{room}")
async def websocket_endpoint(ws: WebSocket, room: str):
    await ws_mgr.connect(ws, room)
    try:
        while True:
            data = await ws.receive_json()
            await ws_mgr.broadcast(room, data)
    except WebSocketDisconnect:
        ws_mgr.disconnect(ws, room)
    except Exception as e:
        logger.warning(f"WebSocket error room={room}: {e}")
        ws_mgr.disconnect(ws, room)

# ─── Code Execution ──────────────────────────────────────────────────────────
@app.post("/execute")
async def execute_code(req: ExecuteRequest):
    result = await ag.execute_code(
        req.code, req.language, req.timeout, req.conversation_id
    )
    return result

# ─── Agent ───────────────────────────────────────────────────────────────────
@app.post("/agent/task")
async def agent_task(req: AgentTaskRequest, background_tasks: BackgroundTasks):
    result = await ag.run_agent(
        task=req.task,
        user_id=req.user_id,
        conv_id=req.conversation_id,
        model=req.model,
        provider=req.provider,
        max_steps=req.max_steps,
        execute_code_flag=req.execute_code,
        use_memory=req.use_memory,
        system_prompt=req.system_prompt,
    )
    # Save final answer to conversation if given
    if req.conversation_id and result.get("final_answer"):
        await db.save_message(req.conversation_id, "user", req.task)
        await db.save_message(
            req.conversation_id, "assistant",
            result["final_answer"],
            provider=req.provider, model=req.model
        )
    return result

@app.post("/agent/plan")
async def agent_plan(req: PlanRequest):
    return await ag.generate_plan(
        task=req.task,
        provider=req.provider,
        model=req.model,
        user_id=req.user_id,
    )

# ─── Memory ───────────────────────────────────────────────────────────────────
@app.post("/memory")
async def save_memory(req: MemoryRequest):
    mem = await db.save_memory(
        req.user_id, req.content, req.memory_type,
        req.key, req.importance, req.conversation_id
    )
    return mem

@app.get("/memory")
async def get_memory(user_id: str = "anonymous", limit: int = 10):
    mems = await db.get_memories(user_id, limit)
    return {"memories": mems}

# ─── Tools ────────────────────────────────────────────────────────────────────
@app.get("/tools")
async def list_tools():
    return {"tools": ag.TOOL_SCHEMAS}

@app.post("/tools/execute")
async def execute_tool(req: dict):
    tool_name = req.get("tool_name", "")
    tool_input = req.get("tool_input", {})
    user_id = req.get("user_id", "anonymous")
    result = await ag._run_tool(tool_name, tool_input, user_id, None)
    return {"tool": tool_name, "result": result}

# ─── Developer: Code Generation ──────────────────────────────────────────────
@app.post("/dev/generate")
async def dev_generate(req: DevGenerateRequest, background_tasks: BackgroundTasks):
    task = dev.new_task(req.user_id, "generate", req.description[:80])
    task_id = task["task_id"]
    dev.update_task(task_id, status="running")

    async def _run():
        try:
            result = await dev.generate_project(
                description=req.description,
                stack=req.stack,
                include_tests=req.include_tests,
                include_dockerfile=req.include_dockerfile,
                provider=req.provider,
                model=req.model,
                user_id=req.user_id,
                task_id=task_id,
            )
            dev.update_task(task_id, status="completed", progress=100, result=result)
        except Exception as e:
            dev.update_task(task_id, status="failed", error=str(e))

    background_tasks.add_task(_run)
    return {"task_id": task_id, "status": "started"}

@app.get("/dev/stacks")
async def dev_stacks():
    return {
        "stacks": [
            {"id": k, "name": v["name"], "run_cmd": v["run_cmd"]}
            for k, v in dev.STACK_CONFIGS.items()
        ]
    }

# ─── Developer: GitHub Operations ────────────────────────────────────────────
@app.post("/dev/github")
async def dev_github(req: GitHubRequest):
    kwargs = req.model_dump(exclude={"operation", "github_token"})
    result = await dev.github_op(req.operation, github_token=req.github_token, **kwargs)
    return result

# ─── Developer: Deploy ────────────────────────────────────────────────────────
@app.post("/dev/deploy")
async def dev_deploy(req: DeployRequest):
    if req.target == "vercel":
        return await dev.deploy_to_vercel(
            req.project_name, req.files, vercel_token=req.vercel_token
        )
    elif req.target == "huggingface":
        space_id = req.space_id or f"user/{req.project_name}"
        return await dev.deploy_to_huggingface(
            space_id, req.files, hf_token=req.hf_token
        )
    raise HTTPException(400, f"Unknown deploy target: {req.target}")

# ─── Developer: Full Workflow ─────────────────────────────────────────────────
@app.post("/dev/workflow")
async def dev_workflow(req: DevWorkflowRequest, background_tasks: BackgroundTasks):
    task = dev.new_task(req.user_id, "workflow", req.description[:80])
    task_id = task["task_id"]
    dev.update_task(task_id, status="running")

    async def _run():
        try:
            result = await dev.run_dev_workflow(
                description=req.description,
                stack=req.stack,
                provider=req.provider,
                model=req.model,
                user_id=req.user_id,
                github_token=req.github_token,
                github_repo=req.github_repo,
                vercel_token=req.vercel_token,
                hf_token=req.hf_token,
                deploy_to=req.deploy_to,
                run_tests=req.run_tests,
                task_id=task_id,
            )
            dev.update_task(task_id, status="completed", progress=100, result=result)
        except Exception as e:
            dev.update_task(task_id, status="failed", error=str(e))

    background_tasks.add_task(_run)
    return {"task_id": task_id, "status": "started", "message": "Workflow started in background"}

# ─── Developer: Code Intelligence ─────────────────────────────────────────────
@app.post("/dev/explain")
async def dev_explain(req: CodeIntelRequest):
    return await dev.code_intelligence("explain", req.code, req.language, req.context, req.provider, req.model)

@app.post("/dev/refactor")
async def dev_refactor(req: CodeIntelRequest):
    return await dev.code_intelligence("refactor", req.code, req.language, req.context, req.provider, req.model)

@app.post("/dev/debug")
async def dev_debug(req: CodeIntelRequest):
    return await dev.code_intelligence("debug", req.code, req.language, req.context, req.provider, req.model)

@app.post("/dev/document")
async def dev_document(req: CodeIntelRequest):
    return await dev.code_intelligence("document", req.code, req.language, req.context, req.provider, req.model)

@app.post("/dev/convert")
async def dev_convert(req: CodeIntelRequest):
    return await dev.code_intelligence("convert", req.code, req.language, req.context, req.provider, req.model)

@app.post("/dev/review")
async def dev_review(req: CodeIntelRequest):
    return await dev.code_intelligence("review", req.code, req.language, req.context, req.provider, req.model)

@app.get("/dev/metrics")
async def dev_metrics():
    all_tasks = list(dev._tasks.values())
    completed = [t for t in all_tasks if t["status"] == "completed"]
    failed = [t for t in all_tasks if t["status"] == "failed"]
    running = [t for t in all_tasks if t["status"] == "running"]
    return {
        "total_tasks": len(all_tasks),
        "completed": len(completed),
        "failed": len(failed),
        "running": len(running),
        "success_rate": len(completed) / max(len(all_tasks), 1) * 100,
        "task_types": {},
    }

# ─── Async Tasks ──────────────────────────────────────────────────────────────
@app.post("/tasks")
async def submit_task(req: AsyncTaskRequest, background_tasks: BackgroundTasks):
    task = dev.new_task(req.user_id, req.task_type, str(req.payload)[:80])
    task_id = task["task_id"]
    dev.update_task(task_id, status="running")

    async def _dispatch():
        try:
            if req.task_type == "generate":
                result = await dev.generate_project(
                    description=req.payload.get("description", ""),
                    stack=req.payload.get("stack", "python-fastapi"),
                    user_id=req.user_id,
                    task_id=task_id,
                )
            elif req.task_type == "agent":
                result = await ag.run_agent(
                    task=req.payload.get("task", ""),
                    user_id=req.user_id,
                    task_id=task_id,
                )
            elif req.task_type == "workflow":
                result = await dev.run_dev_workflow(
                    description=req.payload.get("description", ""),
                    user_id=req.user_id,
                    task_id=task_id,
                    **{k: v for k, v in req.payload.items() if k != "description"},
                )
            else:
                result = {"error": f"Unknown task type: {req.task_type}"}
            dev.update_task(task_id, status="completed", progress=100, result=result)
        except Exception as e:
            dev.update_task(task_id, status="failed", error=str(e))

    background_tasks.add_task(_dispatch)
    return {"task_id": task_id, "status": "started"}

@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = dev.get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    return task

@app.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str):
    task = dev.get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task["status"] not in ("completed", "failed"):
        return {"status": task["status"], "progress": task["progress"], "logs": task["logs"]}
    return {"status": task["status"], "result": task["result"], "error": task.get("error")}

@app.get("/tasks")
async def list_tasks(user_id: str = "anonymous"):
    return {"tasks": dev.list_tasks(user_id)}

# ─── Workspace ────────────────────────────────────────────────────────────────
@app.post("/workspace/files")
async def workspace_create(req: WorkspaceFileRequest):
    result = ag.workspace_create(req.user_id, req.filename, req.content)
    return result

@app.get("/workspace/files")
async def workspace_list(user_id: str = "anonymous"):
    return {"files": ag.workspace_list(user_id)}

@app.get("/workspace/files/{filename:path}")
async def workspace_read(filename: str, user_id: str = "anonymous"):
    content = ag.workspace_read(user_id, filename)
    if content is None:
        raise HTTPException(404, f"File {filename} not found")
    return {"filename": filename, "content": content}

@app.delete("/workspace/files/{filename:path}")
async def workspace_delete(filename: str, user_id: str = "anonymous"):
    deleted = ag.workspace_delete(user_id, filename)
    return {"deleted": deleted, "filename": filename}

# ─── Debug ───────────────────────────────────────────────────────────────────
@app.get("/debug/env")
async def debug_env():
    """Check which env vars are set (values masked)."""
    keys_to_check = [
        "GEMINI_KEY", "GITHUB_TOKEN", "SAMBANOVA_KEY",
        "DATABASE_URL", "REDIS_URL", "E2B_API_KEY",
        "HF_TOKEN", "VERCEL_TOKEN"
    ]
    return {
        k: "✅ set" if os.environ.get(k) else "❌ not set"
        for k in keys_to_check
    }


# ─── Phase 9 + 10: Register LLM + E2B callbacks ─────────────────────────────
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
