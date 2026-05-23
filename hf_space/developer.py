"""
developer.py — Full-Stack Code Generator + GitHub + Deploy Agent
Real autonomous developer: Generate → Test → GitHub → Deploy
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
import zipfile
import io
from typing import Any, Dict, List, Optional

import httpx

import smart_router
import agent as ag

logger = logging.getLogger("developer")

HF_TOKEN = os.environ.get("HF_TOKEN", "")
VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# ─── Async task queue ─────────────────────────────────────────────────────────
_tasks: Dict[str, Dict] = {}

def new_task(user_id: str, task_type: str, description: str) -> Dict:
    task = {
        "task_id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": task_type,
        "description": description,
        "status": "pending",
        "progress": 0,
        "logs": [],
        "result": None,
        "error": None,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    _tasks[task["task_id"]] = task
    return task

def update_task(task_id: str, **kwargs):
    if task_id in _tasks:
        _tasks[task_id].update(kwargs)
        _tasks[task_id]["updated_at"] = time.time()

def log_progress(task_id: str, message: str, progress: Optional[int] = None):
    if task_id in _tasks:
        _tasks[task_id]["logs"].append({
            "time": time.time(),
            "message": message,
        })
        if progress is not None:
            _tasks[task_id]["progress"] = progress
        _tasks[task_id]["updated_at"] = time.time()
        logger.info(f"[{task_id[:8]}] {message}")

def get_task(task_id: str) -> Optional[Dict]:
    return _tasks.get(task_id)

def list_tasks(user_id: str = "anonymous", limit: int = 20) -> List[Dict]:
    all_tasks = [t for t in _tasks.values() if t["user_id"] == user_id]
    return sorted(all_tasks, key=lambda x: x["created_at"], reverse=True)[:limit]

# ─── Code Generation ──────────────────────────────────────────────────────────
STACK_CONFIGS = {
    "python-fastapi": {
        "name": "Python FastAPI",
        "files": ["main.py", "requirements.txt", "tests/test_main.py", "Dockerfile", "README.md"],
        "run_cmd": "uvicorn main:app --host 0.0.0.0 --port 8000",
    },
    "node-express": {
        "name": "Node.js Express",
        "files": ["server.js", "package.json", "tests/test_server.js", "Dockerfile", "README.md"],
        "run_cmd": "node server.js",
    },
    "react-vite": {
        "name": "React + Vite",
        "files": ["src/App.tsx", "src/main.tsx", "index.html", "package.json", "vite.config.ts", "README.md"],
        "run_cmd": "npm run dev",
    },
    "fullstack-python": {
        "name": "Full Stack (FastAPI + React)",
        "files": ["backend/main.py", "backend/requirements.txt", "frontend/src/App.tsx", "docker-compose.yml", "README.md"],
        "run_cmd": "docker-compose up",
    },
    "html-css-js": {
        "name": "Static HTML/CSS/JS",
        "files": ["index.html", "style.css", "app.js", "README.md"],
        "run_cmd": "open index.html",
    },
}

async def generate_project(
    description: str,
    stack: str = "python-fastapi",
    include_tests: bool = True,
    include_dockerfile: bool = True,
    provider: str = "gemini",
    model: str = "gemini-2.0-flash",
    user_id: str = "anonymous",
    task_id: Optional[str] = None,
) -> Dict:
    """Generate a complete project from description."""
    stack_cfg = STACK_CONFIGS.get(stack, STACK_CONFIGS["python-fastapi"])
    files_to_gen = stack_cfg["files"]

    log_progress(task_id or "", f"🏗️ Planning {stack_cfg['name']} project...", 5)

    # Generate architecture plan
    plan_prompt = f"""You are a senior software engineer. Plan a complete {stack_cfg['name']} project.

Project description: {description}

