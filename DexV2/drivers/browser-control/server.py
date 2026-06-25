"""
browser-control -- the Dex MCP glue for web tasks (browser-use + Playwright).

A FastMCP stdio server that exposes one tool to the Dex agent:

    run_browser_task(goal, url_hint="", timeout_s=180, dry_run=False, headless=False)
"""
from __future__ import annotations

import asyncio
import os
import sys
import traceback
from pathlib import Path
from typing import Any

# Make drivers/ importable so we can pull in the _shared helpers from a sibling.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Make the current folder importable so canvas_detection can always be resolved.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _shared.approval import (  # type: ignore # noqa: E402
    BROWSER_REFUSE_PATTERNS,
    check_refusal,
    dry_run_ack,
    new_task_id,
    result,
    serialize_run,
    with_rate_limit_retry,
)

from mcp.server.fastmcp import FastMCP  # type: ignore # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[3]              # D:\project1
LOG_DIR = REPO_ROOT / "vendor" / "browser-use" / "logs" / "dex"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# LLM config -- provider key read from env so it isn't committed.
# ---------------------------------------------------------------------------
GROQ_MODEL = os.environ.get("DEX_BROWSER_MODEL", "qwen/qwen3-32b")
GROQ_API_KEY_ENV = "GROQ_API_KEY"

BROWSER_PROVIDER = os.environ.get("DEX_BROWSER_PROVIDER", "google").lower()
BROWSER_PROVIDER_DEFAULT_MODEL = {
    "groq": "qwen/qwen3-32b",
    "google": "gemini-2.5-flash-lite",
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-5",
}
BROWSER_PROVIDER_API_KEY_ENV = {
    "groq": "GROQ_API_KEY",
    "google": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}

_QUOTA_PATTERNS = ("RateLimitError", "RESOURCE_EXHAUSTED", "Error code: 429")

_CHROMIUM_EXE_NAMES = {
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "vivaldi.exe",
    "opera.exe",
    "opera_gx.exe",
    "chromium.exe",
    "arc.exe",
}


def _detect_default_browser_executable() -> str | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\Shell\Associations"
            r"\UrlAssociations\http\UserChoice",
        ) as key:
            prog_id = winreg.QueryValueEx(key, "ProgId")[0]
        with winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT, rf"{prog_id}\shell\open\command"
        ) as key:
            command = winreg.QueryValueEx(key, None)[0]
    except OSError:
        return None
    exe = command.split('"')[1] if command.startswith('"') else command.split(" ")[0]
    if Path(exe).name.lower() not in _CHROMIUM_EXE_NAMES or not Path(exe).exists():
        return None
    return exe


def _build_session_kwargs(headless: bool) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"headless": headless}
    explicit_exe = os.environ.get("DEX_BROWSER_EXECUTABLE", "").strip()
    if explicit_exe and Path(explicit_exe).exists():
        kwargs["executable_path"] = explicit_exe
        return kwargs
    channel = os.environ.get("DEX_BROWSER_CHANNEL", "").strip()
    if channel:
        kwargs["channel"] = channel
        return kwargs
    detected = _detect_default_browser_executable()
    if detected:
        kwargs["executable_path"] = detected
    return kwargs


def _resolve_browser_llm():
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
        from browser_use import ChatGroq  # type: ignore
        return ChatGroq(model=model, api_key=api_key)
    if provider == "google":
        from browser_use import ChatGoogle  # type: ignore
        return ChatGoogle(model=model, api_key=api_key)
    if provider == "anthropic":
        from browser_use import ChatAnthropic  # type: ignore
        return ChatAnthropic(model=model, api_key=api_key)
    if provider == "openai":
        from browser_use import ChatOpenAI  # type: ignore
        return ChatOpenAI(model=model, api_key=api_key)
    raise RuntimeError(
        f"DEX_BROWSER_PROVIDER={provider!r} fell through provider switch.",
    )


# ---------------------------------------------------------------------------
# FastMCP server
# ---------------------------------------------------------------------------
mcp = FastMCP("browser-control")


@mcp.tool()
async def run_browser_task(
    goal: str,
    url_hint: str = "",
    timeout_s: int = 180,
    dry_run: bool = False,
    headless: bool = False,
) -> dict[str, Any]:
    """Drive a web browser to accomplish a natural-language goal.

    Use ONLY for tasks happening INSIDE a webpage: forms, web flows,
    scraping, typing into rendered text fields.

    Args:
        goal: Plain-language task, e.g. "take the typing test at livechat.com".
        url_hint: Optional starting URL.
        timeout_s: Hard timeout in seconds, clamped to [1, 600]. Default 180s.
        dry_run: If true, return what would run without executing.
        headless: If true, run Chromium without a visible window.

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

    required_key_env = BROWSER_PROVIDER_API_KEY_ENV.get(BROWSER_PROVIDER, GROQ_API_KEY_ENV)
    if not os.environ.get(required_key_env):
        return result(
            False,
            f"{required_key_env} env var not set for provider {BROWSER_PROVIDER!r}. "
            f"Set the key so that browser-use can authenticate.",
            [],
            task_id,
            None,
        )

    log_path = LOG_DIR / f"{task_id}.log"
    try:
        outcome = await _run_agent(goal, url_hint, timeout_s, headless, log_path)
    except Exception as e:  # noqa: BLE001 -- surface any error to chat
        err_text = "".join(traceback.format_exception(e))
        log_path.write_text(
            serialize_run("browser-use Agent", -1, "", err_text),
            encoding="utf-8",
        )
        if any(p in err_text for p in _QUOTA_PATTERNS):
            return result(
                False,
                "LLM quota exhausted -- the browser model returned 429. "
                "Switch DEX_BROWSER_PROVIDER / DEX_BROWSER_MODEL or wait for quota reset.",
                [],
                task_id,
                log_path,
            )
        return result(False, f"browser-use error: {type(e).__name__}: {e}", [], task_id, log_path)

    return result(outcome["ok"], outcome["summary"], outcome["steps"], task_id, log_path)


async def _run_agent(
    goal: str, url_hint: str, timeout_s: int, headless: bool, log_path: Path,
) -> dict[str, Any]:
    from browser_use import Agent, BrowserSession  # type: ignore
    from canvas_detection import make_canvas_hint  # type: ignore

    llm = _resolve_browser_llm()
    task = goal if not url_hint else f"Navigate to {url_hint}. Then: {goal}"

    canvas_hint = make_canvas_hint(url_hint) if url_hint else None
    if canvas_hint:
        task = f"{canvas_hint}\n\n{task}"

    use_vision = BROWSER_PROVIDER != "groq"
    session = BrowserSession(**_build_session_kwargs(headless))
    agent = Agent(task=task, llm=llm, browser_session=session, use_vision=use_vision)

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
    out: list[str] = []
    try:
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
    mcp.run()
