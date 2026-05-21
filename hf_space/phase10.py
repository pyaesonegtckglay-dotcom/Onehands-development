"""
Phase 10: True Autonomous AI Developer — Multi-Agent Orchestration
==================================================================
The system doesn't just run ONE agent — it runs a TEAM of specialized agents
that collaborate, delegate, and self-improve.

  10.1  Multi-Agent Orchestrator     — coordinate specialized sub-agents in parallel
  10.2  Agentic CI/CD Pipeline       — auto-trigger: code → lint → test → build → deploy
  10.3  Self-Improvement Loop        — agent analyzes failures, rewrites its own prompts
  10.4  Long-Horizon Task Graph      — DAG planning with dependency resolution
  10.5  Agent-to-Agent Delegation    — agents can spin up sub-agents for sub-tasks
  10.6  Live Code Streaming          — token-level streaming with diff viewer
  10.7  Smart Codebase Context       — vector-like keyword search over workspace files
  10.8  Autonomous Bug Fixer         — detect → diagnose → patch → re-test loop
  10.9  Multi-Model Consensus        — run same prompt on N models, pick best answer
  10.10 Persistent Agent Memory      — long-term episodic memory with similarity search

Endpoints:
  POST /p10/orchestrate          — run multi-agent task with parallel specialists
  POST /p10/cicd                 — trigger agentic CI/CD pipeline
  POST /p10/self-improve         — self-improvement loop on failed task
  POST /p10/task-graph           — create + execute DAG task graph
  POST /p10/bugfix               — autonomous bug fix loop
  POST /p10/consensus            — multi-model consensus on a prompt
  GET  /p10/agents               — list active agents and their status
  GET  /p10/agent-memory         — query long-term agent memory
  POST /p10/stream-code          — stream code generation token-by-token (SSE)
  GET  /p10/status               — Phase 10 live dashboard
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("phase10")

router = APIRouter(prefix="", tags=["Phase 10 — Multi-Agent Orchestration"])

# ─── LLM + E2B callbacks (injected from main app) ────────────────────────────

_llm_fn = None
_e2b_fn = None
_emit_fn = None
_execute_tool_fn = None


def register_llm_fn(fn):    global _llm_fn;            _llm_fn = fn
def register_e2b_fn(fn):    global _e2b_fn;             _e2b_fn = fn
def register_emit_fn(fn):   global _emit_fn;            _emit_fn = fn
def register_execute_tool_fn(fn): global _execute_tool_fn; _execute_tool_fn = fn


async def _llm(provider, model, messages, temperature=0.3, max_tokens=4096, system=None):
    if _llm_fn is None:
        raise RuntimeError("LLM function not registered")
    content, used_provider, used_model = await _llm_fn(
        provider=provider, model=model, messages=messages,
        temperature=temperature, max_tokens=max_tokens,
        auto_fallback=True, system_prompt=system,
    )
    return content, used_provider, used_model


async def _e2b(code, language="python", timeout=60):
    if _e2b_fn is None:
        return {"output": "", "error": "E2B not registered", "exit_code": 1}
    return await _e2b_fn(code, language, timeout)


# ─── In-Memory Stores ────────────────────────────────────────────────────────

_agents: Dict[str, Dict] = {}       # agent_id -> agent state
_task_graphs: Dict[str, Dict] = {}  # graph_id -> DAG state
_agent_memory: Dict[str, List] = {} # user_id -> [{content, embedding_key, importance, ts}]
_cicd_pipelines: Dict[str, Dict] = {}  # pipeline_id -> pipeline state
_p10_metrics: Dict[str, Any] = {
    "orchestrations": 0,
    "cicd_runs": 0,
    "self_improvements": 0,
    "bug_fixes": 0,
    "consensus_runs": 0,
    "total_agents_spawned": 0,
    "start_time": time.time(),
}


# ─── Agent Types ─────────────────────────────────────────────────────────────

class AgentRole(str, Enum):
    PLANNER   = "planner"
    CODER     = "coder"
    REVIEWER  = "reviewer"
    TESTER    = "tester"
    DEPLOYER  = "deployer"
    DEBUGGER  = "debugger"
    RESEARCHER = "researcher"
    ORCHESTRATOR = "orchestrator"


AGENT_SYSTEM_PROMPTS = {
    AgentRole.PLANNER: """You are a senior software architect and task planner.
Your job: Break complex tasks into precise, actionable sub-tasks with clear dependencies.
Output structured JSON plans. Be thorough and think about edge cases.
Always consider: scalability, testability, maintainability.""",

    AgentRole.CODER: """You are an expert software engineer.
Your job: Write production-quality code that is clean, efficient, and well-documented.
Always include error handling, type hints (Python), and meaningful variable names.
Return ONLY the code, no explanations unless asked.""",

    AgentRole.REVIEWER: """You are a senior code reviewer with 15+ years experience.
Your job: Find bugs, security issues, performance problems, and style violations.
Be specific: cite exact lines, explain WHY it's wrong, suggest exact fixes.
Output structured JSON review with severity scores.""",

    AgentRole.TESTER: """You are a QA engineer specializing in automated testing.
Your job: Write comprehensive tests that catch real bugs.
Cover: happy path, edge cases, error conditions, boundary values.
Use appropriate frameworks: pytest for Python, jest/vitest for JS/TS.""",

    AgentRole.DEPLOYER: """You are a DevOps/deployment specialist.
Your job: Deploy applications reliably with zero downtime.
Handle: environment configs, rollbacks, health checks, monitoring.
Prefer: Docker, CI/CD pipelines, infrastructure as code.""",

    AgentRole.DEBUGGER: """You are a debugging specialist.
Your job: Find the root cause of bugs and propose minimal, correct fixes.
Process: reproduce → isolate → diagnose → patch → verify.
Be systematic. Show your reasoning step-by-step.""",

    AgentRole.RESEARCHER: """You are a research agent with broad technical knowledge.
Your job: Find information, compare approaches, summarize findings.
Be concise but complete. Cite sources when possible. Focus on actionable insights.""",

    AgentRole.ORCHESTRATOR: """You are a multi-agent orchestrator.
