"""
Smart API Router — keys loaded from env vars only.
Set these env vars (comma-separated) in your deployment:
  GEMINI_KEY, SAMBANOVA_KEY, GITHUB_KEY
"""

import asyncio
import time
import logging
import os
import httpx
from typing import Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger("smart_router")

COOLDOWN_SECONDS = 60
HARD_FAIL_COOLDOWN = 300
MAX_RETRIES_PER_REQUEST = 3


def _load_keys(env_var: str) -> list:
    raw = os.environ.get(env_var, "").strip()
    if raw:
        return [k.strip() for k in raw.split(",") if k.strip()]
    return []


class Provider(str, Enum):
    GEMINI = "gemini"
    SAMBANOVA = "sambanova"
    GITHUB_LLM = "github_llm"


@dataclass
class KeyState:
    key: str
    provider: Provider
    available: bool = True
    cooldown_until: float = 0.0
    total_requests: int = 0
    total_errors: int = 0
    total_success: int = 0

    def is_ready(self) -> bool:
        if self.available:
            return True
        if time.time() >= self.cooldown_until:
            self.available = True
            return True
        return False

    def mark_success(self):
        self.total_requests += 1
        self.total_success += 1
        self.available = True

    def mark_cooldown(self, seconds: float = COOLDOWN_SECONDS):
        self.total_requests += 1
        self.total_errors += 1
        self.available = False
        self.cooldown_until = time.time() + seconds

    def to_dict(self) -> dict:
        return {
            "key_suffix": f"...{self.key[-6:]}",
            "provider": self.provider.value,
            "available": self.is_ready(),
            "cooldown_remaining": max(0, self.cooldown_until - time.time()),
            "total_requests": self.total_requests,
            "total_success": self.total_success,
            "total_errors": self.total_errors,
        }


class SmartRouter:
    def __init__(self):
        self._pools: dict[Provider, list[KeyState]] = {}
        self._indices: dict[Provider, int] = {}
        self._lock = asyncio.Lock()
        self._reload_keys()

    def _reload_keys(self):
        gemini_keys = _load_keys("GEMINI_KEY")
        sn_keys = _load_keys("SAMBANOVA_KEY")
        gh_keys = _load_keys("GITHUB_KEY")
        self._pools = {
            Provider.GEMINI:    [KeyState(k, Provider.GEMINI) for k in gemini_keys],
            Provider.SAMBANOVA: [KeyState(k, Provider.SAMBANOVA) for k in sn_keys],
            Provider.GITHUB_LLM:[KeyState(k, Provider.GITHUB_LLM) for k in gh_keys],
        }
        self._indices = {p: 0 for p in Provider}

    async def get_key(self, provider: Provider) -> Optional[KeyState]:
        async with self._lock:
            pool = self._pools.get(provider, [])
            if not pool:
                return None
            start = self._indices[provider]
            n = len(pool)
            for i in range(n):
                idx = (start + i) % n
                ks = pool[idx]
                if ks.is_ready():
                    self._indices[provider] = (idx + 1) % n
                    return ks
            return None

    def mark_success(self, ks: KeyState):
        ks.mark_success()

    def mark_error(self, ks: KeyState, status_code: int = 0):
        if status_code in (401, 403):
            ks.mark_cooldown(HARD_FAIL_COOLDOWN)
        elif status_code == 429:
            ks.mark_cooldown(COOLDOWN_SECONDS)
        elif status_code >= 500:
            ks.mark_cooldown(COOLDOWN_SECONDS // 2)
        else:
            ks.mark_cooldown(10)

    def health(self) -> dict:
        result = {}
        for provider, pool in self._pools.items():
            result[provider.value] = {
                "total_keys": len(pool),
                "available_keys": sum(1 for k in pool if k.is_ready()),
                "keys": [k.to_dict() for k in pool],
            }
        return result

    async def call_gemini(self, model: str, messages: list, temperature: float = 0.7, max_tokens: int = 4096) -> dict:
        url_tpl = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {"contents": messages, "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
        for _ in range(MAX_RETRIES_PER_REQUEST):
            ks = await self.get_key(Provider.GEMINI)
            if not ks:
                raise RuntimeError("All Gemini keys on cooldown")
            url = url_tpl.format(model=model) + f"?key={ks.key}"
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    self.mark_success(ks)
                    return resp.json()
                self.mark_error(ks, resp.status_code)
            except httpx.RequestError:
                ks.mark_cooldown(30)
        raise RuntimeError("Gemini failed after retries")

    async def call_sambanova(self, model: str, messages: list, temperature: float = 0.7, max_tokens: int = 4096) -> dict:
        url = "https://api.sambanova.ai/v1/chat/completions"
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        for _ in range(MAX_RETRIES_PER_REQUEST):
            ks = await self.get_key(Provider.SAMBANOVA)
            if not ks:
                raise RuntimeError("All SambaNova keys on cooldown")
            headers = {"Authorization": f"Bearer {ks.key}", "Content-Type": "application/json"}
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    self.mark_success(ks)
                    return resp.json()
                self.mark_error(ks, resp.status_code)
            except httpx.RequestError:
                ks.mark_cooldown(30)
        raise RuntimeError("SambaNova failed after retries")

    async def call_github_llm(self, model: str, messages: list, temperature: float = 0.7, max_tokens: int = 4096) -> dict:
        url = "https://models.inference.ai.azure.com/chat/completions"
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        for _ in range(MAX_RETRIES_PER_REQUEST):
            ks = await self.get_key(Provider.GITHUB_LLM)
            if not ks:
                raise RuntimeError("All GitHub LLM keys on cooldown")
            headers = {"Authorization": f"Bearer {ks.key}", "Content-Type": "application/json"}
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    self.mark_success(ks)
                    return resp.json()
                self.mark_error(ks, resp.status_code)
            except httpx.RequestError:
                ks.mark_cooldown(30)
        raise RuntimeError("GitHub LLM failed after retries")


router = SmartRouter()
