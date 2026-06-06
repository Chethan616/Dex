"""
browser-control -- the Dex MCP glue for web tasks (browser-use + Playwright).

A FastMCP stdio server that exposes one tool to the Dex agent:

    run_browser_task(goal, url_hint="", timeout_s=180, dry_run=False, headless=False)

Internally builds a `browser_use.Agent` driven by Gemini 2.5 Flash-Lite
(multimodal, ~10x cheaper than Sonnet, fast TTFT), points it at a fresh
isolated Chromium spawned by Playwright, and lets the agent navigate /
click / type its way through the goal. Override with
DEX_BROWSER_PROVIDER=groq|anthropic|openai when you have those keys.

NOT for native Win32 apps -- use run_desktop_task (windows-desktop-control)
for Office / Settings / Calculator and similar. The two SKILL.md files
cross-reference each other so Dex routes correctly.

Refusal patterns, dry-run shape, result envelope, rate-limit retry are
shared with windows-desktop-control via _shared/approval.py.
"""
from __future__ import annotations

import asyncio
import os
import sys
import traceback
from pathlib import Path
from typing import Any

# Make glue/ importable so we can pull in the _shared helpers from a sibling.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _shared.approval import (  # noqa: E402
    BROWSER_REFUSE_PATTERNS,
    check_refusal,
    dry_run_ack,
    new_task_id,
    result,
    serialize_run,
    with_rate_limit_retry,
)

from mcp.server.fastmcp import FastMCP  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]              # D:\project1
LOG_DIR = REPO_ROOT / "vendor" / "browser-use" / "logs" / "dex"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# LLM config -- provider key read from env so it isn't committed.
# Default is Gemini 2.5 Flash-Lite because it's free-tier-friendly,
# multimodal (works for the Phase E vision-assist path), and matches
# the UFO2 agents.yaml template default so one Gemini key drives both
# tools.
# ---------------------------------------------------------------------------
GROQ_MODEL = os.environ.get("DEX_BROWSER_MODEL", "qwen/qwen3-32b")
GROQ_API_KEY_ENV = "GROQ_API_KEY"