List the exact files needed (max 8 files) and what each should contain.
Respond as JSON:
{{
  "project_name": "snake_case_name",
  "description": "one line description",
  "files": ["file1.py", "file2.py", ...]
}}
Return ONLY valid JSON."""

    plan_resp = await smart_router.auto_chat(
        messages=[{"role": "user", "content": plan_prompt}],
        temperature=0.3,
        max_tokens=1024,
        preferred_provider=provider,
        preferred_model=model,
    )

    try:
        plan_text = plan_resp["content"]
        plan_text = re.sub(r"^```json\s*|\s*```$", "", plan_text.strip())
        plan = json.loads(plan_text)
        project_name = plan.get("project_name", "my_project")
        files_to_gen = plan.get("files", files_to_gen)[:8]
    except Exception:
        project_name = "my_project"

    log_progress(task_id or "", f"📝 Generating {len(files_to_gen)} files...", 15)

    # Generate each file
    generated_files: Dict[str, str] = {}
    already_generated: List[str] = []

    for i, fname in enumerate(files_to_gen):
        progress = 15 + int((i / len(files_to_gen)) * 70)
        log_progress(task_id or "", f"📄 Generating {fname}...", progress)

        prompt = f"""Generate the complete content for {fname} in a {stack_cfg['name']} project.

Project: {description}
Project name: {project_name}
Stack: {stack_cfg['name']}

Files already created: {already_generated}

