"""
windows-desktop-control -- the Dex MCP glue for native Windows GUIs (UFO2).

A FastMCP stdio server that exposes one tool to the Dex agent:

    run_desktop_task(goal, app_hint="", timeout_s=300, dry_run=False)

It launches Microsoft UFO2 as a subprocess to drive Windows GUIs by their
accessibility tree, returns a structured summary the LLM can read, and
enforces a hard timeout.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

# Make drivers/ importable so we can pull in the _shared helpers from a sibling.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Make the current folder importable.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _shared.approval import (  # noqa: E402 (path manipulation must precede import)
    check_refusal,
    dry_run_ack,
    new_task_id,
    result,
    serialize_run,
)

from mcp.server.fastmcp import FastMCP  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[3]                # D:\project1
_ufo_root_env = os.environ.get("DEX_UFO_ROOT", "").strip()
UFO_ROOT = Path(_ufo_root_env) if _ufo_root_env else REPO_ROOT / "vendor" / "UFO"
UFO_VENV_PY = UFO_ROOT / ".venv" / "Scripts" / "python.exe"
LOG_DIR = UFO_ROOT / "logs" / "dex"
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

    Use ONLY to INTERACT with an already-relevant native Win32 app's GUI:
    Office, Calculator, Settings panels, file dialogs, etc.

    DO NOT use this just to OPEN/LAUNCH an app. "open notepad", "open
    whatsapp", "start chrome" are shell tasks — use the `exec` tool
    (`Start-Process notepad` / `Start-Process "WhatsApp"`), which is
    instant and reliable. Reserve run_desktop_task for clicking/typing
    inside an app once it's the thing you must manipulate. For browser
    tasks use `run_browser_task`; for file/shell work use the shell tool.

    Args:
        goal: Plain-language task, e.g. "in Excel, sum column B".
        app_hint: Optional app to focus first, e.g. "Excel".
        timeout_s: Hard timeout in seconds, clamped to [1, 600]. Default 300s.
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
            "UFO2 Python not found. Run `dex engines setup` to build it "
            "(clones UFO² + creates its venv under ~/.dex/engines/UFO).",
            [],
            task_id,
            None,
        )

    # Cold-start gate
    _await_warmup()

    request = goal if not app_hint else f"In {app_hint}, {goal}"
    cmd = [
        str(py), "-m", "ufo",
        "-t", task_id,
        "-r", request,
        "-m", "normal",
        "--log-level", "WARNING",
    ]
    log_path = LOG_DIR / f"{task_id}.log"

    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    stdout_path = LOG_DIR / f"{task_id}.stdout.txt"
    stderr_path = LOG_DIR / f"{task_id}.stderr.txt"
    rc: int | None = None
    quota_error: str | None = None
    try:
        with open(stdout_path, "w", encoding="utf-8", errors="replace") as out_f, \
             open(stderr_path, "w", encoding="utf-8", errors="replace") as err_f:
            proc = subprocess.Popen(
                cmd,
                cwd=str(UFO_ROOT),
                stdout=out_f,
                stderr=err_f,
                env=child_env,
            )
            deadline = time.monotonic() + timeout_s
            while True:
                rc = proc.poll()
                if rc is not None:
                    break
                quota_error = _scan_quota_error(stderr_path)
                if quota_error is not None:
                    proc.kill()
                    proc.wait(timeout=15)
                    break
                if time.monotonic() >= deadline:
                    proc.kill()
                    proc.wait(timeout=15)
                    break
                time.sleep(2)
    except FileNotFoundError as e:
        return result(False, f"failed to launch UFO2 ({e})", [], task_id, None)

    stdout = stdout_path.read_text(encoding="utf-8", errors="replace")
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace")
    log_path.write_text(
        serialize_run(
            cmd,
            rc,
            stdout,
            stderr,
            extra={
                "timeout_s": timeout_s,
                **({"quota_error": quota_error} if quota_error else {}),
            },
        ),
        encoding="utf-8",
    )

    if quota_error is not None:
        return result(
            False,
            "LLM quota exhausted -- UFO2's model returned 429 "
            f"({quota_error[:160]}). Move the hands to a free Groq key in the "
            "Dex app (Settings -> Account -> Secrets -> Offload to Groq), or "
            "wait for the quota reset. GUI automation needs model quota.",
            stderr.strip().splitlines()[-6:],
            task_id,
            log_path,
        )

    if rc is None:
        tail_lines: list[str] = []
        for source in (stdout, stderr):
            tail_lines.extend(line for line in source.strip().splitlines()[-8:] if line.strip())
        last_progress = next(
            (l for l in reversed(tail_lines) if "Round" in l or "Step" in l or "Phase" in l),
            None,
        )
        summary = f"timeout after {timeout_s}s"
        if last_progress:
            summary = f"{summary} (last progress: {last_progress.strip()[:120]})"
        return result(False, summary, tail_lines[-6:], task_id, log_path)

    summary, steps = _summarize(stdout, stderr, rc)
    return result(rc == 0, summary, steps, task_id, log_path)


# ---------------------------------------------------------------------------
# Helpers (UFO2-specific; shared helpers live in _shared.approval)
# ---------------------------------------------------------------------------
def _resolve_python() -> Path | None:
    if UFO_VENV_PY.exists():
        return UFO_VENV_PY
    return Path(sys.executable) if Path(sys.executable).exists() else None


_QUOTA_PATTERNS = ("RateLimitError", "RESOURCE_EXHAUSTED", "Error code: 429")


def _scan_quota_error(stderr_path: Path) -> str | None:
    try:
        text = stderr_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if any(p in line for p in _QUOTA_PATTERNS):
            return line.strip()
    return None


def _summarize(stdout: str, stderr: str, rc: int) -> tuple[str, list[str]]:
    if rc == 0:
        tail = (stdout.strip().splitlines() or stderr.strip().splitlines())[-5:]
        head = tail[-1] if tail else "completed"
        return head, tail
    stderr_tail = stderr.strip().splitlines()[-8:]
    stdout_tail = stdout.strip().splitlines()[-4:]
    head_line = (stderr_tail[-1] if stderr_tail else (stdout_tail[-1] if stdout_tail else "")).strip()
    summary = f"UFO2 exited with code {rc}"
    if head_line:
        summary = f"{summary}: {head_line[:140]}"
    return summary, stdout_tail + stderr_tail


_warmup_proc: subprocess.Popen | None = None
_warmup_done = False


def _warm_up_ufo() -> None:
    global _warmup_proc
    try:
        py = _resolve_python()
        if not py:
            return
        _warmup_proc = subprocess.Popen(
            [str(py), "-m", "ufo", "--help"],
            cwd=str(UFO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        pass


def _await_warmup(max_wait_s: int = 240) -> None:
    global _warmup_done, _warmup_proc
    if _warmup_done:
        return
    proc = _warmup_proc
    if proc is not None:
        try:
            proc.wait(timeout=max_wait_s)
        except subprocess.TimeoutExpired:
            pass
    _warmup_done = True
    _warmup_proc = None


if __name__ == "__main__":
    _warm_up_ufo()
    mcp.run()