# Phase C.6 -- LLM provider selection for browser-use.
#
# DEX_BROWSER_PROVIDER selects which adapter wraps the LLM that drives
# browser-use's per-step planning. Each provider has its own model env
# var + API-key env var for one-line config flips.
#
#   google  (default)   ChatGoogle + gemini-2.5-flash-lite. Free tier on
#                       AI Studio; multimodal; ~200-400ms TTFT. Same
#                       provider UFO2 uses by default.
#   groq                ChatGroq + qwen/qwen3-32b. Free tier; text-only.
#   anthropic           ChatAnthropic + claude-sonnet-4-6. Paid; multimodal.
#   openai              ChatOpenAI + gpt-5. Paid; multimodal.
#
# Default model per provider is picked when DEX_BROWSER_MODEL is unset.
BROWSER_PROVIDER = os.environ.get("DEX_BROWSER_PROVIDER", "google").lower()
BROWSER_PROVIDER_DEFAULT_MODEL = {
    "groq": "qwen/qwen3-32b",
    "google": "gemini-2.5-flash-lite",
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-5",
}
BROWSER_PROVIDER_API_KEY_ENV = {
    "groq": "GROQ_API_KEY",
    "google": "GEMINI_API_KEY",   # AI Studio key; supports openai-compat too
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


def _resolve_browser_llm():
    """Build the browser-use LLM adapter for the selected provider.

    Imports are local so the MCP server can still start (and surface a
    friendly error message) when browser-use's deps aren't installed
    yet. Each branch only imports the adapter it actually needs.
    """
    provider = BROWSER_PROVIDER
    api_key_env = BROWSER_PROVIDER_API_KEY_ENV.get(provider)
    if api_key_env is None:
        raise RuntimeError(
            f"Unknown DEX_BROWSER_PROVIDER={provider!r}. "
            f"Supported: {', '.join(BROWSER_PROVIDER_DEFAULT_MODEL)}",
        )
    api_key = os.environ.get(api_key_env)
    if not api_key:
        raise RuntimeError(
            f"browser-use provider {provider!r} needs env var {api_key_env}.",
        )
    model = os.environ.get(
        "DEX_BROWSER_MODEL",
        BROWSER_PROVIDER_DEFAULT_MODEL[provider],
    )
    if provider == "groq":
        from browser_use import ChatGroq  # type: ignore[import-not-found]
        return ChatGroq(model=model, api_key=api_key)
    if provider == "google":
        from browser_use import ChatGoogle  # type: ignore[import-not-found]
        return ChatGoogle(model=model, api_key=api_key)
    if provider == "anthropic":
        from browser_use import ChatAnthropic  # type: ignore[import-not-found]
        return ChatAnthropic(model=model, api_key=api_key)
    if provider == "openai":
        from browser_use import ChatOpenAI  # type: ignore[import-not-found]
        return ChatOpenAI(model=model, api_key=api_key)
    raise RuntimeError(  # unreachable, kept for type-checker
        f"DEX_BROWSER_PROVIDER={provider!r} fell through provider switch.",
    )

# ---------------------------------------------------------------------------
# FastMCP server
# ---------------------------------------------------------------------------
mcp = FastMCP("browser-control")


@mcp.tool()
def run_browser_task(
    goal: str,
    url_hint: str = "",
    timeout_s: int = 180,
    dry_run: bool = False,
    headless: bool = False,
) -> dict[str, Any]:
    """Drive a web browser to accomplish a natural-language goal.

    Use ONLY for tasks happening INSIDE a webpage: forms, web flows,
    scraping, navigation, typing into rendered text fields. For native
    Windows apps use `run_desktop_task`. For pure file/shell work the agent
    should use its own shell tool instead.

    Do NOT launch a browser via shell first -- this tool spawns its own
    isolated Chromium. Calling `start chrome.exe` then `run_browser_task`
    produces two browser windows.

    Args:
        goal: Plain-language task, e.g. "take the typing test at livechat.com".
        url_hint: Optional starting URL; agent navigates if missing.
        timeout_s: Hard timeout, clamped to [1, 600]. Browser tasks are
            slower than UIA -- default 180 is sensible.
        dry_run: If true, return what would run without executing.
        headless: If true, run Chromium without a visible window. Default
            False so the user can watch what's happening.

    Returns:
        {ok, summary, steps, task_id, log_path}
    """
    task_id = new_task_id("dex-web")

    refusal = check_refusal(goal, BROWSER_REFUSE_PATTERNS)
    if refusal:
        return result(False, f"refused: {refusal}", [], task_id, None)

    timeout_s = max(1, min(int(timeout_s), 600))

    if dry_run:
        return dry_run_ack(goal, task_id, url_hint)

    # Provider-aware key check; e.g. when DEX_BROWSER_PROVIDER=google we need
    # GEMINI_API_KEY, not GROQ_API_KEY.
    required_key_env = BROWSER_PROVIDER_API_KEY_ENV.get(BROWSER_PROVIDER, GROQ_API_KEY_ENV)
    if not os.environ.get(required_key_env):
        return result(
            False,
            f"{required_key_env} env var not set for provider {BROWSER_PROVIDER!r}. "
            f"The MCP server config should include "
            f"`env: {{\"{required_key_env}\": \"...\"}}` (see install-skills.ps1). "
            f"Get a key at: "
            + {
                "groq": "https://console.groq.com/keys",
                "google": "https://aistudio.google.com/app/apikey",
                "anthropic": "https://console.anthropic.com/account/keys",
                "openai": "https://platform.openai.com/api-keys",
            }.get(BROWSER_PROVIDER, "(unknown provider)"),
            [],
            task_id,
            None,
        )

    log_path = LOG_DIR / f"{task_id}.log"
    try:
        # browser-use is async-first; run its event loop synchronously here.
        outcome = asyncio.run(_run_agent(goal, url_hint, timeout_s, headless, log_path))
    except Exception as e:  # noqa: BLE001 -- surface any error to chat
        log_path.write_text(
            serialize_run("browser-use Agent", -1, "", "".join(traceback.format_exception(e))),
            encoding="utf-8",
        )
        return result(False, f"browser-use error: {type(e).__name__}: {e}", [], task_id, log_path)

    return result(outcome["ok"], outcome["summary"], outcome["steps"], task_id, log_path)


async def _run_agent(
    goal: str, url_hint: str, timeout_s: int, headless: bool, log_path: Path,
) -> dict[str, Any]:
    """The browser-use agent run, wrapped in a timeout + single rate-limit retry.

    Imports are local so the MCP server can still start (and surface a
    friendly error) when browser-use's deps aren't installed yet.
    """
    from browser_use import Agent, BrowserSession  # type: ignore[import-not-found]

    # Provider-aware LLM construction (Phase C.6). Falls back to Groq Qwen 3
    # when DEX_BROWSER_PROVIDER is unset.
    llm = _resolve_browser_llm()

    # The browser-use agent reads the task at construction; we prepend the
    # url_hint so the agent navigates there as step 1 if provided.
    task = goal if not url_hint else f"Navigate to {url_hint}. Then: {goal}"

    session = BrowserSession(headless=headless)
    agent = Agent(task=task, llm=llm, browser_session=session, use_vision=False)

    async def _go() -> Any:
        return await asyncio.wait_for(agent.run(), timeout=timeout_s)

    try:
        history = await with_rate_limit_retry(_go)
    except asyncio.TimeoutError:
        await _safe_close(session)
        log_path.write_text(
            serialize_run("browser-use Agent", -1, "", f"timeout after {timeout_s}s"),
            encoding="utf-8",
        )
        return {"ok": False, "summary": f"timeout after {timeout_s}s", "steps": []}

    await _safe_close(session)

    # browser-use returns an AgentHistoryList with per-step records. Be
    # defensive: API names have shifted across releases.
    steps = _extract_steps(history)
    final = _extract_final_text(history) or (steps[-1] if steps else "completed")

    log_path.write_text(
        serialize_run("browser-use Agent", 0, final, "", {"steps": steps}),
        encoding="utf-8",
    )
    return {"ok": True, "summary": final, "steps": steps}


async def _safe_close(session: Any) -> None:
    try:
        close = getattr(session, "close", None) or getattr(session, "kill", None)
        if close:
            res = close()
            if asyncio.iscoroutine(res):
                await res
    except Exception:
        pass


def _extract_steps(history: Any) -> list[str]:
    """Pull per-step labels from browser-use's history. Tolerant of API
    drift across browser-use versions -- we look for a few likely shapes
    and fall back to repr() if none match."""
    out: list[str] = []
    try:
        # newer browser-use exposes .history as a list of records with
        # .action and .extracted_content; older versions named them
        # differently. Look for both.
        records = getattr(history, "history", None) or list(history or [])
        for rec in records:
            label = (
                getattr(rec, "action_repr", None)
                or getattr(rec, "action", None)
                or getattr(rec, "summary", None)
                or getattr(rec, "extracted_content", None)
            )
            if label:
                out.append(str(label)[:200])
    except Exception:
        out.append(repr(history)[:200])
    return out[:50]


def _extract_final_text(history: Any) -> str | None:
    try:
        for getter in ("final_result", "final_message", "result"):
            v = getattr(history, getter, None)
            if callable(v):
                v = v()
            if isinstance(v, str) and v.strip():
                return v.strip()
    except Exception:
        pass
    return None


if __name__ == "__main__":
    mcp.run()  # stdio transport
