"""
Worker LLM providers for the desktop agent's "what's the single next action"
decision — the one piece of agents/desktop/agent_loop.py that was hardcoded
to Anthropic. Three implementations behind one `decide()` shape, so the loop
itself doesn't know or care which one answered, the same principle
agents/browser/agent_runner.py already applies via `_get_llm`.

The schema and system prompt live here, not in agent_loop.py, because
they're the provider-facing contract every implementation has to satisfy —
agent_loop.py imports them from here, not the other way around, so there's
no circular import between "the loop" and "what answers it."
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Protocol

log = logging.getLogger("WorkerProviders")

WORKER_SYSTEM = """\
You are Dex, operating a Windows computer directly — the way a person would:
looking at the screen and using the mouse and keyboard. You receive a
screenshot of the current screen and must decide the SINGLE next action
toward completing the ENTIRE task, not just one small piece of it.

You own the whole task. Nothing else has done any preparation for you —
if it needs an app open, open it; if it needs a terminal or Settings, open
those yourself the way a technically-savvy person would, then type/click
inside them like any other window. There is no separate "system" tool to
call for this — everything is click, type, key, scroll, or open_app.

Rules:
- Output exactly ONE action per call using take_gui_action.
- Be specific about UI targets — describe what you see on screen.
- To enter text: click the target field first, then use a separate type action.
- Prefer keyboard shortcuts over menu navigation when possible (Ctrl+S to save, etc.).
- Before repeating an action that didn't change anything last time, try something
  different — a different target, a different approach, or waiting a moment.
- When the full task is complete, output action_type="done".
- If stuck after repeated attempts, output action_type="failed" with a clear reason.\
"""

WORKER_TOOL = {
    "name": "take_gui_action",
    "description": "Decide and describe the next GUI action to take",
    "input_schema": {
        "type": "object",
        "properties": {
            "reasoning": {
                "type": "string",
                "description": "One-sentence explanation of why this action is next",
            },
            "action_type": {
                "type": "string",
                "enum": [
                    "click", "double_click", "right_click",
                    "type", "key", "scroll",
                    "open_app", "done", "failed",
                ],
            },
            "target_description": {
                "type": "string",
                "description": "Natural language description of the UI element to interact with",
            },
            "text": {
                "type": "string",
                "description": "Exact text to type (for action_type=type)",
            },
            "key_combo": {
                "type": "string",
                "description": 'Key combination to press, e.g. "ctrl+s", "enter", "alt+f4"',
            },
            "app_name": {
                "type": "string",
                "description": "Application name to open (for action_type=open_app)",
            },
            "scroll_direction": {
                "type": "string",
                "enum": ["up", "down", "left", "right"],
            },
            "scroll_amount": {"type": "integer", "default": 3},
            "failure_reason": {
                "type": "string",
                "description": "Why the task cannot be completed (for action_type=failed)",
            },
        },
        "required": ["reasoning", "action_type"],
    },
}


class WorkerProvider(Protocol):
    name: str

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict[str, Any]:
        """A dict matching WORKER_TOOL's schema, never raises — callers treat
        an unparseable/failed reply as one 'failed' action, not an exception."""
        ...


def _prompt(task: str, history: str) -> str:
    return f"Task: {task}{history}\n\nWhat is the single next action?"


class AnthropicWorker:
    """Today's behavior, unchanged — extracted out of agent_loop.py."""

    def __init__(self, api_key: str, model: str | None = None):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = (
            model
            or os.environ.get("DEX_DESKTOP_WORKER_MODEL", "").strip()
            or "claude-sonnet-4-6"
        )
        self.name = f"anthropic/{self.model}"

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict[str, Any]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=512,
            system=WORKER_SYSTEM,
            tools=[WORKER_TOOL],
            tool_choice={"type": "any"},
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64},
                    },
                    {"type": "text", "text": _prompt(task, history)},
                ],
            }],
        )
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if not tool_use:
            return {"action_type": "failed", "failure_reason": "Worker returned no action", "reasoning": "", "_provider_error": True}
        return tool_use.input  # type: ignore[return-value]


