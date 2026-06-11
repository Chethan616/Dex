"""
windows-desktop-control -- the Dex MCP glue for native Windows GUIs (UFO2).

A FastMCP stdio server that exposes one tool to the Dex agent:

    run_desktop_task(goal, app_hint="", timeout_s=300, dry_run=False)

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

import os
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
# Phase B moved this from `glue/windows-desktop-control/server.py` (parents[2]
# was the repo root) to `dex/drivers/windows-desktop-control/server.py` --
# parents[3] is now the repo root. The old `parents[2]` resolved to
# `D:\project1\dex` and pointed UFO_ROOT / LOG_DIR at a phantom tree, so the
# subprocess.run() below spawned `python -m ufo` from an empty directory and
# crashed with ImportError before UFO2 could load. The agent saw that as
# "GUI tool keeps timing out".
REPO_ROOT = Path(__file__).resolve().parents[3]                # D:\project1
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
    timeout_s: int = 300,
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
        timeout_s: Hard timeout in seconds, clamped to [1, 600]. Default
            300s because UFO2 runs Gemini Flash-Latest through an OpenAI-
            compatible client and a single multimodal planning step
            commonly takes 30-60s on the free tier; 5 minutes leaves room
            for 4-5 sequential steps. Bump higher only if you're on a
            slower tier; UFO2 can also hit Windows kill-tree quirks above
            10 min.
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
        # Surface the LAST partial stdout/stderr the subprocess managed to
        # write before we killed it. Previously the result was just
        # "timeout after Ns" with empty steps -- the Flutter Activity card
        # then had nothing actionable. Now the user sees the round/step
        # UFO2 was on (e.g. "Round 1, Step 1, Agent: HostAgent") so they
        # know whether Gemini hung at planning or at action.
        partial_stdout = (e.stdout or b"").decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        partial_stderr = (e.stderr or b"").decode("utf-8", errors="replace") if isinstance(e.stderr, bytes) else (e.stderr or "")
        tail_lines: list[str] = []
        for source in (partial_stdout, partial_stderr):
            tail_lines.extend(line for line in source.strip().splitlines()[-8:] if line.strip())
        last_progress = next(
            (l for l in reversed(tail_lines) if "Round" in l or "Step" in l or "Phase" in l),
            None,
        )
        summary = f"timeout after {timeout_s}s"
        if last_progress:
            summary = f"{summary} (last progress: {last_progress.strip()[:120]})"
        return result(False, summary, tail_lines[-6:], task_id, log_path)
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
    WARNING. When something does print, surface the tail. On non-zero
    exits we always also surface stderr so the Flutter Activity card
    shows the actual Python traceback / authlib warning / Gemini API
    error instead of just 'UFO2 exited with code N'."""
    if rc == 0:
        tail = (stdout.strip().splitlines() or stderr.strip().splitlines())[-5:]
        head = tail[-1] if tail else "completed"
        return head, tail
    stderr_tail = stderr.strip().splitlines()[-8:]
    stdout_tail = stdout.strip().splitlines()[-4:]
    # Pick the most useful single-line summary -- prefer the last stderr
    # line (Python errors land there), fall back to stdout tail.
    head_line = (stderr_tail[-1] if stderr_tail else (stdout_tail[-1] if stdout_tail else "")).strip()
    summary = f"UFO2 exited with code {rc}"
    if head_line:
        summary = f"{summary}: {head_line[:140]}"
    return summary, stdout_tail + stderr_tail


def _warm_up_ufo() -> None:
    """Fire-and-forget `python -m ufo --help` at server startup.

    UFO2 imports are ~3s warm but MINUTES on a cold machine: Windows
    Defender real-time scans every .py/.pyd in the venv on first load
    after boot, and the first real task pays that bill inside its
    timeout_s budget (observed: a 300s run that never reached step 1).
    Warming at server start moves the scan + bytecode caching to gateway
    boot, where nobody is waiting on a reply.
    """
    try:
        subprocess.Popen(
            [str(UFO_VENV_PY), "-m", "ufo", "--help"],
            cwd=str(UFO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        pass  # venv missing -- run_desktop_task surfaces the real error.


if __name__ == "__main__":
    _warm_up_ufo()
    mcp.run()  # stdio transport
