"""
agent.py — ReAct Agent Loop + Tool Engine
Real working agent: THINK → ACT → OBSERVE → repeat
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

import db
import smart_router

logger = logging.getLogger("agent")

E2B_API_KEY = os.environ.get("E2B_API_KEY", "")

# ─── Per-user file workspace ──────────────────────────────────────────────────
_workspaces: Dict[str, Dict[str, str]] = {}  # user_id → {filename: content}

def workspace_create(user_id: str, filename: str, content: str) -> Dict:
    _workspaces.setdefault(user_id, {})[filename] = content
    return {"status": "created", "filename": filename, "bytes": len(content)}

def workspace_read(user_id: str, filename: str) -> Optional[str]:
    return _workspaces.get(user_id, {}).get(filename)

def workspace_list(user_id: str) -> List[str]:
    return list(_workspaces.get(user_id, {}).keys())

def workspace_delete(user_id: str, filename: str) -> bool:
    w = _workspaces.get(user_id, {})
    if filename in w:
        del w[filename]
        return True
    return False

def workspace_get_all(user_id: str) -> Dict[str, str]:
    return dict(_workspaces.get(user_id, {}))

# ─── Code Execution ───────────────────────────────────────────────────────────
async def execute_code(
    code: str,
    language: str = "python",
    timeout: int = 30,
    conv_id: Optional[str] = None,
) -> Dict:
    """Execute code using E2B sandbox, fallback to local subprocess."""
    start = time.time()

    # Try E2B first
    if E2B_API_KEY:
        try:
            result = await _e2b_execute(code, language, timeout)
            duration = int((time.time() - start) * 1000)
            result["duration_ms"] = duration
            result["sandbox"] = "e2b"
            if conv_id:
                await db.save_execution(
                    conv_id, code, language,
                    result.get("stdout", ""), result.get("stderr", ""),
                    result.get("exit_code", 0), duration, "e2b"
                )
            return result
        except Exception as e:
            logger.warning(f"E2B failed, using local: {e}")

    # Local fallback
    result = await _local_execute(code, language, timeout)
    duration = int((time.time() - start) * 1000)
    result["duration_ms"] = duration
    result["sandbox"] = "local"
    if conv_id:
        await db.save_execution(
            conv_id, code, language,
            result.get("stdout", ""), result.get("stderr", ""),
            result.get("exit_code", 0), duration, "local"
        )
    return result

async def _e2b_execute(code: str, language: str, timeout: int) -> Dict:
    """Execute via E2B code interpreter."""
    import e2b_code_interpreter as e2b
    
    def _run():
        sbx = e2b.Sandbox(api_key=E2B_API_KEY, timeout=max(timeout, 60))
        try:
            if language in ("python", "py"):
                exec_result = sbx.run_code(code)
            elif language in ("javascript", "js", "node"):
                exec_result = sbx.run_code(code, language="js")
            elif language in ("bash", "shell", "sh"):
                exec_result = sbx.run_code(f"import subprocess\nresult=subprocess.run({json.dumps(['bash','-c',code])},capture_output=True,text=True)\nprint(result.stdout)\nimport sys\nif result.returncode!=0:\n    sys.stderr.write(result.stderr)")
            else:
                exec_result = sbx.run_code(code)

            stdout_parts = []
            if exec_result.logs and exec_result.logs.stdout:
                stdout_parts.extend(exec_result.logs.stdout)
            if exec_result.results:
                for r in exec_result.results:
                    if hasattr(r, 'text') and r.text:
                        stdout_parts.append(r.text)

            stderr_parts = []
            if exec_result.logs and exec_result.logs.stderr:
                stderr_parts.extend(exec_result.logs.stderr)

            error = exec_result.error
            exit_code = 1 if error else 0
            if error:
                stderr_parts.append(f"{error.name}: {error.value}")

            return {
                "stdout": "\n".join(str(x) for x in stdout_parts),
                "stderr": "\n".join(str(x) for x in stderr_parts),
                "exit_code": exit_code,
                "error": str(error) if error else None,
                "language": language,
            }
        finally:
            try:
                sbx.kill()
            except Exception:
                pass

    return await asyncio.to_thread(_run)

async def _local_execute(code: str, language: str, timeout: int) -> Dict:
    """Safe local execution using subprocess."""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            if language in ("python", "py"):
                fpath = os.path.join(tmpdir, "code.py")
                cmd = ["python3", fpath]
            elif language in ("javascript", "js", "node"):
                fpath = os.path.join(tmpdir, "code.js")
                cmd = ["node", fpath]
            elif language in ("bash", "shell", "sh"):
                fpath = os.path.join(tmpdir, "code.sh")
                cmd = ["bash", fpath]
            else:
                fpath = os.path.join(tmpdir, "code.py")
                cmd = ["python3", fpath]

            with open(fpath, "w") as f:
                f.write(code)

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return {
                    "stdout": "",
                    "stderr": f"Timeout after {timeout}s",
                    "exit_code": 124,
                    "error": "timeout",
                    "language": language,
                }

            return {
                "stdout": stdout_b.decode("utf-8", errors="replace"),
                "stderr": stderr_b.decode("utf-8", errors="replace"),
                "exit_code": proc.returncode,
                "error": None,
                "language": language,
            }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": str(e),
            "exit_code": 1,
            "error": str(e),
            "language": language,
        }


# ─── Tools ────────────────────────────────────────────────────────────────────
TOOL_SCHEMAS = [
    {
        "name": "execute_code",
        "description": "Execute Python, JavaScript, or Bash code and return output",
        "parameters": {
            "code": "string - the code to execute",
            "language": "string - python | javascript | bash (default: python)",
        },
    },
    {
        "name": "web_search",
        "description": "Search the web and return relevant results",
        "parameters": {"query": "string - search query"},
    },
    {
        "name": "read_url",
        "description": "Fetch and read content from a URL",
        "parameters": {"url": "string - URL to fetch"},
    },
    {
        "name": "create_file",
        "description": "Create a file in the workspace",
        "parameters": {
            "filename": "string - file path/name",
            "content": "string - file content",
        },
    },
    {
        "name": "read_file",
        "description": "Read a file from the workspace",
        "parameters": {"filename": "string - file to read"},
    },
    {
        "name": "list_files",
        "description": "List all files in the workspace",
        "parameters": {},
    },
    {
        "name": "write_memory",
        "description": "Save important information to persistent memory",
        "parameters": {
            "content": "string - what to remember",
            "key": "string - optional key for retrieval",
        },
    },
    {
        "name": "recall_memory",
        "description": "Retrieve previously saved memories",
        "parameters": {"query": "string - optional search query"},
    },
]

TOOLS_DESCRIPTION = "\n".join(
    f"- {t['name']}: {t['description']}\n  params: {t['parameters']}"
    for t in TOOL_SCHEMAS
)

SYSTEM_PROMPT = f"""You are an Autonomous AI Developer. You solve tasks by thinking step-by-step and using tools.

