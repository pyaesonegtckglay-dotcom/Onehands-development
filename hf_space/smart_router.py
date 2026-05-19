"""
Smart API Router — Onehands Backend
======================================
Multi-provider LLM routing with:
  - Round-robin key selection
  - Per-key cooldown on rate limits / auth errors
  - Auto-heal: cooldown expires → key becomes available again
  - Hard-fail cooldown for 401/403 (bad key)
  - Streaming support (Gemini, SambaNova, GitHub LLM)
  - Provider fallback chain

Env vars (comma-separated lists):
  GEMINI_KEY        — Google Gemini API keys
  SAMBANOVA_KEY     — SambaNova API keys
  GITHUB_KEY        — GitHub Models (Azure inference) keys
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncGenerator, Optional

import httpx

logger = logging.getLogger("smart_router")

# ─── Tuning ───────────────────────────────────────────────────────────────────
COOLDOWN_429      = 60      # rate-limit cooldown
COOLDOWN_5XX      = 30      # server error cooldown
COOLDOWN_NETWORK  = 15      # transient network error
COOLDOWN_HARD     = 300     # 401/403 — bad key
MAX_RETRIES       = 3


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _load_keys(*env_vars: str) -> list[str]:
    """Load API keys from one or more env var names (first non-empty wins).
    Supports comma-separated multiple keys per env var.
    Accepts both singular (GEMINI_KEY) and plural (GEMINI_KEYS) variants.
    """
    for env_var in env_vars:
        raw = os.environ.get(env_var, "").strip()
        if raw:
            return [k.strip() for k in raw.split(",") if k.strip()]
    return []


# ─── Provider enum ────────────────────────────────────────────────────────────

class Provider(str, Enum):
    GEMINI     = "gemini"
    SAMBANOVA  = "sambanova"
    GITHUB_LLM = "github_llm"


# ─── Key state ────────────────────────────────────────────────────────────────

@dataclass
class KeyState:
    key:            str
    provider:       Provider
    available:      bool  = True
    cooldown_until: float = 0.0
    total_requests: int   = 0
    total_errors:   int   = 0
    total_success:  int   = 0
    last_error:     str   = ""

    def is_ready(self) -> bool:
        if self.available:
            return True
        if time.time() >= self.cooldown_until:
            self.available = True
            logger.info("Key ...%s healed (cooldown expired)", self.key[-6:])
            return True
        return False

    def mark_success(self):
        self.total_requests += 1
        self.total_success  += 1
        self.available       = True
        self.last_error      = ""

    def mark_cooldown(self, seconds: float, reason: str = ""):
        self.total_requests  += 1
        self.total_errors    += 1
        self.available        = False
        self.cooldown_until   = time.time() + seconds
        self.last_error       = reason
        logger.warning(
            "Key ...%s → cooldown %.0fs  reason=%s",
            self.key[-6:], seconds, reason or "?"
        )

    def to_dict(self) -> dict:
        cd = max(0.0, self.cooldown_until - time.time())
        return {
            "key_suffix":         f"...{self.key[-6:]}",
            "provider":           self.provider.value,
            "available":          self.is_ready(),
            "cooldown_remaining": round(cd, 1),
            "total_requests":     self.total_requests,
            "total_success":      self.total_success,
            "total_errors":       self.total_errors,
            "last_error":         self.last_error,
        }


# ─── Router ───────────────────────────────────────────────────────────────────

class SmartRouter:
    def __init__(self):
        self._pools:   dict[Provider, list[KeyState]] = {}
        self._indices: dict[Provider, int]            = {}
        self._lock = asyncio.Lock()
        self._reload_keys()

    def _reload_keys(self):
        self._pools = {
            Provider.GEMINI:     [KeyState(k, Provider.GEMINI)     for k in _load_keys("GEMINI_KEYS", "GEMINI_KEY")],
            Provider.SAMBANOVA:  [KeyState(k, Provider.SAMBANOVA)  for k in _load_keys("SAMBANOVA_KEYS", "SAMBANOVA_KEY")],
            Provider.GITHUB_LLM: [KeyState(k, Provider.GITHUB_LLM) for k in _load_keys("GITHUB_KEYS", "GITHUB_KEY")],
        }
        self._indices = {p: 0 for p in Provider}
        for p, pool in self._pools.items():
            logger.info("Provider %s → %d key(s) loaded", p.value, len(pool))

    async def get_key(self, provider: Provider) -> Optional[KeyState]:
        async with self._lock:
            pool = self._pools.get(provider, [])
            if not pool:
                return None
            start = self._indices[provider]
            n = len(pool)
            for i in range(n):
                idx = (start + i) % n
                ks  = pool[idx]
                if ks.is_ready():
                    self._indices[provider] = (idx + 1) % n
                    return ks
            return None

    def _apply_error(self, ks: KeyState, status: int, reason: str = ""):
        if status in (401, 403):
            ks.mark_cooldown(COOLDOWN_HARD,    reason or f"HTTP {status}")
        elif status == 429:
            ks.mark_cooldown(COOLDOWN_429,     reason or "rate-limit")
        elif status >= 500:
            ks.mark_cooldown(COOLDOWN_5XX,     reason or f"server error {status}")
        else:
            ks.mark_cooldown(COOLDOWN_NETWORK, reason or f"HTTP {status}")

    def health(self) -> dict:
        out = {}
        for provider, pool in self._pools.items():
            out[provider.value] = {
                "total_keys":     len(pool),
                "available_keys": sum(1 for k in pool if k.is_ready()),
                "keys":           [k.to_dict() for k in pool],
            }
        return out

    # ── Gemini ────────────────────────────────────────────────────────────────

    async def call_gemini(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_instruction: Optional[str] = None,
    ) -> dict:
        url_tpl = (
            "https://generativelanguage.googleapis.com"
            "/v1beta/models/{model}:generateContent"
        )
        payload: dict = {
            "contents": messages,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_instruction:
            payload["system_instruction"] = {"parts": [{"text": system_instruction}]}

        for attempt in range(MAX_RETRIES):
            ks = await self.get_key(Provider.GEMINI)
            if not ks:
                raise RuntimeError("All Gemini keys on cooldown — no key available")
            url = url_tpl.format(model=model) + f"?key={ks.key}"
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    ks.mark_success()
                    return resp.json()
                body = resp.text[:300]
                logger.warning("Gemini HTTP %d  body=%s", resp.status_code, body)
                self._apply_error(ks, resp.status_code, body)
            except httpx.RequestError as exc:
                ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
        raise RuntimeError("Gemini: all retries exhausted")

    async def stream_gemini(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        url_tpl = (
            "https://generativelanguage.googleapis.com"
            "/v1beta/models/{model}:streamGenerateContent"
        )
        payload = {
            "contents": messages,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        ks = await self.get_key(Provider.GEMINI)
        if not ks:
            raise RuntimeError("All Gemini keys on cooldown")
        url = url_tpl.format(model=model) + f"?key={ks.key}&alt=sse"
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", url, json=payload) as resp:
                    if resp.status_code != 200:
                        self._apply_error(ks, resp.status_code)
                        raise RuntimeError(f"Gemini stream HTTP {resp.status_code}")
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            data = line[5:].strip()
                            if data and data != "[DONE]":
                                try:
                                    chunk = json.loads(data)
                                    text = (
                                        chunk.get("candidates", [{}])[0]
                                        .get("content", {})
                                        .get("parts", [{}])[0]
                                        .get("text", "")
                                    )
                                    if text:
                                        yield text
                                except Exception:
                                    pass
            ks.mark_success()
        except httpx.RequestError as exc:
            ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
            raise

    # ── SambaNova ─────────────────────────────────────────────────────────────

    async def call_sambanova(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict:
        url = "https://api.sambanova.ai/v1/chat/completions"
        payload = {
            "model":       model,
            "messages":    messages,
            "temperature": temperature,
            "max_tokens":  max_tokens,
        }
        for attempt in range(MAX_RETRIES):
            ks = await self.get_key(Provider.SAMBANOVA)
            if not ks:
                raise RuntimeError("All SambaNova keys on cooldown")
            headers = {
                "Authorization": f"Bearer {ks.key}",
                "Content-Type":  "application/json",
            }
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    ks.mark_success()
                    return resp.json()
                body = resp.text[:200]
                logger.warning("SambaNova HTTP %d  body=%s", resp.status_code, body)
                self._apply_error(ks, resp.status_code, body)
            except httpx.RequestError as exc:
                ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
        raise RuntimeError("SambaNova: all retries exhausted")

    async def stream_sambanova(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        url = "https://api.sambanova.ai/v1/chat/completions"
        payload = {
            "model":       model,
            "messages":    messages,
            "temperature": temperature,
            "max_tokens":  max_tokens,
            "stream":      True,
        }
        ks = await self.get_key(Provider.SAMBANOVA)
        if not ks:
            raise RuntimeError("All SambaNova keys on cooldown")
        headers = {"Authorization": f"Bearer {ks.key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        self._apply_error(ks, resp.status_code)
                        raise RuntimeError(f"SambaNova stream HTTP {resp.status_code}")
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            data = line[5:].strip()
                            if data and data != "[DONE]":
                                try:
                                    chunk = json.loads(data)
                                    delta = (
                                        chunk.get("choices", [{}])[0]
                                        .get("delta", {})
                                        .get("content", "")
                                    )
                                    if delta:
                                        yield delta
                                except Exception:
                                    pass
            ks.mark_success()
        except httpx.RequestError as exc:
            ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
            raise

    # ── GitHub LLM ────────────────────────────────────────────────────────────

    async def call_github_llm(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict:
        url = "https://models.inference.ai.azure.com/chat/completions"
        payload = {
            "model":       model,
            "messages":    messages,
            "temperature": temperature,
            "max_tokens":  max_tokens,
        }
        for attempt in range(MAX_RETRIES):
            ks = await self.get_key(Provider.GITHUB_LLM)
            if not ks:
                raise RuntimeError("All GitHub LLM keys on cooldown")
            headers = {
                "Authorization": f"Bearer {ks.key}",
                "Content-Type":  "application/json",
            }
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    ks.mark_success()
                    return resp.json()
                body = resp.text[:200]
                logger.warning("GitHub LLM HTTP %d  body=%s", resp.status_code, body)
                self._apply_error(ks, resp.status_code, body)
            except httpx.RequestError as exc:
                ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
        raise RuntimeError("GitHub LLM: all retries exhausted")

    async def stream_github_llm(
        self,
        model: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        url = "https://models.inference.ai.azure.com/chat/completions"
        payload = {
            "model":       model,
            "messages":    messages,
            "temperature": temperature,
            "max_tokens":  max_tokens,
            "stream":      True,
        }
        ks = await self.get_key(Provider.GITHUB_LLM)
        if not ks:
            raise RuntimeError("All GitHub LLM keys on cooldown")
        headers = {"Authorization": f"Bearer {ks.key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        self._apply_error(ks, resp.status_code)
                        raise RuntimeError(f"GitHub LLM stream HTTP {resp.status_code}")
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            data = line[5:].strip()
                            if data and data != "[DONE]":
                                try:
                                    chunk = json.loads(data)
                                    delta = (
                                        chunk.get("choices", [{}])[0]
                                        .get("delta", {})
                                        .get("content", "")
                                    )
                                    if delta:
                                        yield delta
                                except Exception:
                                    pass
            ks.mark_success()
        except httpx.RequestError as exc:
            ks.mark_cooldown(COOLDOWN_NETWORK, str(exc))
            raise

    # ── Auto-fallback chat ────────────────────────────────────────────────────

    async def auto_chat(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        preferred_provider: str = "gemini",
        preferred_model: str = "gemini-2.0-flash",
        system_prompt: Optional[str] = None,
    ) -> dict:
        """
        Try preferred provider first, then fall back across providers.
        Returns {"content": str, "provider": str, "model": str}
        """
        order = [preferred_provider] + [
            p for p in ("gemini", "sambanova", "github_llm")
            if p != preferred_provider
        ]
        default_models = {
            "gemini":     "gemini-2.0-flash",
            "sambanova":  "Meta-Llama-3.3-70B-Instruct",
            "github_llm": "gpt-4o-mini",
        }
        last_err = None
        for provider_name in order:
            model = preferred_model if provider_name == preferred_provider else default_models.get(provider_name, "")
            try:
                if provider_name == "gemini":
                    gemini_msgs = _to_gemini_format(messages)
                    result = await self.call_gemini(model, gemini_msgs, temperature, max_tokens, system_instruction=system_prompt)
                    content = result["candidates"][0]["content"]["parts"][0]["text"]
                elif provider_name == "sambanova":
                    msgs = messages
                    if system_prompt:
                        msgs = [{"role": "system", "content": system_prompt}] + [m for m in messages if m.get("role") != "system"]
                    result = await self.call_sambanova(model, msgs, temperature, max_tokens)
                    content = result["choices"][0]["message"]["content"]
                elif provider_name == "github_llm":
                    msgs = messages
                    if system_prompt:
                        msgs = [{"role": "system", "content": system_prompt}] + [m for m in messages if m.get("role") != "system"]
                    result = await self.call_github_llm(model, msgs, temperature, max_tokens)
                    content = result["choices"][0]["message"]["content"]
                else:
                    continue
                return {"content": content, "provider": provider_name, "model": model}
            except Exception as e:
                last_err = e
                logger.warning("auto_chat: provider=%s failed: %s — trying next", provider_name, e)
        raise RuntimeError(f"All providers failed. Last error: {last_err}")


# ─── Utilities ────────────────────────────────────────────────────────────────

def _to_gemini_format(messages: list) -> list:
    """Convert OpenAI-style messages → Gemini contents format.
    NOTE: system messages are handled via system_instruction param, skip them here.
    """
    out = []
    for m in messages:
        role = m.get("role", "user")
        if role == "system":
            continue  # system handled separately via system_instruction
        gemini_role = "user" if role == "user" else "model"
        out.append({"role": gemini_role, "parts": [{"text": m.get("content", "")}]})
    # Gemini requires alternating user/model; ensure starts with user
    if out and out[0]["role"] == "model":
        out.insert(0, {"role": "user", "parts": [{"text": ""}]})
    return out


# ─── Singleton ────────────────────────────────────────────────────────────────
router = SmartRouter()