class GroqVisionWorker:
    """
    A vision-capable Groq model, asked for JSON in the prompt rather than
    native tool-calling — the same convention agents/browser/agent_runner.py
    already uses successfully for its (text-only) Groq decisions, kept
    consistent here rather than betting on tool-calling+vision support that
    varies across Groq's rotating model lineup.
    """

    def __init__(self, api_key: str, model: str | None = None):
        self.api_key = api_key
        self.model = (
            model
            or os.environ.get("DEX_DESKTOP_WORKER_MODEL", "").strip()
            # Confirmed live (real screenshot -> correct description) at
            # implementation time. Groq's vision-capable lineup changes over
            # time — this is a checked-working default, never assumed
            # permanent; DEX_DESKTOP_WORKER_MODEL overrides it.
            or "qwen/qwen3.6-27b"
        )
        self.name = f"groq/{self.model}"

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict[str, Any]:
        import httpx

        schema_text = json.dumps(WORKER_TOOL["input_schema"], indent=2)
        prompt = (
            f"{WORKER_SYSTEM}\n\n{_prompt(task, history)}\n\n"
            f"Return ONLY a valid JSON object matching this schema, nothing else:\n{schema_text}"
        )
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"}},
            ],
        }]

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0,
                    # Reasoning models on Groq (this one included) emit a
                    # <think>...</think> trace before the actual answer —
                    # 500 tokens was cutting that off mid-thought with no
                    # JSON ever produced. reasoning_effort trims the trace
                    # itself; max_tokens still needs real headroom in case
                    # a provider/model ignores that hint.
                    "max_tokens": 2000,
                    # This model only accepts "none" or "default" — "none"
                    # skips the <think> trace entirely, which is what we
                    # want: a one-action decision doesn't need visible
                    # chain-of-thought, just the answer.
                    "reasoning_effort": "none",
                },
            )
        if response.status_code >= 400:
            log.warning(f"{self.name} returned HTTP {response.status_code}: {response.text[:300]}")
            return {"action_type": "failed", "failure_reason": f"Worker HTTP {response.status_code}", "reasoning": "", "_provider_error": True}

        payload = response.json()
        choices = payload.get("choices") if isinstance(payload, dict) else None
        text = ""
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            text = message.get("content", "") if isinstance(message, dict) else ""

        parsed = _parse_worker_json(text)
        if parsed is None:
            return {"action_type": "failed", "failure_reason": "Worker returned unparseable output", "reasoning": "", "_provider_error": True}
        return parsed


class ClaudeCodeWorker:
    """Thin wrapper over the already-proven image-capable Claude Code CLI client."""

    def __init__(self, mode: str = "smart"):
        from claude_code_llm import ChatClaudeCode
        self._client = ChatClaudeCode(mode=mode)
        self.name = f"claude-code/{getattr(self._client, 'model', 'default')}"

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": WORKER_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"}},
                    {"type": "text", "text": _prompt(task, history)},
                ],
            },
        ]
        try:
            response = await self._client.ainvoke(messages, output_format=WORKER_TOOL["input_schema"])
        except Exception as err:
            log.warning(f"{self.name} decide failed: {err}")
            return {"action_type": "failed", "failure_reason": str(err), "reasoning": "", "_provider_error": True}
        content = response.content
        if isinstance(content, dict):
            return content
        return {"action_type": "failed", "failure_reason": "Worker returned unparseable output", "reasoning": "", "_provider_error": True}


def _parse_worker_json(text: str) -> dict[str, Any] | None:
    """
    The outermost {...} in a reply, tolerant of a stray sentence around it
    and of a reasoning model's <think>...</think> trace in front of the
    answer (stripped first, so a } inside the reasoning can't be mistaken
    for the end of the JSON object).
    """
    stripped = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(stripped[start:end + 1])
    except json.JSONDecodeError:
        return None


def make_worker(api_key: str = "") -> WorkerProvider:
    """
    Picks a Worker the same way agent_runner.py picks its browser LLM:
    configured provider first, then whichever credential is actually present.
    Raises with a clear message naming what was tried, rather than a bare
    "no provider" the caller has to decode — mirrors make_grounding's
    exit-with-a-real-error convention in grounding.py.
    """
    from provider_select import configured_provider

    tried: list[str] = []
    provider = configured_provider()

    if provider == "claude-code" or (not provider and _claude_code_available()):
        tried.append("claude-code")
        try:
            return ClaudeCodeWorker()
        except Exception as err:  # noqa: BLE001
            log.warning(f"Claude Code CLI worker unavailable: {err}")

    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if provider == "groq" or (not provider and groq_key):
        tried.append("groq")
        if groq_key:
            return GroqVisionWorker(groq_key)

    if api_key:
        tried.append("anthropic")
        return AnthropicWorker(api_key)

    raise RuntimeError(
        "No vision-capable Worker provider available "
        f"(tried: {', '.join(tried) or 'none configured'}). "
        "Set GROQ_API_KEY, ANTHROPIC_API_KEY, or install the claude CLI."
    )


def _claude_code_available() -> bool:
    import shutil
    return shutil.which("claude") is not None