Available tools:
{TOOLS_DESCRIPTION}

RESPONSE FORMAT (strictly follow this):
Thought: <your reasoning about what to do next>
Action: <tool_name>
Action Input: <JSON object with tool parameters>

When you have the final answer, respond:
Thought: <your final reasoning>
FINAL ANSWER: <your complete answer>

Rules:
- Always use a tool when you need to execute code, search, or access files
- After getting tool output (Observation), analyze it and decide next step
- Be precise with tool names (exact names from the list above)
- Action Input must be valid JSON
- If code execution gives empty stdout, it may still have succeeded — check exit_code
"""

async def _run_tool(tool_name: str, tool_input: Dict, user_id: str, conv_id: Optional[str]) -> str:
    """Execute a tool and return string result."""
    try:
        if tool_name == "execute_code":
            code = tool_input.get("code", "")
            lang = tool_input.get("language", "python")
            result = await execute_code(code, lang, timeout=30, conv_id=conv_id)
            out = result.get("stdout", "")
            err = result.get("stderr", "")
            exit_code = result.get("exit_code", 0)
            parts = []
            if out:
                parts.append(f"stdout:\n{out}")
            if err:
                parts.append(f"stderr:\n{err}")
            parts.append(f"exit_code: {exit_code}")
            return "\n".join(parts) if parts else f"Executed successfully (exit_code: {exit_code}, no output)"

        elif tool_name == "web_search":
            query = tool_input.get("query", "")
            return await _web_search(query)

        elif tool_name == "read_url":
            url = tool_input.get("url", "")
            return await _read_url(url)

        elif tool_name == "create_file":
            fname = tool_input.get("filename", "file.txt")
            content = tool_input.get("content", "")
            result = workspace_create(user_id, fname, content)
            return json.dumps(result)

        elif tool_name == "read_file":
            fname = tool_input.get("filename", "")
            content = workspace_read(user_id, fname)
            if content is None:
                return f"File '{fname}' not found"
            return content

        elif tool_name == "list_files":
            files = workspace_list(user_id)
            return json.dumps({"files": files})

        elif tool_name == "write_memory":
            content = tool_input.get("content", "")
            key = tool_input.get("key")
            await db.save_memory(user_id, content, key=key, conv_id=conv_id)
            return f"Memory saved: {content[:100]}..."

        elif tool_name == "recall_memory":
            mems = await db.get_memories(user_id, limit=5)
            if not mems:
                return "No memories found"
            return "\n".join(f"- {m['content']}" for m in mems)

        else:
            return f"Unknown tool: {tool_name}"

    except Exception as e:
        logger.error(f"Tool {tool_name} error: {e}")
        return f"Tool error: {str(e)}"

async def _web_search(query: str) -> str:
    try:
        client = smart_router.get_client()
        url = f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1"
        r = await client.get(url, timeout=10)
        data = r.json()
        results = []
        if data.get("AbstractText"):
            results.append(f"Summary: {data['AbstractText']}")
        for topic in data.get("RelatedTopics", [])[:3]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append(f"- {topic['Text']}")
        return "\n".join(results) if results else "No results found"
    except Exception as e:
        return f"Search error: {e}"

async def _read_url(url: str) -> str:
    try:
        client = smart_router.get_client()
        r = await client.get(url, timeout=15, follow_redirects=True)
        text = r.text
        # Strip HTML tags roughly
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:3000]
    except Exception as e:
        return f"URL read error: {e}"


# ─── Parse LLM response ───────────────────────────────────────────────────────
def _parse_react_response(text: str) -> Dict:
    """Parse Thought/Action/Action Input from LLM output."""
    result = {"thought": "", "action": None, "action_input": {}, "final_answer": None}

    # Extract Thought
    thought_match = re.search(r"Thought:\s*(.+?)(?=\nAction:|\nFINAL ANSWER:|$)", text, re.DOTALL)
    if thought_match:
        result["thought"] = thought_match.group(1).strip()

    # Check for FINAL ANSWER
    final_match = re.search(r"FINAL ANSWER:\s*(.+)", text, re.DOTALL)
    if final_match:
        result["final_answer"] = final_match.group(1).strip()
        return result

    # Extract Action
    action_match = re.search(r"Action:\s*(\w+)", text)
    if action_match:
        result["action"] = action_match.group(1).strip()

    # Extract Action Input
    input_match = re.search(r"Action Input:\s*(\{.+?\}|\[.+?\]|.+?)(?=\nObservation:|\nThought:|\n\n|$)", text, re.DOTALL)
    if input_match:
        raw = input_match.group(1).strip()
        try:
            result["action_input"] = json.loads(raw)
        except Exception:
            # Try to extract as key-value
            result["action_input"] = {"input": raw}

    # Fallback: look for code blocks and auto-execute
    if not result["action"] and not result["final_answer"]:
        code_match = re.search(r"```(\w*)\n(.*?)```", text, re.DOTALL)
        if code_match:
            lang = code_match.group(1) or "python"
            code = code_match.group(2).strip()
            result["action"] = "execute_code"
            result["action_input"] = {"code": code, "language": lang}

    return result


# ─── ReAct Agent Loop ─────────────────────────────────────────────────────────
async def run_agent(
    task: str,
    user_id: str = "anonymous",
    conv_id: Optional[str] = None,
    model: str = "gemini-2.0-flash",
    provider: str = "gemini",
    max_steps: int = 10,
    execute_code_flag: bool = True,
    use_memory: bool = True,
    system_prompt: Optional[str] = None,
) -> Dict:
    """
    Run the ReAct agent loop.
    Returns dict with: task_id, steps, history, final_answer, status
    """
    task_id = str(uuid.uuid4())
    history = []
    messages = []
    start_time = time.time()

    # Build system prompt
    sys_prompt = system_prompt or SYSTEM_PROMPT

    # Load memories for context
    memory_context = ""
    if use_memory:
        mems = await db.get_memories(user_id, limit=5)
        if mems:
            memory_context = "\nRelevant memories:\n" + "\n".join(
                f"- {m['content']}" for m in mems
            )

    # Initial user message
    user_content = task
    if memory_context:
        user_content += memory_context

    messages.append({"role": "user", "content": user_content})

    final_answer = None
    status = "running"

    for step in range(1, max_steps + 1):
        try:
            # LLM call
            response = await smart_router.auto_chat(
                messages=messages,
                temperature=0.3,
                max_tokens=2048,
                preferred_provider=provider,
                preferred_model=model,
                system_prompt=sys_prompt,
            )
            llm_text = response["content"]
            used_provider = response["provider"]
            used_model = response["model"]

            # Parse response
            parsed = _parse_react_response(llm_text)
            thought = parsed["thought"]
            action = parsed["action"]
            action_input = parsed["action_input"]
            final = parsed["final_answer"]

            step_record = {
                "step": step,
                "thought": thought,
                "action": action,
                "action_input": action_input,
                "observation": None,
                "provider": used_provider,
                "model": used_model,
            }

            # Final answer?
            if final:
                final_answer = final
                step_record["final_answer"] = final
                history.append(step_record)
                messages.append({"role": "assistant", "content": llm_text})
                status = "completed"
                break

            # Execute tool
            if action:
                observation = await _run_tool(action, action_input, user_id, conv_id)
                step_record["observation"] = observation

                # Feed back to LLM
                messages.append({"role": "assistant", "content": llm_text})
                messages.append({
                    "role": "user",
                    "content": f"Observation: {observation}\n\nContinue with the next step.",
                })
            else:
                # No action and no final answer — ask LLM to continue
                observation = "No action taken. Please provide either an Action or FINAL ANSWER."
                step_record["observation"] = observation
                messages.append({"role": "assistant", "content": llm_text})
                messages.append({
                    "role": "user",
                    "content": f"Observation: {observation}\n\nPlease take an action or provide a FINAL ANSWER.",
                })

            history.append(step_record)

        except Exception as e:
            logger.error(f"Agent step {step} error: {e}")
            history.append({
                "step": step,
                "thought": f"Error occurred: {e}",
                "action": None,
                "action_input": {},
                "observation": str(e),
            })
            break

    # If no final answer, synthesize from last observation
    if not final_answer:
        if history:
            last = history[-1]
            if last.get("observation"):
                final_answer = f"Task completed. Last result: {last['observation']}"
            else:
                final_answer = "Task reached max steps without explicit completion."
        status = "completed" if len(history) > 0 else "failed"

    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "task_id": task_id,
        "task": task,
        "steps_taken": len(history),
        "history": history,
        "final_answer": final_answer,
        "status": status,
        "duration_ms": duration_ms,
        "user_id": user_id,
    }


# ─── Plan generation ──────────────────────────────────────────────────────────
async def generate_plan(
    task: str,
    provider: str = "gemini",
    model: str = "gemini-2.0-flash",
    user_id: str = "anonymous",
) -> Dict:
    """Generate a step-by-step plan for a task (no execution)."""
    prompt = f"""You are an AI planning assistant. Create a detailed step-by-step plan.

Task: {task}

Respond with a JSON object:
{{
  "task": "task description",
  "complexity": "low|medium|high",
  "estimated_steps": number,
  "steps": [
    {{
      "step": 1,
      "action": "action name",
      "description": "what to do",
      "expected_output": "what result to expect",
      "tool": "tool_name_if_applicable"
    }}
  ]
}}

Return ONLY valid JSON, no markdown."""

    response = await smart_router.auto_chat(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2048,
        preferred_provider=provider,
        preferred_model=model,
    )
    try:
        # Strip markdown if present
        text = response["content"]
        text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
        plan = json.loads(text)
        plan["provider"] = response["provider"]
        return plan
    except Exception:
        return {
            "task": task,
            "complexity": "medium",
            "estimated_steps": 3,
            "steps": [{"step": 1, "action": "analyze", "description": response["content"][:200]}],
            "provider": response["provider"],
            "raw": response["content"],
        }