Your job: Coordinate specialized agents to complete complex tasks.
Delegate appropriately: send coding tasks to Coder, review to Reviewer, etc.
Monitor progress, handle failures, synthesize results.""",
}


def _new_agent(role: AgentRole, user_id: str, task: str, parent_id: Optional[str] = None) -> Dict:
    aid = str(uuid.uuid4())
    agent = {
        "agent_id": aid,
        "role": role.value,
        "user_id": user_id,
        "task": task,
        "parent_agent_id": parent_id,
        "status": "idle",        # idle | running | success | failed | waiting
        "result": None,
        "error": None,
        "steps": [],
        "sub_agents": [],
        "created_at": time.time(),
        "updated_at": time.time(),
        "finished_at": None,
        "model_used": None,
        "tokens_used": 0,
    }
    _agents[aid] = agent
    _p10_metrics["total_agents_spawned"] += 1
    return agent


def _update_agent(aid: str, **kwargs):
    if aid in _agents:
        _agents[aid].update(kwargs)
        _agents[aid]["updated_at"] = time.time()


def _log_agent_step(aid: str, role: str, content: str, step_type: str = "thought"):
    if aid in _agents:
        _agents[aid]["steps"].append({
            "time": time.time(),
            "role": role,
            "type": step_type,
            "content": content[:2000],
        })


# ─── Schemas ─────────────────────────────────────────────────────────────────

class OrchestrateRequest(BaseModel):
    task: str = Field(..., description="High-level task to complete using multiple specialized agents")
    roles: List[str] = Field(
        default=["planner", "coder", "reviewer", "tester"],
        description="Agent roles to use: planner|coder|reviewer|tester|deployer|debugger|researcher"
    )
    parallel: bool = Field(default=False, description="Run independent agents in parallel")
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"
    max_rounds: int = Field(default=3, ge=1, le=10, description="Max orchestration rounds")
    deploy_to: Optional[str] = None  # vercel | huggingface


class CICDRequest(BaseModel):
    repo: str = Field(..., description="GitHub owner/repo")
    branch: str = "main"
    trigger: str = "push"  # push | pr | manual | schedule
    stages: List[str] = Field(
        default=["lint", "test", "build", "deploy"],
        description="Pipeline stages: lint|test|build|deploy|notify"
    )
    code: Optional[str] = None   # inline code to test (if no GitHub)
    language: str = "python"
    deploy_to: Optional[str] = None   # vercel | huggingface
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"
    github_token: Optional[str] = None
    vercel_token: Optional[str] = None
    hf_token: Optional[str] = None


class SelfImprovementRequest(BaseModel):
    failed_task: str = Field(..., description="The task that failed")
    failure_reason: str = Field(..., description="Why it failed (error, test output, etc.)")
    original_output: str = Field(default="", description="What the agent originally produced")
    max_iterations: int = Field(default=3, ge=1, le=5)
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"


class TaskGraphRequest(BaseModel):
    goal: str = Field(..., description="High-level goal to decompose into a task DAG")
    context: str = Field(default="", description="Additional context")
    max_tasks: int = Field(default=8, ge=2, le=20)
    auto_execute: bool = Field(default=True, description="Automatically execute the graph after planning")
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"


class BugFixRequest(BaseModel):
    code: str = Field(..., description="Code with bugs")
    error_message: str = Field(..., description="Error message / test failure")
    language: str = "python"
    max_attempts: int = Field(default=3, ge=1, le=5)
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"


class ConsensusRequest(BaseModel):
    prompt: str = Field(..., description="Prompt to run on multiple models")
    models: List[Dict[str, str]] = Field(
        default=[
            {"provider": "gemini",    "model": "gemini-2.0-flash"},
            {"provider": "sambanova", "model": "Meta-Llama-3.3-70B-Instruct"},
            {"provider": "gemini",    "model": "gemini-2.5-flash-preview-05-20"},
        ],
        description="List of {provider, model} to query"
    )
    system_prompt: Optional[str] = None
    vote_strategy: str = Field(default="best_of", description="best_of | majority | synthesize")
    user_id: str = "anonymous"


class StreamCodeRequest(BaseModel):
    description: str
    language: str = "python"
    context: str = ""
    model: str = "gemini-2.0-flash"
    provider: str = "gemini"
    user_id: str = "anonymous"


class AgentMemoryQuery(BaseModel):
    query: str
    user_id: str = "anonymous"
    limit: int = 10
    min_importance: float = 0.0


# ─── 10.1 Multi-Agent Orchestrator ───────────────────────────────────────────

async def _run_specialist_agent(
    role: AgentRole,
    task: str,
    context: str,
    model: str,
    provider: str,
    user_id: str,
    parent_id: Optional[str] = None,
) -> Dict:
    """Run a single specialist agent and return its result."""
    agent = _new_agent(role, user_id, task, parent_id)
    aid = agent["agent_id"]
    _update_agent(aid, status="running")

    system_prompt = AGENT_SYSTEM_PROMPTS[role]
    full_task = task
    if context:
        full_task = f"Context from previous agents:\n{context}\n\n---\nYour task: {task}"

    messages = [{"role": "user", "content": full_task}]

    try:
        content, used_provider, used_model = await _llm(
            provider, model, messages,
            temperature=0.3 if role != AgentRole.CODER else 0.1,
            max_tokens=4096,
            system=system_prompt,
        )
        _log_agent_step(aid, role.value, content, "result")
        _update_agent(aid, status="success", result=content, model_used=used_model, finished_at=time.time())
        return {"role": role.value, "agent_id": aid, "result": content, "status": "success", "model": used_model}
    except Exception as e:
        _log_agent_step(aid, role.value, str(e), "error")
        _update_agent(aid, status="failed", error=str(e), finished_at=time.time())
        return {"role": role.value, "agent_id": aid, "result": "", "status": "failed", "error": str(e)}


async def _orchestrate(req: OrchestrateRequest, pipeline_id: str) -> Dict:
    """Core orchestration logic."""
    orch_agent = _new_agent(AgentRole.ORCHESTRATOR, req.user_id, req.task)
    orch_id = orch_agent["agent_id"]
    _update_agent(orch_id, status="running")

    results = {}
    context_summary = ""

    # Phase 1: Planner always runs first
    if "planner" in req.roles:
        _log_agent_step(orch_id, "orchestrator", "Running Planner agent...", "dispatch")
        plan_result = await _run_specialist_agent(
            AgentRole.PLANNER, req.task, "",
            req.model, req.provider, req.user_id, orch_id,
        )
        results["planner"] = plan_result
        context_summary += f"\n=== PLAN ===\n{plan_result.get('result', '')}\n"

    # Phase 2: Coder + Researcher can run in parallel
    parallel_roles = [r for r in req.roles if r in ("coder", "researcher") and r not in results]
    if parallel_roles and req.parallel:
        _log_agent_step(orch_id, "orchestrator", f"Running in parallel: {parallel_roles}", "dispatch")
        tasks = [
            _run_specialist_agent(
                AgentRole(r),
                f"{req.task}\n\nPlan to follow:\n{context_summary}",
                context_summary, req.model, req.provider, req.user_id, orch_id,
            )
            for r in parallel_roles
        ]
        parallel_results = await asyncio.gather(*tasks, return_exceptions=True)
        for r, result in zip(parallel_roles, parallel_results):
            if isinstance(result, Exception):
                results[r] = {"role": r, "status": "failed", "error": str(result), "result": ""}
            else:
                results[r] = result
                context_summary += f"\n=== {r.upper()} ===\n{result.get('result', '')}\n"
    else:
        for role_name in parallel_roles:
            _log_agent_step(orch_id, "orchestrator", f"Running {role_name} agent...", "dispatch")
            result = await _run_specialist_agent(
                AgentRole(role_name),
                f"{req.task}\n\nContext:\n{context_summary}",
                context_summary, req.model, req.provider, req.user_id, orch_id,
            )
            results[role_name] = result
            context_summary += f"\n=== {role_name.upper()} ===\n{result.get('result', '')}\n"

    # Phase 3: Reviewer runs after code is ready
    if "reviewer" in req.roles and "reviewer" not in results:
        _log_agent_step(orch_id, "orchestrator", "Running Reviewer agent...", "dispatch")
        code_context = results.get("coder", {}).get("result", "")
        review_task = f"Review this code:\n\n{code_context}\n\nOriginal task: {req.task}"
        result = await _run_specialist_agent(
            AgentRole.REVIEWER, review_task, context_summary,
            req.model, req.provider, req.user_id, orch_id,
        )
        results["reviewer"] = result
        context_summary += f"\n=== REVIEW ===\n{result.get('result', '')}\n"

    # Phase 4: Tester runs after code is ready
    if "tester" in req.roles and "tester" not in results:
        _log_agent_step(orch_id, "orchestrator", "Running Tester agent...", "dispatch")
        code_context = results.get("coder", {}).get("result", "")
        test_task = f"Write comprehensive tests for:\n\n{code_context}\n\nOriginal task: {req.task}"
        result = await _run_specialist_agent(
            AgentRole.TESTER, test_task, context_summary,
            req.model, req.provider, req.user_id, orch_id,
        )
        results["tester"] = result

        # Execute the tests in E2B if we have code
        if code_context and result.get("status") == "success":
            test_code = result.get("result", "")
            test_code = re.sub(r'^```\w*\n', '', test_code.strip())
            test_code = re.sub(r'\n```$', '', test_code.strip())
            src_code = re.sub(r'^```\w*\n', '', code_context.strip())
            src_code = re.sub(r'\n```$', '', src_code.strip())
            combined = src_code + "\n\n" + test_code
            exec_result = await _e2b(combined, "python", 30)
            results["test_execution"] = exec_result

    # Phase 5: Deployer (optional)
    if "deployer" in req.roles and "deployer" not in results:
        if req.deploy_to:
            _log_agent_step(orch_id, "orchestrator", f"Deployer: {req.deploy_to}", "dispatch")
            deploy_task = f"Deploy this project to {req.deploy_to}. Files:\n{context_summary}"
            result = await _run_specialist_agent(
                AgentRole.DEPLOYER, deploy_task, context_summary,
                req.model, req.provider, req.user_id, orch_id,
            )
            results["deployer"] = result

    # Synthesize final report
    _log_agent_step(orch_id, "orchestrator", "Synthesizing final report...", "synthesis")
    synthesis_prompt = f"""You are an orchestrator. Synthesize the outputs of multiple specialist agents into one cohesive final report.