Rules:
- Write complete, production-ready code
- Include proper imports, error handling, comments
- Do NOT include markdown fences or explanations
- Return ONLY the raw file content"""

        resp = await smart_router.auto_chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2048,
            preferred_provider=provider,
            preferred_model=model,
        )
        content = resp["content"]
        # Strip markdown fences if LLM added them
        content = re.sub(r"^```\w*\n?|```$", "", content.strip())
        generated_files[fname] = content
        already_generated.append(fname)
        ag.workspace_create(user_id, fname, content)

    log_progress(task_id or "", f"✅ Generated {len(generated_files)} files", 90)

    return {
        "project_name": project_name,
        "description": description,
        "stack": stack,
        "file_count": len(generated_files),
        "files": generated_files,
        "run_cmd": stack_cfg["run_cmd"],
    }

# ─── GitHub Operations ────────────────────────────────────────────────────────
async def github_op(
    operation: str,
    github_token: Optional[str] = None,
    **kwargs,
) -> Dict:
    """Perform GitHub operations."""
    token = github_token or GITHUB_TOKEN
    if not token:
        return {"error": "No GitHub token provided"}

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    }
    client = smart_router.get_client()

    if operation == "list_repos":
        r = await client.get("https://api.github.com/user/repos?per_page=30&sort=updated", headers=headers)
        if r.status_code == 200:
            repos = r.json()
            return {"repos": [{"name": repo["name"], "full_name": repo["full_name"], "url": repo["html_url"], "description": repo.get("description")} for repo in repos]}
        return {"error": f"GitHub API {r.status_code}: {r.text[:200]}"}

    elif operation == "create_repo":
        name = kwargs.get("repo_name", "")
        desc = kwargs.get("description", "")
        private = kwargs.get("private", False)
        payload = {"name": name, "description": desc, "private": private, "auto_init": True}
        r = await client.post("https://api.github.com/user/repos", json=payload, headers=headers)
        if r.status_code in (200, 201):
            data = r.json()
            return {"repo": data["full_name"], "url": data["html_url"], "clone_url": data["clone_url"]}
        return {"error": f"Create repo failed: {r.status_code} {r.text[:200]}"}

    elif operation == "get_repo_info":
        repo = kwargs.get("repo", "")
        r = await client.get(f"https://api.github.com/repos/{repo}", headers=headers)
        if r.status_code == 200:
            data = r.json()
            return {"name": data["name"], "full_name": data["full_name"], "default_branch": data["default_branch"], "url": data["html_url"]}
        return {"error": f"Get repo failed: {r.status_code}"}

    elif operation == "commit_files":
        repo = kwargs.get("repo", "")
        files = kwargs.get("files", {})  # {filename: content}
        message = kwargs.get("message", "Auto-commit by Autonomous AI Developer")
        branch = kwargs.get("branch", "main")

        if not files:
            return {"error": "No files provided"}

        # Get repo info for default branch
        r = await client.get(f"https://api.github.com/repos/{repo}", headers=headers)
        if r.status_code != 200:
            return {"error": f"Repo not found: {r.status_code}"}
        repo_data = r.json()
        default_branch = repo_data.get("default_branch", "main")
        branch = branch if branch != "main" else default_branch

        # Get current commit SHA
        r = await client.get(
            f"https://api.github.com/repos/{repo}/git/ref/heads/{branch}",
            headers=headers
        )
        if r.status_code != 200:
            return {"error": f"Branch {branch} not found: {r.status_code}"}
        current_sha = r.json()["object"]["sha"]

        # Get tree SHA
        r = await client.get(
            f"https://api.github.com/repos/{repo}/git/commits/{current_sha}",
            headers=headers
        )
        if r.status_code != 200:
            return {"error": f"Could not get commit: {r.status_code}"}
        base_tree_sha = r.json()["tree"]["sha"]

        import base64
        # Create blobs for each file
        tree_items = []
        for filepath, content in files.items():
            content_encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
            r = await client.post(
                f"https://api.github.com/repos/{repo}/git/blobs",
                json={"content": content_encoded, "encoding": "base64"},
                headers=headers,
            )
            if r.status_code not in (200, 201):
                return {"error": f"Blob create failed for {filepath}: {r.status_code}"}
            blob_sha = r.json()["sha"]
            tree_items.append({"path": filepath, "mode": "100644", "type": "blob", "sha": blob_sha})

        # Create tree
        r = await client.post(
            f"https://api.github.com/repos/{repo}/git/trees",
            json={"base_tree": base_tree_sha, "tree": tree_items},
            headers=headers,
        )
        if r.status_code not in (200, 201):
            return {"error": f"Tree create failed: {r.status_code} {r.text[:200]}"}
        new_tree_sha = r.json()["sha"]

        # Create commit
        r = await client.post(
            f"https://api.github.com/repos/{repo}/git/commits",
            json={"message": message, "tree": new_tree_sha, "parents": [current_sha]},
            headers=headers,
        )
        if r.status_code not in (200, 201):
            return {"error": f"Commit create failed: {r.status_code} {r.text[:200]}"}
        new_commit_sha = r.json()["sha"]

        # Update branch reference
        r = await client.patch(
            f"https://api.github.com/repos/{repo}/git/refs/heads/{branch}",
            json={"sha": new_commit_sha, "force": False},
            headers=headers,
        )
        if r.status_code not in (200, 201):
            return {"error": f"Ref update failed: {r.status_code} {r.text[:200]}"}

        return {
            "commit_sha": new_commit_sha,
            "branch": branch,
            "files_committed": list(files.keys()),
            "url": f"https://github.com/{repo}/commit/{new_commit_sha}",
        }

    elif operation == "create_pr":
        repo = kwargs.get("repo", "")
        title = kwargs.get("title", "Auto PR by Autonomous AI Developer")
        body = kwargs.get("body", "")
        head = kwargs.get("head", "feature-branch")
        base = kwargs.get("base", "main")
        r = await client.post(
            f"https://api.github.com/repos/{repo}/pulls",
            json={"title": title, "body": body, "head": head, "base": base},
            headers=headers,
        )
        if r.status_code in (200, 201):
            data = r.json()
            return {"pr_url": data["html_url"], "pr_number": data["number"], "state": data["state"]}
        return {"error": f"PR create failed: {r.status_code} {r.text[:200]}"}

    elif operation == "list_prs":
        repo = kwargs.get("repo", "")
        r = await client.get(f"https://api.github.com/repos/{repo}/pulls?state=open", headers=headers)
        if r.status_code == 200:
            prs = r.json()
            return {"prs": [{"number": pr["number"], "title": pr["title"], "url": pr["html_url"], "state": pr["state"]} for pr in prs]}
        return {"error": f"List PRs failed: {r.status_code}"}

    elif operation == "get_user":
        r = await client.get("https://api.github.com/user", headers=headers)
        if r.status_code == 200:
            data = r.json()
            return {"login": data["login"], "name": data.get("name"), "email": data.get("email")}
        return {"error": f"Get user failed: {r.status_code}"}

    else:
        return {"error": f"Unknown operation: {operation}"}


# ─── HuggingFace Deploy ────────────────────────────────────────────────────────
async def deploy_to_huggingface(
    space_id: str,
    files: Dict[str, str],
    hf_token: Optional[str] = None,
    space_sdk: str = "docker",
    task_id: Optional[str] = None,
) -> Dict:
    """Deploy files to HuggingFace Space via git."""
    token = hf_token or HF_TOKEN
    if not token:
        return {"error": "No HuggingFace token provided"}

    log_progress(task_id or "", f"🤗 Deploying to HF Space: {space_id}...", 50)

    client = smart_router.get_client()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Upload each file via HF API
    uploaded = []
    for filepath, content in files.items():
        import base64
        encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
        payload = {
            "path": filepath,
            "content": encoded,
            "encoding": "base64",
            "message": f"Auto-deploy: {filepath}",
        }
        # Try to commit file
        api_url = f"https://huggingface.co/api/spaces/{space_id}/raw/{filepath}"
        try:
            r = await client.put(api_url, json=payload, headers=headers, timeout=30)
            if r.status_code in (200, 201):
                uploaded.append(filepath)
            else:
                logger.warning(f"HF upload {filepath}: {r.status_code}")
        except Exception as e:
            logger.warning(f"HF upload {filepath} error: {e}")

    space_url = f"https://huggingface.co/spaces/{space_id}"
    log_progress(task_id or "", f"✅ HF deploy: {len(uploaded)}/{len(files)} files", 90)
    return {
        "space_id": space_id,
        "url": space_url,
        "files_uploaded": uploaded,
        "total_files": len(files),
    }


# ─── Vercel Deploy ─────────────────────────────────────────────────────────────
async def deploy_to_vercel(
    project_name: str,
    files: Dict[str, str],
    vercel_token: Optional[str] = None,
    task_id: Optional[str] = None,
) -> Dict:
    """Deploy static files to Vercel."""
    token = vercel_token or VERCEL_TOKEN
    if not token:
        return {"error": "No Vercel token provided"}

    log_progress(task_id or "", f"▲ Deploying to Vercel: {project_name}...", 50)

    client = smart_router.get_client()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Build deployment payload
    deployment_files = []
    for filepath, content in files.items():
        deployment_files.append({
            "file": filepath,
            "data": content,
        })

    payload = {
        "name": project_name.lower().replace("_", "-"),
        "files": deployment_files,
        "projectSettings": {
            "framework": None,
            "buildCommand": None,
            "outputDirectory": None,
        },
    }

    r = await client.post(
        "https://api.vercel.com/v13/deployments",
        json=payload,
        headers=headers,
        timeout=60,
    )
    if r.status_code in (200, 201):
        data = r.json()
        url = f"https://{data.get('url', project_name + '.vercel.app')}"
        log_progress(task_id or "", f"✅ Vercel deploy complete: {url}", 95)
        return {
            "deployment_id": data.get("id"),
            "url": url,
            "status": data.get("status", "BUILDING"),
        }
    return {"error": f"Vercel deploy failed: {r.status_code} {r.text[:300]}"}


# ─── Full Dev Workflow ─────────────────────────────────────────────────────────
async def run_dev_workflow(
    description: str,
    stack: str = "python-fastapi",
    provider: str = "gemini",
    model: str = "gemini-2.0-flash",
    user_id: str = "anonymous",
    github_token: Optional[str] = None,
    github_repo: Optional[str] = None,
    vercel_token: Optional[str] = None,
    hf_token: Optional[str] = None,
    deploy_to: Optional[str] = None,
    run_tests: bool = True,
    task_id: Optional[str] = None,
) -> Dict:
    """
    Full autonomous developer workflow:
    1. Generate project files
    2. Run tests (if Python)
    3. Push to GitHub (if token+repo)
    4. Deploy (if requested)
    5. Return report
    """
    result = {
        "description": description,
        "stack": stack,
        "steps_completed": [],
        "generate": None,
        "test": None,
        "github": None,
        "deploy": None,
        "success": False,
    }

    # Step 1: Generate
    log_progress(task_id or "", "📝 Step 1: Generating project code...", 5)
    try:
        gen_result = await generate_project(
            description=description,
            stack=stack,
            include_tests=run_tests,
            provider=provider,
            model=model,
            user_id=user_id,
            task_id=task_id,
        )
        result["generate"] = gen_result
        result["steps_completed"].append("generate")
        log_progress(task_id or "", f"✅ Generated {gen_result['file_count']} files", 35)
    except Exception as e:
        result["error"] = f"Generate failed: {e}"
        update_task(task_id or "", status="failed", error=str(e), result=result)
        return result

    # Step 2: Test (Python only, basic)
    if run_tests and "python" in stack:
        log_progress(task_id or "", "🧪 Step 2: Running basic syntax check...", 40)
        try:
            # Syntax check the main file
            main_code = gen_result["files"].get("main.py", "")
            if main_code:
                test_code = f"""
