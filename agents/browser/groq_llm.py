"""Small Groq chat-completions client for the Python browser runner."""
from __future__ import annotations

import os
from typing import Any

import httpx


class ChatGroq:
    """Expose the same minimal ``ainvoke`` shape used by AgentRunner."""

    def __init__(self, mode: str | None = None, model: str | None = None) -> None:
        self.api_key = os.environ.get("GROQ_API_KEY", "").strip()
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY is not available to the browser agent")
        self.model = (
            model
            or os.environ.get("DEX_BROWSER_MODEL", "").strip()
            or os.environ.get("DEX_BRAIN_MODEL", "").strip()
            or "openai/gpt-oss-120b"
        )
        self.mode = mode or "smart"
        self.name = f"groq/{self.model}"

    async def ainvoke(self, messages: list[dict[str, Any]], **_: Any) -> "GroqCompletion":
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0,
                    "max_tokens": 800,
                },
            )
        if response.status_code >= 400:
            detail = response.text[:400]
            raise RuntimeError(f"{self.name} returned HTTP {response.status_code}: {detail}")
        payload = response.json()
        choices = payload.get("choices") if isinstance(payload, dict) else None
        content = ""
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            content = message.get("content", "") if isinstance(message, dict) else ""
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError(f"{self.name} returned no text completion")
        return GroqCompletion(content.strip())

class GroqCompletion:
    def __init__(self, content: str) -> None:
        self.content = content

    def __str__(self) -> str:
        return self.content