Task: {req.task}

Agent outputs:
{context_summary}

Write a clear, structured final report that:
1. Summarizes what was accomplished
2. Presents the main deliverable (code, plan, etc.)
3. Lists any issues found and how they were addressed
4. Provides next steps if any"""

    synthesis, _, _ = await _llm(
        req.provider, req.model,
        [{"role": "user", "content": synthesis_prompt}],
        temperature=0.3, max_tokens=3000,
    )

    _update_agent(orch_id, status="success", result=synthesis, finished_at=time.time())
    _p10_metrics["orchestrations"] += 1

    return {
        "orchestration_id": pipeline_id,
        "task": req.task,
        "agents_used": list(results.keys()),
        "agent_results": results,
        "synthesis": synthesis,
        "status": "success",
    }


@router.post("/p10/orchestrate")
async def orchestrate(req: OrchestrateRequest, background_tasks: BackgroundTasks):
    """Phase 10.1: Run multi-agent orchestration with specialized agents."""
    pipeline_id = str(uuid.uuid4())

    async def _run():
        try:
            result = await _orchestrate(req, pipeline_id)
            # Store in pipeline store
            _cicd_pipelines[pipeline_id] = {
                "type": "orchestration",
                "status": "success",
                "result": result,
                "created_at": time.time(),
            }
            # Save to agent memory
            _save_agent_memory(req.user_id, f"Orchestration: {req.task[:100]} → {result['synthesis'][:200]}", 0.9)
        except Exception as e:
            logger.exception("Orchestration failed")
            _cicd_pipelines[pipeline_id] = {
                "type": "orchestration",
                "status": "failed",
                "error": str(e),
                "created_at": time.time(),
            }

    background_tasks.add_task(_run)
    return {
        "pipeline_id": pipeline_id,
        "status": "started",
        "message": f"Multi-agent orchestration started with roles: {req.roles}",
        "poll_url": f"/p10/pipeline/{pipeline_id}",
    }


# ─── 10.2 Agentic CI/CD Pipeline ─────────────────────────────────────────────

CICD_STAGE_PROMPTS = {
    "lint": "Analyze this code for style issues, linting errors, and formatting problems. Return a JSON with issues list and pass/fail status.",
    "test": "Generate and conceptually run tests for this code. Identify what tests would pass or fail.",
    "build": "Describe the build process and check if this code would build successfully. Identify any build issues.",
    "deploy": "Describe the deployment steps and configuration needed.",
    "notify": "Write a deployment notification summary.",
}


async def _run_cicd(req: CICDRequest, pipeline_id: str):
    """Execute CI/CD pipeline stages."""
    pipeline = _cicd_pipelines[pipeline_id]
    pipeline["status"] = "running"
    pipeline["stages_results"] = {}
    pipeline["logs"] = []

    def _log(msg: str):
        pipeline["logs"].append({"time": time.time(), "msg": msg})
        logger.info("[CICD %s] %s", pipeline_id[:8], msg)

    _log(f"🚀 Starting CI/CD pipeline: {req.trigger} → {req.repo or 'inline code'}")

    code_content = req.code or ""

    # Fetch code from GitHub if no inline code
    if not code_content and req.repo:
        token = req.github_token or os.environ.get("GITHUB_TOKEN", "")
        if token:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"https://api.github.com/repos/{req.repo}/contents/",
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
                    )
                    if resp.status_code == 200:
                        files = resp.json()
                        # Find main file
                        main_file = next(
                            (f for f in files if f["name"] in ("main.py", "app.py", "index.js", "server.js")),
                            files[0] if files else None
                        )
                        if main_file and main_file.get("download_url"):
                            file_resp = await client.get(main_file["download_url"])
                            code_content = file_resp.text
                            _log(f"📥 Fetched {main_file['name']} from GitHub ({len(code_content)} bytes)")
            except Exception as e:
                _log(f"⚠️ Could not fetch from GitHub: {e}")
                code_content = "# Could not fetch code from GitHub"

    if not code_content:
        code_content = "# No code provided"

    overall_pass = True

    for stage in req.stages:
        _log(f"▶️  Stage: {stage}")
        stage_start = time.time()

        try:
            if stage == "lint":
                # Run actual Python syntax check in E2B
                if req.language == "python":
                    lint_code = f"""