import ast
import sys
code = {json.dumps(main_code)}
try:
    ast.parse(code)
    print("Syntax OK: main.py")
except SyntaxError as e:
    print(f"Syntax Error: {{e}}")
    sys.exit(1)
"""
                test_result = await ag.execute_code(test_code, "python", timeout=10)
                result["test"] = {
                    "status": "passed" if test_result["exit_code"] == 0 else "failed",
                    "output": test_result.get("stdout", ""),
                }
                result["steps_completed"].append("test")
                log_progress(task_id or "", f"✅ Test: {result['test']['status']}", 55)
        except Exception as e:
            result["test"] = {"status": "error", "error": str(e)}

    # Step 3: GitHub push
    if github_token and github_repo:
        log_progress(task_id or "", f"📤 Step 3: Pushing to GitHub {github_repo}...", 60)
        try:
            gh_result = await github_op(
                "commit_files",
                github_token=github_token,
                repo=github_repo,
                files=gen_result["files"],
                message=f"🤖 Auto-generated: {description[:80]}",
            )
            result["github"] = gh_result
            if "error" not in gh_result:
                result["steps_completed"].append("github")
                log_progress(task_id or "", f"✅ GitHub: {gh_result.get('url', 'pushed')}", 75)
            else:
                log_progress(task_id or "", f"⚠️ GitHub error: {gh_result['error']}", 75)
        except Exception as e:
            result["github"] = {"error": str(e)}

    # Step 4: Deploy
    if deploy_to:
        log_progress(task_id or "", f"🚀 Step 4: Deploying to {deploy_to}...", 80)
        try:
            if deploy_to == "vercel":
                deploy_result = await deploy_to_vercel(
                    gen_result["project_name"],
                    gen_result["files"],
                    vercel_token=vercel_token,
                    task_id=task_id,
                )
            elif deploy_to == "huggingface":
                deploy_result = await deploy_to_huggingface(
                    f"PYAE1994/{gen_result['project_name']}",
                    gen_result["files"],
                    hf_token=hf_token,
                    task_id=task_id,
                )
            else:
                deploy_result = {"error": f"Unknown deploy target: {deploy_to}"}

            result["deploy"] = deploy_result
            if "error" not in deploy_result:
                result["steps_completed"].append("deploy")
                log_progress(task_id or "", f"✅ Deployed: {deploy_result.get('url', 'success')}", 95)
        except Exception as e:
            result["deploy"] = {"error": str(e)}

    result["success"] = len(result["steps_completed"]) > 0
    log_progress(task_id or "", f"🎉 Workflow complete: {result['steps_completed']}", 100)
    update_task(task_id or "", status="completed", progress=100, result=result)
    return result


# ─── Code Intelligence ────────────────────────────────────────────────────────
async def code_intelligence(
    operation: str,
    code: str,
    language: str = "python",
    context: str = "",
    provider: str = "gemini",
    model: str = "gemini-2.0-flash",
) -> Dict:
    """Explain, refactor, debug, document, or convert code."""
    prompts = {
        "explain": f"Explain this {language} code clearly and concisely:\n\n```{language}\n{code}\n```\n\n{context}",
        "refactor": f"Refactor this {language} code for better quality, readability, and performance. Return only the improved code:\n\n```{language}\n{code}\n```",
        "debug": f"Debug this {language} code. Identify issues and provide fixed code:\n\n```{language}\n{code}\n```\n\nError context: {context}",
        "document": f"Add comprehensive docstrings and comments to this {language} code:\n\n```{language}\n{code}\n```",
        "convert": f"Convert this code to {context or 'Python'}. Return only the converted code:\n\n```{language}\n{code}\n```",
        "review": f"""Review this {language} code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and best practices

Code:
```{language}
{code}
```

{context}

Provide specific, actionable feedback.""",
    }

    prompt = prompts.get(operation, prompts["explain"])
    response = await smart_router.auto_chat(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2048,
        preferred_provider=provider,
        preferred_model=model,
    )
    return {
        "operation": operation,
        "language": language,
        "result": response["content"],
        "provider": response["provider"],
        "model": response["model"],
    }
