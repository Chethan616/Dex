"""
Shared pre-action helpers for Dex MCP servers.

This module is imported by both `glue/windows-desktop-control/server.py`
(UFO2 driver) and `glue/browser-control/server.py` (browser-use driver) so
the refusal list, the dry-run protocol, the structured result shape, and
the rate-limit retry are uniform across tool families.

Why a shared module: per the v1.1 plan section 8.4b, the approval gate must
have parity across tool families -- if `run_desktop_task` checks for
destructive patterns and `run_browser_task` doesn't, security drifts. This
file is the single source of truth for those rules.

v1.1 reality: the "gate" is convention-based at the chat layer
(SKILL.md tells Claude to ask for approval; Flutter's ConversationStore
heuristically extracts the plan and shows the Action Preview card). What
this module enforces server-side is:
  1. A refusal list -- destructive patterns return ok=False immediately
  2. A canonical dry-run response shape -- both tools answer identically
  3. A canonical result shape -- the Flutter renderer treats both tool
     families the same way
  4. A retry-on-429 helper for the shared Groq endpoint (both tools may
     run concurrently against one free-tier key)
"""
from __future__ import annotations

import asyncio
import json
import re
import shlex
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

# ---------------------------------------------------------------------------
# Refusal list -- shared between tool families. Patterns are intentionally
# narrow; the primary defense is the user approval step in chat. This list
# is the second-to-last line of defense for goals the user typed but
# probably didn't think through.
# ---------------------------------------------------------------------------
COMMON_REFUSE_PATTERNS: list[str] = [
    r"\bformat\s+[a-zA-Z]:",
    r"\bdelete\s+all\b",
    r"\bwipe\b.*\bdrive\b",
    r"\bfactory\s+reset\b",
    r"\bbitlocker\b",
    r"\bregedit\b.*\b(delete|remove|wipe)\b",
    r"\bdisable\b.*\b(antivirus|defender|firewall|uac)\b",
    r"\binstall\s+.*\.exe\b",
]

# Browser-specific additions (8.3 step 5 of the plan).
BROWSER_REFUSE_PATTERNS: list[str] = [
    r"\blog\s*in\s+to\s+(?:my\s+)?(?:bank|banking|chase|wells|paypal|venmo)\b",
    r"\b(?:send|transfer|wire)\s+(?:\$|usd|money|funds)\b",
    r"\b(?:tweet|post|publish)\b.*\b(?:public|to\s+everyone)\b",
    r"\bcaptcha\b",
]


def check_refusal(goal: str, extra_patterns: list[str] | None = None) -> str | None:
    """Return a refusal reason if `goal` matches a destructive pattern, else None."""
    low = goal.lower()
    patterns = COMMON_REFUSE_PATTERNS + (extra_patterns or [])
    for pat in patterns:
        if re.search(pat, low):
            return (
                f"goal matches refusal pattern /{pat}/ -- "
                "destructive or sensitive operations require explicit user confirmation"
            )
    return None


# ---------------------------------------------------------------------------
# Result shape -- both `run_desktop_task` and `run_browser_task` return the
# same dict so the Flutter `Action` card renderer treats them uniformly.
# ---------------------------------------------------------------------------
def new_task_id(prefix: str = "dex") -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}-{stamp}-{uuid.uuid4().hex[:6]}"


def result(
    ok: bool,
    summary: str,
    steps: list[str],
    task_id: str,
    log_path: Path | str | None = None,
) -> dict[str, Any]:
    """Canonical result envelope. See plan section 8.3 step 4."""
    return {
        "ok": ok,
        "summary": summary,
        "steps": steps,
        "task_id": task_id,
        "log_path": str(log_path) if log_path else "",
    }


def dry_run_ack(goal: str, task_id: str, app_or_url_hint: str = "") -> dict[str, Any]:
    """Canonical dry-run response. v1 limitation: neither tool family has a
    native planner-only mode, so dry_run echoes the goal so the Flutter
    Action Preview can at least surface what was asked."""
    steps = [f"would-run: {goal}"]
    if app_or_url_hint:
        steps.append(f"context: {app_or_url_hint}")
    return result(True, "dry-run acknowledged (no execution in v1)", steps, task_id, None)


# ---------------------------------------------------------------------------
# Rate-limit retry (plan risk 5). Both tools share one Groq key; concurrent
# runs may 429 each other. One retry with backoff, surfaced as failed if
# it persists.
# ---------------------------------------------------------------------------
T = TypeVar("T")


async def with_rate_limit_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    backoff_s: float = 2.0,
    is_rate_limited: Callable[[BaseException], bool] | None = None,
) -> T:
    """Run `fn()` once. If it raises a rate-limit error, sleep `backoff_s`
    and try once more. Otherwise re-raise.

    `is_rate_limited` lets each caller plug in their LLM SDK's specific
    exception detector. Default: any exception whose repr contains '429'
    or 'rate' is treated as rate-limited.
    """
    if is_rate_limited is None:
        def is_rate_limited(e: BaseException) -> bool:  # type: ignore[no-redef]
            text = repr(e).lower()
            return "429" in text or "rate" in text and "limit" in text

    try:
        return await fn()
    except BaseException as e:  # noqa: BLE001 -- we re-raise after the retry
        if not is_rate_limited(e):
            raise
        await asyncio.sleep(backoff_s)
        return await fn()


# ---------------------------------------------------------------------------
# Log serialization -- same JSON envelope both tools write under their
# vendor's logs/ dir, so a developer reading either log learns nothing
# tool-specific they'd have to relearn.
# ---------------------------------------------------------------------------
def serialize_run(
    cmd: list[str] | str,
    rc: int | None,
    stdout: str,
    stderr: str,
    extra: dict[str, Any] | None = None,
) -> str:
    payload = {
        "cmd": " ".join(shlex.quote(c) for c in cmd) if isinstance(cmd, list) else cmd,
        "returncode": rc,
        "stdout": stdout,
        "stderr": stderr,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        payload.update(extra)
    return json.dumps(payload, indent=2)


def serialize_timeout(e: subprocess.TimeoutExpired) -> str:
    return json.dumps(
        {
            "timeout_s": e.timeout,
            "cmd": (
                " ".join(shlex.quote(c) for c in (e.cmd or []))
                if isinstance(e.cmd, list)
                else str(e.cmd)
            ),
            "stdout_tail": (e.stdout or b"").decode("utf-8", errors="replace")[-2000:]
            if isinstance(e.stdout, (bytes, bytearray))
            else (e.stdout or "")[-2000:],
            "stderr_tail": (e.stderr or b"").decode("utf-8", errors="replace")[-2000:]
            if isinstance(e.stderr, (bytes, bytearray))
            else (e.stderr or "")[-2000:],
            "ts": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )
