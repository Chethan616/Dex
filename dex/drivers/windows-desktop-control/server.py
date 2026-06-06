"""
windows-desktop-control -- the Dex MCP glue for native Windows GUIs (UFO2).

A FastMCP stdio server that exposes one tool to the Dex agent:

    run_desktop_task(goal, app_hint="", timeout_s=120, dry_run=False)

It launches Microsoft UFO2 as a subprocess to drive Windows GUIs by their
accessibility tree, returns a structured summary the LLM can read, and
enforces a hard timeout. UFO2 itself is configured to use a text-only LLM
(Groq Qwen 3) in UIA-grounded mode.

NOT for browser tasks -- use run_browser_task (browser-control MCP) for
anything happening inside a webpage. Cross-referenced in SKILL.md.

Refusal patterns, dry-run shape, result envelope, log serialization are
shared with browser-control via glue/_shared/approval.py so the two tool
families stay in lockstep.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

# Make glue/ importable so we can pull in the _shared helpers from a sibling.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _shared.approval import (  # noqa: E402 (path manipulation must precede import)
    check_refusal,
    dry_run_ack,
    new_task_id,
    result,
    serialize_run,
    serialize_timeout,
)

from mcp.server.fastmcp import FastMCP  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]                # D:\project1
UFO_ROOT = REPO_ROOT / "vendor" / "UFO"
UFO_VENV_PY = UFO_ROOT / ".venv" / "Scripts" / "python.exe"
LOG_DIR = REPO_ROOT / "vendor" / "UFO" / "logs" / "dex"
LOG_DIR.mkdir(parents=True, exist_ok=True)

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

    Use ONLY for tasks that need a real native Win32 app's GUI: Office,
    Calculator, Settings panels, file dialogs, etc. For browser tasks use
    `run_browser_task`. For pure file/shell work the agent should use its
    own shell tool instead.

    Args:
        goal: Plain-language task, e.g. "in Excel, sum column B".
        app_hint: Optional app to focus first, e.g. "Excel".
        timeout_s: Hard timeout, clamped to [1, 600].
        dry_run: If true, return what would run without executing.

    Returns:
        {ok, summary, steps, task_id, log_path}
    """
    task_id = new_task_id("dex")

    refusal = check_refusal(goal)
    if refusal:
        return result(False, f"refused: {refusal}", [], task_id, None)

    timeout_s = max(1, min(int(timeout_s), 600))

    if dry_run:
        return dry_run_ack(goal, task_id, app_hint)

    py = _resolve_python()
    if py is None:
        return result(
            False,
            "UFO2 Python not found. Install Python 3.10/3.11, create venv at "
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

    # UFO2 writes emoji + checkmarks to stdout; on Windows the default
    # console codepage is cp1252 which can't encode them, so the subprocess
    # crashes mid-run with UnicodeEncodeError. PYTHONIOENCODING=utf-8 forces
    # the child Python to use UTF-8 for its own sys.stdout / sys.stderr,
    # matching our subprocess.run(encoding="utf-8") side. PYTHONUNBUFFERED
    # gives us prompt log lines for debugging if a hang ever recurs.
    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
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
            env=child_env,
        )
    except subprocess.TimeoutExpired as e:
        log_path.write_text(serialize_timeout(e), encoding="utf-8")
        return result(False, f"timeout after {timeout_s}s", [], task_id, log_path)
    except FileNotFoundError as e:
        return result(False, f"failed to launch UFO2 ({e})", [], task_id, None)

    log_path.write_text(
        serialize_run(cmd, proc.returncode, proc.stdout, proc.stderr),
        encoding="utf-8",
    )

    summary, steps = _summarize(proc.stdout, proc.stderr, proc.returncode)
    return result(proc.returncode == 0, summary, steps, task_id, log_path)


# ---------------------------------------------------------------------------
# Helpers (UFO2-specific; shared helpers live in _shared.approval)
# ---------------------------------------------------------------------------
def _resolve_python() -> Path | None:
    if UFO_VENV_PY.exists():
        return UFO_VENV_PY
    return Path(sys.executable) if Path(sys.executable).exists() else None


def _summarize(stdout: str, stderr: str, rc: int) -> tuple[str, list[str]]:
    """UFO2 logs verbosely to its own files; stdout is normally quiet at
    WARNING. When something does print, surface the tail."""
    tail = (stdout.strip().splitlines() or stderr.strip().splitlines())[-5:]
    if rc == 0:
        head = tail[-1] if tail else "completed"
        return head, tail
    return f"UFO2 exited with code {rc}", tail


if __name__ == "__main__":
    mcp.run()  # stdio transport
