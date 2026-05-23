"""
smart_router.py — Multi-Provider LLM Router
Supports: Gemini, GitHub Models (gpt-4o-mini), SambaNova
Round-robin keys + auto-fallback + per-key cooldowns
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx

logger = logging.getLogger("smart_router")

# ─── Provider configs ─────────────────────────────────────────────────────────
PROVIDERS = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "default_model": "gemini-2.0-flash",
        "env_key": "GEMINI_KEY",
    },
    "github": {
        "base_url": "https://models.inference.ai.azure.com",
        "default_model": "gpt-4o-mini",
        "env_key": "GITHUB_TOKEN",
    },
    "sambanova": {
        "base_url": "https://api.sambanova.ai/v1",
        "default_model": "Meta-Llama-3.1-8B-Instruct",
        "env_key": "SAMBANOVA_KEY",
    },
}

# Cooldown seconds per error type
_COOLDOWN = {429: 60, 401: 300, 403: 300, 500: 30, 502: 30, 503: 30}

class KeyPool:
    def __init__(self, provider: str):
        self.provider = provider
        self._keys: List[str] = []
        self._cooldowns: Dict[str, float] = {}
        self._idx = 0
        self._load()

    def _load(self):
        env_key = PROVIDERS[self.provider]["env_key"]
        raw = os.environ.get(env_key, "")
        self._keys = [k.strip() for k in raw.split(",") if k.strip()]
        logger.info(f"Provider {self.provider}: {len(self._keys)} key(s)")

    def reload(self):
        self._load()

    def available_count(self) -> int:
        now = time.time()
        return sum(1 for k in self._keys if self._cooldowns.get(k, 0) < now)

    def is_available(self) -> bool:
        return self.available_count() > 0

    def next_key(self) -> Optional[str]:
        now = time.time()
        avail = [k for k in self._keys if self._cooldowns.get(k, 0) < now]
        if not avail:
            return None
        key = avail[self._idx % len(avail)]
        self._idx += 1
        return key

    def cool_down(self, key: str, status: int):
        secs = _COOLDOWN.get(status, 30)
        self._cooldowns[key] = time.time() + secs
        logger.warning(f"Key {key[-8:]}*** cooling {secs}s (HTTP {status})")

    def health(self) -> Dict:
        return {
            "total": len(self._keys),
            "available": self.available_count(),
        }


# Global pools
_pools: Dict[str, KeyPool] = {}

def _init_pools():
    for p in PROVIDERS:
        _pools[p] = KeyPool(p)

_init_pools()

def reload_keys():
    for p in _pools.values():
        p.reload()

def health() -> Dict:
    return {p: _pools[p].health() for p in _pools}


# ─── HTTP helpers ────────────────────────────────────────────────────────────
_client: Optional[httpx.AsyncClient] = None

def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    return _client


# ─── Gemini ──────────────────────────────────────────────────────────────────
def _to_gemini_msgs(messages: List[Dict]) -> List[Dict]:
    """Convert OpenAI-style messages to Gemini format."""
    out = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            continue  # handled via system_instruction
        gemini_role = "model" if role == "assistant" else "user"
        out.append({"role": gemini_role, "parts": [{"text": content}]})
    return out

def _extract_system(messages: List[Dict]) -> Optional[str]:
    for m in messages:
        if m.get("role") == "system":
            return m.get("content", "")
    return None

async def _call_gemini(
    model: str,
    messages: List[Dict],
    temperature: float,
    max_tokens: int,
    system: Optional[str] = None,
) -> tuple[str, str]:
    pool = _pools["gemini"]
    key = pool.next_key()
    if not key:
        raise RuntimeError("No Gemini keys available")

    sys_instr = system or _extract_system(messages)
    gemini_msgs = _to_gemini_msgs(messages)
    payload: Dict[str, Any] = {
        "contents": gemini_msgs,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }
    if sys_instr:
        payload["system_instruction"] = {"parts": [{"text": sys_instr}]}

    url = f"{PROVIDERS['gemini']['base_url']}/models/{model}:generateContent?key={key}"
    client = get_client()
    r = await client.post(url, json=payload)
    if r.status_code != 200:
        pool.cool_down(key, r.status_code)
        raise RuntimeError(f"Gemini {r.status_code}: {r.text[:200]}")

    data = r.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return text, model

async def _stream_gemini(
    model: str,
    messages: List[Dict],
    temperature: float,
    max_tokens: int,
    system: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    pool = _pools["gemini"]
    key = pool.next_key()
    if not key:
        raise RuntimeError("No Gemini keys available")

    sys_instr = system or _extract_system(messages)
    gemini_msgs = _to_gemini_msgs(messages)
    payload: Dict[str, Any] = {
        "contents": gemini_msgs,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }
    if sys_instr:
        payload["system_instruction"] = {"parts": [{"text": sys_instr}]}

    url = f"{PROVIDERS['gemini']['base_url']}/models/{model}:streamGenerateContent?alt=sse&key={key}"
    client = get_client()
    import json
    async with client.stream("POST", url, json=payload) as resp:
        if resp.status_code != 200:
            pool.cool_down(key, resp.status_code)
            raise RuntimeError(f"Gemini stream {resp.status_code}")
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    text = chunk["candidates"][0]["content"]["parts"][0]["text"]
                    if text:
                        yield text
                except Exception:
                    pass


# ─── GitHub Models (OpenAI-compatible) ───────────────────────────────────────
async def _call_github(
    model: str,
    messages: List[Dict],
    temperature: float,
    max_tokens: int,
) -> tuple[str, str]:
    pool = _pools["github"]
    key = pool.next_key()
    if not key:
        raise RuntimeError("No GitHub tokens available")

    url = f"{PROVIDERS['github']['base_url']}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    client = get_client()
    r = await client.post(url, json=payload, headers=headers)
    if r.status_code != 200:
        pool.cool_down(key, r.status_code)
        raise RuntimeError(f"GitHub {r.status_code}: {r.text[:200]}")
    data = r.json()
    text = data["choices"][0]["message"]["content"]
    return text, model

async def _stream_github(
    model: str,
    messages: List[Dict],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    pool = _pools["github"]
    key = pool.next_key()
    if not key:
        raise RuntimeError("No GitHub tokens available")

    import json
    url = f"{PROVIDERS['github']['base_url']}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    client = get_client()
    async with client.stream("POST", url, json=payload, headers=headers) as resp:
        if resp.status_code != 200:
            pool.cool_down(key, resp.status_code)
            raise RuntimeError(f"GitHub stream {resp.status_code}")
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except Exception:
                    pass


# ─── SambaNova ───────────────────────────────────────────────────────────────
async def _call_sambanova(
    model: str,
    messages: List[Dict],
    temperature: float,
    max_tokens: int,
) -> tuple[str, str]:
    pool = _pools["sambanova"]
    key = pool.next_key()
    if not key:
        raise RuntimeError("No SambaNova keys available")

    url = f"{PROVIDERS['sambanova']['base_url']}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    client = get_client()
    r = await client.post(url, json=payload, headers=headers)
    if r.status_code != 200:
        pool.cool_down(key, r.status_code)
        raise RuntimeError(f"SambaNova {r.status_code}: {r.text[:200]}")
    data = r.json()
    text = data["choices"][0]["message"]["content"]
    return text, model


# ─── Auto-fallback chat ───────────────────────────────────────────────────────
FALLBACK_ORDER = [
    ("gemini",    "gemini-2.0-flash"),
    ("github",    "gpt-4o-mini"),
    ("sambanova", "Meta-Llama-3.1-8B-Instruct"),
]

async def auto_chat(
    messages: List[Dict],
    temperature: float = 0.7,
    max_tokens: int = 4096,
    preferred_provider: str = "gemini",
    preferred_model: str = "gemini-2.0-flash",
    system_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Try preferred provider first, then fallback chain."""
    # Inject system if given
    if system_prompt:
        msgs = [{"role": "system", "content": system_prompt}] + [
            m for m in messages if m.get("role") != "system"
        ]
    else:
        msgs = messages

    # Build try order: preferred first
    order = [(preferred_provider, preferred_model)]
    for p, m in FALLBACK_ORDER:
        if (p, m) not in order:
            order.append((p, m))

    last_err = None
    for provider, model in order:
        if not _pools[provider].is_available():
            continue
        try:
            if provider == "gemini":
                text, used_model = await _call_gemini(model, msgs, temperature, max_tokens)
            elif provider == "github":
                text, used_model = await _call_github(model, msgs, temperature, max_tokens)
            elif provider == "sambanova":
                text, used_model = await _call_sambanova(model, msgs, temperature, max_tokens)
            else:
                continue
            return {"content": text, "provider": provider, "model": used_model}
        except Exception as e:
            last_err = e
            logger.warning(f"Provider {provider} failed: {e}")
            continue

    raise RuntimeError(f"All providers failed. Last error: {last_err}")


async def auto_stream(
    messages: List[Dict],
    temperature: float = 0.7,
    max_tokens: int = 4096,
    preferred_provider: str = "gemini",
    preferred_model: str = "gemini-2.0-flash",
    system_prompt: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming version of auto_chat."""
    if system_prompt:
        msgs = [{"role": "system", "content": system_prompt}] + [
            m for m in messages if m.get("role") != "system"
        ]
    else:
        msgs = messages

    order = [(preferred_provider, preferred_model)]
    for p, m in FALLBACK_ORDER:
        if (p, m) not in order:
            order.append((p, m))

    for provider, model in order:
        if not _pools[provider].is_available():
            continue
        try:
            if provider == "gemini":
                gen = _stream_gemini(model, msgs, temperature, max_tokens)
            elif provider == "github":
                gen = _stream_github(model, msgs, temperature, max_tokens)
            else:
                # SambaNova doesn't reliably support streaming; fall through
                result = await _call_sambanova(model, msgs, temperature, max_tokens)
                yield result[0]
                return
            async for chunk in gen:
                yield chunk
            return
        except Exception as e:
            logger.warning(f"Stream provider {provider} failed: {e}")
            continue

    raise RuntimeError("All streaming providers failed")