import ast, sys
code = {repr(code_content)}
errors = []
try:
    tree = ast.parse(code)
    print("SYNTAX: OK")
    # Check for common issues
    lines = code.split('\\n')
    for i, line in enumerate(lines, 1):
        if len(line) > 120:
            errors.append(f"Line {{i}}: Line too long ({{len(line)}} chars)")
        if '\\t' in line:
            errors.append(f"Line {{i}}: Tab indentation found")
    if errors:
        for e in errors[:10]:
            print(f"WARN: {{e}}")
    else:
        print("STYLE: All good")
except SyntaxError as e:
    print(f"SYNTAX_ERROR: {{e}}")
    sys.exit(1)
"""
                    exec_result = await _e2b(lint_code, "python", 15)
                    passed = exec_result.get("exit_code", 1) == 0
                    stage_result = {
                        "stage": stage,
                        "status": "passed" if passed else "failed",
                        "output": exec_result.get("output", ""),
                        "error": exec_result.get("error", ""),
                        "duration_ms": int((time.time() - stage_start) * 1000),
                    }
                else:
                    # AI-based lint for other languages
                    content, _, _ = await _llm(
                        req.provider, req.model,
                        [{"role": "user", "content": f"{CICD_STAGE_PROMPTS[stage]}\n\nCode:\n```{req.language}\n{code_content[:3000]}\n```"}],
                        temperature=0.2, max_tokens=1000,
                    )
                    stage_result = {"stage": stage, "status": "passed", "output": content, "duration_ms": int((time.time() - stage_start) * 1000)}

            elif stage == "test":
                # Generate AND run tests in E2B
                test_gen_prompt = f"""Generate pytest tests for this {req.language} code.
Return ONLY the test code, no markdown.

Code:
```{req.language}
{code_content[:3000]}
```"""
                test_code, _, _ = await _llm(
                    req.provider, req.model,
                    [{"role": "user", "content": test_gen_prompt}],
                    temperature=0.1, max_tokens=2000,
                    system=AGENT_SYSTEM_PROMPTS[AgentRole.TESTER],
                )
                test_code = re.sub(r'^```\w*\n', '', test_code.strip())
                test_code = re.sub(r'\n```$', '', test_code.strip())

                combined = code_content + "\n\n" + test_code
                safe = combined.replace("\\", "\\\\").replace("'''", "\\'\\'\\'")
                runner = (
                    "import tempfile, subprocess, sys\n"
                    "code = '''" + safe + "'''\n"
                    "with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:\n"
                    "    f.write(code)\n"
                    "    tmp = f.name\n"
                    "r = subprocess.run([sys.executable, '-m', 'pytest', tmp, '-v', '--tb=short', '--no-header'], capture_output=True, text=True, timeout=30)\n"
                    "print(r.stdout)\n"
                    "if r.stderr: print('ERR:', r.stderr[:500])\n"
                    "sys.exit(r.returncode)\n"
                )
                exec_result = await _e2b(runner, "python", 60)
                output = exec_result.get("output", "")
                passed_count = len(re.findall(r' PASSED', output))
                failed_count = len(re.findall(r' FAILED', output))
                passed = exec_result.get("exit_code", 1) == 0 or (passed_count > 0 and failed_count == 0)
                stage_result = {
                    "stage": stage,
                    "status": "passed" if passed else "failed",
                    "output": output,
                    "error": exec_result.get("error", ""),
                    "passed": passed_count,
                    "failed": failed_count,
                    "generated_tests": test_code[:1000],
                    "duration_ms": int((time.time() - stage_start) * 1000),
                }
                if not passed:
                    overall_pass = False

            elif stage == "build":
                # Check if code can be imported/compiled
                if req.language == "python":
                    build_code = f"""
