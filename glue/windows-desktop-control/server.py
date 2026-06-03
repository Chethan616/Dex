"""
windows-desktop-control — the Dex MCP glue.

A FastMCP stdio server that exposes one tool to the OpenClaw agent:

    run_desktop_task(goal, app_hint="", timeout_s=120, dry_run=False)

It launches Microsoft UFO² as a subprocess to drive Windows GUIs by their
accessibility tree, returns a structured summary the LLM can read, and
enforces a hard timeout. UFO² itself is configured to use a text-only LLM
(Groq Qwen 3) in UIA-grounded mode — no screenshots leave the box unless
the user explicitly opts into vision mode.

Design rules (from prompt.md §8): stays under ~200 lines, no heavy deps,
uses UFO²'s own venv where possible.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]                # D:\project1
UFO_ROOT = REPO_ROOT / "vendor" / "UFO"
UFO_VENV_PY = UFO_ROOT / ".venv" / "Scripts" / "python.exe"    # Windows venv layout
LOG_DIR = REPO_ROOT / "vendor" / "UFO" / "logs" / "dex"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Refusal patterns — see SECURITY.md §"Refusal list"
# ---------------------------------------------------------------------------
REFUSE_PATTERNS = [
    r"\bformat\s+[a-zA-Z]:",
    r"\bdelete\s+all\b",
    r"\bwipe\b.*\bdrive\b",
    r"\bfactory\s+reset\b",
    r"\bbitlocker\b",
    r"\bregedit\b.*\b(delete|remove|wipe)\b",
    r"\bdisable\b.*\b(antivirus|defender|firewall|uac)\b",
    r"\binstall\s+.*\.exe\b",
]

# ---------------------------------------------------------------------------
# FastMCP server
# ---------------------------------------------------------------------------
mcp = FastMCP("windows-desktop-control")


@mcp.tool()
def run_desktop_task(
    goal: str,
    app_hint: str = "",
    timeout_s: int = 120,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Drive a Windows application GUI to accomplish a natural-language goal.

    Use ONLY for tasks that need a real app's GUI (Office, Photoshop, settings
    panels, a browser UI, etc.). For pure file/shell work, the agent should
    use its own shell tool instead.

    Args:
        goal: Plain-language task description, e.g. "in Excel, sum column B".
        app_hint: Optional app to focus first, e.g. "Excel".
        timeout_s: Hard timeout in seconds (1-600).
        dry_run: If true, return what *would* run without executing. v1
            limitation: UFO² has no native planner-only mode, so dry_run
            returns the goal echoed back without a fine-grained plan. The
            Flutter Action Preview surface uses the agent's natural-language
            plan from the prior turn instead.

    Returns:
        dict with keys: ok (bool), summary (str), steps (list[str]),
        log_path (str), task_id (str).
    """
    task_id = f"dex-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}"

    refuse = _check_refusal(goal)
    if refuse:
        return _result(False, f"refused: {refuse}", [], task_id, None)

    timeout_s = max(1, min(int(timeout_s), 600))

    if dry_run:
        return _result(
            True,
            "dry-run acknowledged (no execution in v1)",
            [f"would-run: {goal}"] + ([f"focus-hint: {app_hint}"] if app_hint else []),
            task_id,
            None,
        )

    py = _resolve_python()
    if py is None:
        return _result(
            False,
            "UFO² Python not found. Install Python 3.10/3.11, create venv at "
            "vendor/UFO/.venv, then `pip install -r vendor/UFO/requirements.txt`.",
            [],
            task_id,
            None,
        )

    request = goal if not app_hint else f"In {app_hint}, {goal}"

    cmd = [
        str(py), "-m", "ufo",
        "-t", task_id,
        "-r", request,
        "-m", "normal",
        "--log-level", "WARNING",
    ]

    log_path = LOG_DIR / f"{task_id}.log"

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(UFO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        log_path.write_text(_serialize_timeout(e), encoding="utf-8")
        return _result(False, f"timeout after {timeout_s}s", [], task_id, log_path)
    except FileNotFoundError as e:
        return _result(False, f"failed to launch UFO² ({e})", [], task_id, None)

    log_path.write_text(
        _serialize_run(cmd, proc.returncode, proc.stdout, proc.stderr),
        encoding="utf-8",
    )

    summary, steps = _summarize(proc.stdout, proc.stderr, proc.returncode)
    return _result(proc.returncode == 0, summary, steps, task_id, log_path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _resolve_python() -> Path | None:
    if UFO_VENV_PY.exists():
        return UFO_VENV_PY
    # Fall back to whatever python the MCP host launched us with — only if
    # it can import ufo. We do *not* probe the import here; failure surfaces
    # in subprocess stderr and is captured in the log.
    return Path(sys.executable) if Path(sys.executable).exists() else None


def _check_refusal(goal: str) -> str | None:
    low = goal.lower()
    for pat in REFUSE_PATTERNS:
        if re.search(pat, low):
            return f"goal matches refusal pattern /{pat}/ — destructive operations require explicit user confirmation"
    return None


def _summarize(stdout: str, stderr: str, rc: int) -> tuple[str, list[str]]:
    """Extract a short status and step list from UFO² output.

    UFO² writes its trajectory to its own log files; stdout here is normally
    quiet (LOG_LEVEL=WARNING). When something does print to stdout/stderr we
    surface the tail as the summary.
    """
    tail = (stdout.strip().splitlines() or stderr.strip().splitlines())[-5:]
    if rc == 0:
        head = tail[-1] if tail else "completed"
        return head, tail
    return f"UFO² exited with code {rc}", tail


def _result(ok: bool, summary: str, steps: list[str], task_id: str, log: Path | None) -> dict[str, Any]:
    return {
        "ok": ok,
        "summary": summary,
        "steps": steps,
        "task_id": task_id,
        "log_path": str(log) if log else "",
    }


def _serialize_run(cmd: list[str], rc: int, stdout: str, stderr: str) -> str:
    return json.dumps(
        {
            "cmd": " ".join(shlex.quote(c) for c in cmd),
            "returncode": rc,
            "stdout": stdout,
            "stderr": stderr,
            "ts": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


def _serialize_timeout(e: subprocess.TimeoutExpired) -> str:
    return json.dumps(
        {
            "timeout_s": e.timeout,
            "cmd": " ".join(shlex.quote(c) for c in (e.cmd or [])),
            "stdout_tail": (e.stdout or b"").decode("utf-8", errors="replace")[-2000:],
            "stderr_tail": (e.stderr or b"").decode("utf-8", errors="replace")[-2000:],
            "ts": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )


if __name__ == "__main__":
    mcp.run()  # stdio transport