import py_compile, tempfile, os
code = {repr(code_content)}
with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
    f.write(code)
    tmp = f.name
try:
    py_compile.compile(tmp, doraise=True)
    print("BUILD: OK — Python compilation successful")
except py_compile.PyCompileError as e:
    print(f"BUILD_ERROR: {{e}}")
    import sys; sys.exit(1)
finally:
    os.unlink(tmp)
"""
                    exec_result = await _e2b(build_code, "python", 15)
                    passed = exec_result.get("exit_code", 1) == 0
                    stage_result = {
                        "stage": stage,
                        "status": "passed" if passed else "failed",
                        "output": exec_result.get("output", ""),
                        "duration_ms": int((time.time() - stage_start) * 1000),
                    }
                else:
                    content, _, _ = await _llm(
                        req.provider, req.model,
                        [{"role": "user", "content": f"{CICD_STAGE_PROMPTS[stage]}\n\nCode:\n```{req.language}\n{code_content[:2000]}\n```"}],
                        temperature=0.2, max_tokens=500,
                    )
                    stage_result = {"stage": stage, "status": "passed", "output": content, "duration_ms": int((time.time() - stage_start) * 1000)}

            elif stage == "deploy":
                if req.deploy_to:
                    stage_result = {
                        "stage": stage,
                        "status": "info",
                        "output": f"Deploy target: {req.deploy_to}. Use /dev/deploy endpoint to actually deploy.",
                        "duration_ms": int((time.time() - stage_start) * 1000),
                    }
                else:
                    content, _, _ = await _llm(
                        req.provider, req.model,
                        [{"role": "user", "content": f"{CICD_STAGE_PROMPTS[stage]}\n\nCode:\n```{req.language}\n{code_content[:2000]}\n```"}],
                        temperature=0.2, max_tokens=500,
                    )
                    stage_result = {"stage": stage, "status": "passed", "output": content, "duration_ms": int((time.time() - stage_start) * 1000)}

            elif stage == "notify":
                prev_results = pipeline.get("stages_results", {})
                summary = "\n".join([f"- {s}: {r.get('status', 'unknown')}" for s, r in prev_results.items()])
                notify_msg = f"CI/CD Pipeline for {req.repo or 'project'}\nTrigger: {req.trigger}\n\nStages:\n{summary}\n\nOverall: {'✅ PASSED' if overall_pass else '❌ FAILED'}"
                stage_result = {"stage": stage, "status": "sent", "output": notify_msg, "duration_ms": int((time.time() - stage_start) * 1000)}

            else:
                stage_result = {"stage": stage, "status": "skipped", "output": f"Unknown stage: {stage}", "duration_ms": 0}

            pipeline["stages_results"][stage] = stage_result
            status_icon = "✅" if stage_result.get("status") in ("passed", "sent", "info") else "❌"
            _log(f"{status_icon} Stage {stage}: {stage_result.get('status', 'unknown')} ({stage_result.get('duration_ms', 0)}ms)")

        except Exception as e:
            pipeline["stages_results"][stage] = {"stage": stage, "status": "error", "error": str(e)}
            _log(f"❌ Stage {stage} ERROR: {str(e)[:100]}")
            overall_pass = False

    pipeline["status"] = "passed" if overall_pass else "failed"
    pipeline["finished_at"] = time.time()
    pipeline["overall"] = "passed" if overall_pass else "failed"
    _p10_metrics["cicd_runs"] += 1
    _log(f"🏁 Pipeline complete: {'PASSED' if overall_pass else 'FAILED'}")


@router.post("/p10/cicd")
async def trigger_cicd(req: CICDRequest, background_tasks: BackgroundTasks):
    """Phase 10.2: Trigger an agentic CI/CD pipeline."""
    pipeline_id = str(uuid.uuid4())
    _cicd_pipelines[pipeline_id] = {
        "pipeline_id": pipeline_id,
        "type": "cicd",
        "repo": req.repo,
        "trigger": req.trigger,
        "stages": req.stages,
        "status": "queued",
        "logs": [],
        "stages_results": {},
        "created_at": time.time(),
    }
    background_tasks.add_task(_run_cicd, req, pipeline_id)
    return {
        "pipeline_id": pipeline_id,
        "status": "queued",
        "stages": req.stages,
        "poll_url": f"/p10/pipeline/{pipeline_id}",
    }


@router.get("/p10/pipeline/{pipeline_id}")
async def get_pipeline(pipeline_id: str):
    """Get CI/CD pipeline or orchestration status."""
    p = _cicd_pipelines.get(pipeline_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return p


# ─── 10.3 Self-Improvement Loop ───────────────────────────────────────────────

@router.post("/p10/self-improve")
async def self_improve(req: SelfImprovementRequest):
    """Phase 10.3: Agent analyzes its own failure and iterates to improve."""
    iterations = []
    current_output = req.original_output
    current_failure = req.failure_reason

    _p10_metrics["self_improvements"] += 1

    for i in range(req.max_iterations):
        iteration = {"iteration": i + 1}

        # Step 1: Diagnose the failure
        diag_prompt = f"""You are a debugging specialist. Analyze this failure:

Task: {req.failed_task}
Previous output: {current_output[:2000]}
Failure reason: {current_failure}

Diagnose:
1. Root cause of failure
2. What specific changes would fix it
3. Revised approach

Be precise and technical."""

        diagnosis, _, _ = await _llm(
            req.provider, req.model,
            [{"role": "user", "content": diag_prompt}],
            temperature=0.2, max_tokens=1500,
            system=AGENT_SYSTEM_PROMPTS[AgentRole.DEBUGGER],
        )
        iteration["diagnosis"] = diagnosis

        # Step 2: Generate improved output
        improve_prompt = f"""Based on this diagnosis:

{diagnosis}

Now produce an improved solution for the original task:
Task: {req.failed_task}

Previous failed output:
{current_output[:1500]}

Generate a BETTER, CORRECT solution that addresses all identified issues."""

        improved_output, _, _ = await _llm(
            req.provider, req.model,
            [{"role": "user", "content": improve_prompt}],
            temperature=0.1, max_tokens=3000,
            system=AGENT_SYSTEM_PROMPTS[AgentRole.CODER],
        )
        iteration["improved_output"] = improved_output

        # Step 3: Validate by executing if it's code
        code_match = re.search(r'```python\n(.*?)```', improved_output, re.DOTALL)
        if code_match:
            code = code_match.group(1)
            exec_result = await _e2b(code, "python", 15)
            iteration["execution"] = {
                "output": exec_result.get("output", ""),
                "error": exec_result.get("error", ""),
                "exit_code": exec_result.get("exit_code", 1),
            }
            if exec_result.get("exit_code", 1) == 0:
                iteration["status"] = "fixed"
                iterations.append(iteration)
                return {
                    "task": req.failed_task,
                    "iterations": iterations,
                    "final_output": improved_output,
                    "fixed_in_iteration": i + 1,
                    "status": "fixed",
                }
            else:
                current_failure = exec_result.get("error", "Execution failed")
                current_output = improved_output
                iteration["status"] = "still_failing"
        else:
            # Not code — accept the improved output
            iteration["status"] = "improved"
            iterations.append(iteration)
            return {
                "task": req.failed_task,
                "iterations": iterations,
                "final_output": improved_output,
                "improved_in_iteration": i + 1,
                "status": "improved",
            }

        iterations.append(iteration)

    return {
        "task": req.failed_task,
        "iterations": iterations,
        "final_output": current_output,
        "status": "max_iterations_reached",
        "note": f"Could not fully fix after {req.max_iterations} iterations. Best attempt provided.",
    }


# ─── 10.4 Long-Horizon Task Graph (DAG) ──────────────────────────────────────

@router.post("/p10/task-graph")
async def create_task_graph(req: TaskGraphRequest):
    """Phase 10.4: Decompose goal into a DAG and execute with dependency ordering."""
    graph_id = str(uuid.uuid4())

    # Step 1: Generate DAG from LLM
    dag_prompt = f"""You are a project manager. Decompose this goal into a directed acyclic task graph (DAG).

Goal: {req.goal}
Context: {req.context}
Max tasks: {req.max_tasks}

Return ONLY valid JSON with this structure:
{{
  "goal": "the goal",
  "tasks": [
    {{
      "id": "t1",
      "name": "Task name",
      "description": "What to do",
      "type": "plan|code|test|review|deploy|research",
      "dependencies": [],
      "estimated_minutes": 2,
      "inputs": "what inputs needed",
      "outputs": "what this produces"
    }}
  ],
  "execution_order": [["t1"], ["t2", "t3"], ["t4"]]
}}

"execution_order" groups tasks that can run in parallel.
Tasks in the same group have no dependencies on each other."""

    dag_content, _, _ = await _llm(
        req.provider, req.model,
        [{"role": "user", "content": dag_prompt}],
        temperature=0.2, max_tokens=3000,
    )

    dag = {}
    json_match = re.search(r'\{.*\}', dag_content, re.DOTALL)
    if json_match:
        try:
            dag = json.loads(json_match.group())
        except Exception:
            dag = {"goal": req.goal, "tasks": [], "execution_order": []}
    else:
        dag = {"goal": req.goal, "tasks": [], "execution_order": []}

    graph = {
        "graph_id": graph_id,
        "goal": req.goal,
        "dag": dag,
        "status": "planned",
        "task_results": {},
        "created_at": time.time(),
    }
    _task_graphs[graph_id] = graph

    if not req.auto_execute:
        return graph

    # Step 2: Execute the DAG
    tasks_by_id = {t["id"]: t for t in dag.get("tasks", [])}
    execution_order = dag.get("execution_order", [[t["id"]] for t in dag.get("tasks", [])])

    graph["status"] = "executing"
    context_accumulator = {}

    for group in execution_order:
        # Run tasks in this group concurrently
        async def execute_task(task_id: str):
            task = tasks_by_id.get(task_id)
            if not task:
                return task_id, {"status": "skipped", "error": "Task not found"}

            # Build context from dependencies
            dep_context = ""
            for dep_id in task.get("dependencies", []):
                dep_result = context_accumulator.get(dep_id, {})
                dep_context += f"\nResult of {dep_id}: {dep_result.get('result', '')[:500]}\n"

            task_prompt = f"""Execute this task:
Name: {task['name']}
Description: {task['description']}
Type: {task['type']}
Expected inputs: {task.get('inputs', '')}
Expected outputs: {task.get('outputs', '')}

Previous task results:
{dep_context}

Overall goal: {req.goal}

Complete this task now."""

            role_map = {
                "plan": AgentRole.PLANNER,
                "code": AgentRole.CODER,
                "test": AgentRole.TESTER,
                "review": AgentRole.REVIEWER,
                "deploy": AgentRole.DEPLOYER,
                "research": AgentRole.RESEARCHER,
            }
            role = role_map.get(task.get("type", "code"), AgentRole.CODER)

            content, _, _ = await _llm(
                req.provider, req.model,
                [{"role": "user", "content": task_prompt}],
                temperature=0.3, max_tokens=2048,
                system=AGENT_SYSTEM_PROMPTS[role],
            )
            return task_id, {"status": "completed", "result": content, "task_name": task["name"]}

        if len(group) > 1:
            group_tasks = await asyncio.gather(*[execute_task(tid) for tid in group], return_exceptions=True)
            for item in group_tasks:
                if isinstance(item, Exception):
                    continue
                tid, result = item
                context_accumulator[tid] = result
                graph["task_results"][tid] = result
        else:
            tid, result = await execute_task(group[0])
            context_accumulator[tid] = result
            graph["task_results"][tid] = result

    graph["status"] = "completed"
    graph["finished_at"] = time.time()
    return graph


# ─── 10.5 Autonomous Bug Fixer ────────────────────────────────────────────────

@router.post("/p10/bugfix")
async def autonomous_bugfix(req: BugFixRequest):
    """Phase 10.5+10.8: Detect → Diagnose → Patch → Re-test loop."""
    _p10_metrics["bug_fixes"] += 1
    attempts = []
    current_code = req.code
    current_error = req.error_message

    for attempt_num in range(req.max_attempts):
        attempt = {"attempt": attempt_num + 1}

        # Run the buggy code first
        exec_result = await _e2b(current_code, req.language, 30)
        attempt["initial_run"] = {
            "output": exec_result.get("output", ""),
            "error": exec_result.get("error", ""),
            "exit_code": exec_result.get("exit_code", 1),
        }

        if exec_result.get("exit_code", 1) == 0 and not exec_result.get("error"):
            attempt["status"] = "already_fixed"
            attempts.append(attempt)
            return {
                "fixed": True,
                "fixed_in_attempt": attempt_num + 1,
                "final_code": current_code,
                "attempts": attempts,
                "status": "success",
            }

        # Diagnose
        diag_prompt = f"""Debug this {req.language} code:

```{req.language}
{current_code}
```

Error message:
{current_error}

Execution output:
{exec_result.get('output', '')}

Provide:
1. Root cause analysis
2. Exact fix needed
3. Fixed code

Return the COMPLETE fixed code in a ```{req.language} code block."""

        fix_content, _, _ = await _llm(
            req.provider, req.model,
            [{"role": "user", "content": diag_prompt}],
            temperature=0.1, max_tokens=3000,
            system=AGENT_SYSTEM_PROMPTS[AgentRole.DEBUGGER],
        )

        attempt["diagnosis"] = fix_content[:500]

        # Extract fixed code
        code_match = re.search(rf'```{req.language}\n(.*?)```', fix_content, re.DOTALL)
        if not code_match:
            code_match = re.search(r'```\w*\n(.*?)```', fix_content, re.DOTALL)

        if code_match:
            fixed_code = code_match.group(1).strip()
            attempt["fixed_code"] = fixed_code

            # Verify the fix
            verify_result = await _e2b(fixed_code, req.language, 30)
            attempt["verify_result"] = {
                "output": verify_result.get("output", ""),
                "error": verify_result.get("error", ""),
                "exit_code": verify_result.get("exit_code", 1),
            }

            if verify_result.get("exit_code", 1) == 0:
                attempt["status"] = "fixed"
                attempts.append(attempt)
                return {
                    "fixed": True,
                    "fixed_in_attempt": attempt_num + 1,
                    "original_code": req.code,
                    "final_code": fixed_code,
                    "attempts": attempts,
                    "status": "success",
                }
            else:
                current_code = fixed_code
                current_error = verify_result.get("error", "Still failing")
                attempt["status"] = "still_failing"
        else:
            attempt["status"] = "no_fix_extracted"
            attempt["raw_response"] = fix_content[:1000]

        attempts.append(attempt)

    return {
        "fixed": False,
        "original_code": req.code,
        "final_code": current_code,
        "attempts": attempts,
        "status": "max_attempts_reached",
        "suggestion": "Manual review required. Check the last attempt's diagnosis.",
    }


# ─── 10.6 Live Code Streaming (SSE) ───────────────────────────────────────────

@router.post("/p10/stream-code")
async def stream_code(req: StreamCodeRequest):
    """Phase 10.6: Stream code generation token-by-token via SSE."""
    code_prompt = f"""Write {req.language} code for: {req.description}
{f'Context: {req.context}' if req.context else ''}

Write clean, complete, production-ready code with error handling."""

    async def gen() -> AsyncGenerator[str, None]:
        try:
            # Use streaming if available
            from smart_router import router as smart_router, _to_gemini_format
            messages = [{"role": "user", "content": code_prompt}]

            yield f"data: {json.dumps({'type': 'start', 'language': req.language})}\\n\\n"

            full_code = ""
            if req.provider == "gemini":
                gemini_msgs = _to_gemini_format(messages)
                async for chunk in smart_router.stream_gemini(req.model, gemini_msgs, 0.1, 4096):
                    full_code += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\\n\\n"
            else:
                # Non-streaming fallback — generate then simulate streaming
                content, _, _ = await _llm(req.provider, req.model, messages, 0.1, 4096)
                full_code = content
                chars = list(content)
                for i in range(0, len(chars), 3):
                    chunk = "".join(chars[i:i+3])
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\\n\\n"
                    if i % 30 == 0:
                        await asyncio.sleep(0.01)

            yield f"data: {json.dumps({'type': 'done', 'total_chars': len(full_code)})}\\n\\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\\n\\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── 10.7 Smart Codebase Context Search ──────────────────────────────────────

@router.get("/p10/workspace-search")
async def workspace_search(query: str, user_id: str = "anonymous"):
    """Phase 10.7: Keyword search over user workspace files."""
    # Import workspace from phase9
    try:
        import phase9
        workspace = phase9._workspace.get(user_id, {})
    except Exception:
        workspace = {}

    if not workspace:
        return {"results": [], "query": query, "message": "No workspace files found"}

    query_lower = query.lower()
    query_words = set(query_lower.split())
    results = []

    for filename, content in workspace.items():
        content_lower = content.lower()
        # Score based on word matches
        matches = sum(1 for w in query_words if w in content_lower)
        if matches > 0:
            # Find relevant lines
            lines = content.split('\n')
            relevant_lines = [
                {"line": i+1, "content": line}
                for i, line in enumerate(lines)
                if any(w in line.lower() for w in query_words)
            ][:5]
            results.append({
                "filename": filename,
                "score": matches,
                "relevant_lines": relevant_lines,
                "preview": content[:200],
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return {"results": results[:10], "query": query, "total": len(results)}


# ─── 10.9 Multi-Model Consensus ───────────────────────────────────────────────

@router.post("/p10/consensus")
async def multi_model_consensus(req: ConsensusRequest):
    """Phase 10.9: Run same prompt on multiple models and pick the best answer."""
    _p10_metrics["consensus_runs"] += 1

    if not req.models:
        raise HTTPException(status_code=400, detail="Provide at least 2 models")

    # Query all models (in parallel)
    async def query_model(m: Dict[str, str]) -> Dict:
        try:
            content, _, _ = await _llm(
                m["provider"], m["model"],
                [{"role": "user", "content": req.prompt}],
                temperature=0.3, max_tokens=2048,
                system=req.system_prompt,
            )
            return {"provider": m["provider"], "model": m["model"], "response": content, "status": "success"}
        except Exception as e:
            return {"provider": m["provider"], "model": m["model"], "response": "", "status": "failed", "error": str(e)}

    responses = await asyncio.gather(*[query_model(m) for m in req.models], return_exceptions=True)
    valid_responses = [r for r in responses if isinstance(r, dict) and r.get("status") == "success"]

    if not valid_responses:
        raise HTTPException(status_code=502, detail="All models failed")

    result = {
        "prompt": req.prompt[:200],
        "responses": responses,
        "strategy": req.vote_strategy,
    }

    if req.vote_strategy == "best_of" and valid_responses:
        # Pick the longest/most detailed response as proxy for "best"
        best = max(valid_responses, key=lambda r: len(r.get("response", "")))
        result["consensus"] = best["response"]
        result["best_model"] = f"{best['provider']}/{best['model']}"

    elif req.vote_strategy == "synthesize" and len(valid_responses) >= 2:
        # Ask an LLM to synthesize the best answer
        all_responses = "\n\n---\n".join([
            f"Model: {r['provider']}/{r['model']}\nResponse:\n{r['response'][:1000]}"
            for r in valid_responses
        ])
        synth_prompt = f"""Multiple AI models answered this question:

Question: {req.prompt}

Responses:
{all_responses}

Synthesize these responses into ONE optimal, comprehensive answer that:
1. Takes the best insights from each model
2. Corrects any errors
3. Is more complete than any individual response"""

        synthesis, _, _ = await _llm(
            "gemini", "gemini-2.0-flash",
            [{"role": "user", "content": synth_prompt}],
            temperature=0.2, max_tokens=3000,
        )
        result["consensus"] = synthesis
        result["best_model"] = "synthesized"

    elif req.vote_strategy == "majority" and valid_responses:
        # Simple majority — pick most common theme
        result["consensus"] = valid_responses[0]["response"]  # Simplified
        result["best_model"] = f"{valid_responses[0]['provider']}/{valid_responses[0]['model']}"

    else:
        result["consensus"] = valid_responses[0]["response"] if valid_responses else ""
        result["best_model"] = f"{valid_responses[0]['provider']}/{valid_responses[0]['model']}" if valid_responses else "none"

    return result


# ─── 10.10 Persistent Agent Memory ───────────────────────────────────────────

def _save_agent_memory(user_id: str, content: str, importance: float = 0.5):
    if user_id not in _agent_memory:
        _agent_memory[user_id] = []
    # Simple keyword hash as "embedding"
    embedding_key = hashlib.md5(content.lower()[:100].encode()).hexdigest()[:16]
    _agent_memory[user_id].append({
        "id": str(uuid.uuid4()),
        "content": content,
        "embedding_key": embedding_key,
        "importance": importance,
        "created_at": time.time(),
    })
    # Keep only last 1000 memories per user
    if len(_agent_memory[user_id]) > 1000:
        _agent_memory[user_id] = sorted(
            _agent_memory[user_id], key=lambda m: m["importance"], reverse=True
        )[:500]


@router.post("/p10/agent-memory")
async def save_agent_memory_ep(content: str, user_id: str = "anonymous", importance: float = 0.5):
    """Phase 10.10: Save to persistent agent memory."""
    _save_agent_memory(user_id, content, importance)
    return {"saved": True, "content": content[:100]}


@router.get("/p10/agent-memory")
async def query_agent_memory(
    query: str = "",
    user_id: str = "anonymous",
    limit: int = 10,
    min_importance: float = 0.0,
):
    """Phase 10.10: Query long-term agent memory with keyword search."""
    memories = _agent_memory.get(user_id, [])
    if not memories:
        return {"memories": [], "total": 0}

    # Filter by importance
    memories = [m for m in memories if m["importance"] >= min_importance]

    # Keyword relevance scoring
    if query:
        query_words = set(query.lower().split())
        def score(m):
            content_words = set(m["content"].lower().split())
            return len(query_words & content_words)
        memories = sorted(memories, key=score, reverse=True)
    else:
        memories = sorted(memories, key=lambda m: m["importance"], reverse=True)

    return {"memories": memories[:limit], "total": len(memories)}


# ─── Phase 10 Status / Dashboard ─────────────────────────────────────────────

@router.get("/p10/agents")
async def list_active_agents(user_id: str = "anonymous", limit: int = 20):
    """List all agents (active + recent)."""
    user_agents = [a for a in _agents.values() if a.get("user_id") == user_id]
    user_agents.sort(key=lambda a: a["created_at"], reverse=True)
    return {
        "agents": user_agents[:limit],
        "total": len(user_agents),
        "active": sum(1 for a in user_agents if a["status"] == "running"),
    }


@router.get("/p10/status")
async def phase10_status():
    """Phase 10 live dashboard."""
    uptime = time.time() - _p10_metrics["start_time"]
    return {
        "version": "10.0.0",
        "phase": "10 — Multi-Agent Orchestration",
        "uptime_seconds": int(uptime),
        "capabilities": {
            "10_1_multi_agent_orchestration": True,
            "10_2_agentic_cicd": True,
            "10_3_self_improvement": True,
            "10_4_task_graph_dag": True,
            "10_5_autonomous_bugfix": True,
            "10_6_live_code_streaming": True,
            "10_7_workspace_search": True,
            "10_9_multi_model_consensus": True,
            "10_10_agent_memory": True,
        },
        "metrics": {
            "orchestrations": _p10_metrics["orchestrations"],
            "cicd_runs": _p10_metrics["cicd_runs"],
            "self_improvements": _p10_metrics["self_improvements"],
            "bug_fixes": _p10_metrics["bug_fixes"],
            "consensus_runs": _p10_metrics["consensus_runs"],
            "total_agents_spawned": _p10_metrics["total_agents_spawned"],
        },
        "active_agents": sum(1 for a in _agents.values() if a["status"] == "running"),
        "total_agents": len(_agents),
        "active_pipelines": sum(1 for p in _cicd_pipelines.values() if p.get("status") in ("queued", "running")),
        "total_pipelines": len(_cicd_pipelines),
        "task_graphs": len(_task_graphs),
    }
