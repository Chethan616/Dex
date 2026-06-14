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
import time
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
)

from mcp.server.fastmcp import FastMCP  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Drivers now live INSIDE the package at dex/core/drivers/<driver>/server.py,
# so the repo root is parents[4] (…/dex/core/drivers/windows-desktop-control →
# drivers → core → dex → repo). This default only matters when DEX_UFO_ROOT is
# unset; builtin-engines.ts sets DEX_UFO_ROOT to UFO's real location for every
# gateway-launched run, so the parents[N] math is just a dev fallback.
REPO_ROOT = Path(__file__).resolve().parents[4]                # repo root
# UFO² lives at vendor/UFO in the dev repo and the MSI bundle, but an npm
# install places it at ~/.dex/engines/UFO via `dex engines setup`. Honor
# DEX_UFO_ROOT so the driver finds UFO wherever it actually was installed;
# builtin-engines.ts sets it when UFO resolves outside the vendor tree.
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
            "UFO2 Python not found. Run `dex engines setup` to build it "
            "(clones UFO² + creates its venv under ~/.dex/engines/UFO).",
            [],
            task_id,
            None,
        )

    # Cold-start gate: the first task waits for the boot warmup to finish
    # so it spawns into a warm (Defender-scanned, bytecode-cached) venv.
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

    # UFO2 writes emoji + checkmarks to stdout; on Windows the default
    # console codepage is cp1252 which can't encode them, so the subprocess
    # crashes mid-run with UnicodeEncodeError. PYTHONIOENCODING=utf-8 forces
    # the child Python to use UTF-8 for its own sys.stdout / sys.stderr,
    # matching our file-capture side. PYTHONUNBUFFERED makes log lines land
    # promptly so the live quota scan below actually sees them.
    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    # Popen + poll loop (NOT subprocess.run): a dead-quota LLM key makes
    # UFO2 sit in 429 retry-backoff for the FULL timeout while producing
    # nothing -- observed 2026-06-11 with gemini free-tier daily quota
    # exhausted. Scanning stderr live lets us kill the run within seconds
    # and tell the user the actual problem instead of "timeout after 300s".
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
        # Timed out. Surface the LAST partial output so the Activity card
        # shows the round/step UFO2 was on instead of nothing actionable.
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


# Provider-agnostic quota/rate-limit signatures. Gemini's OpenAI-compat
# endpoint raises openai.RateLimitError with "Error code: 429" and a
# RESOURCE_EXHAUSTED status; OpenAI/Groq use the same RateLimitError class.
_QUOTA_PATTERNS = ("RateLimitError", "RESOURCE_EXHAUSTED", "Error code: 429")


def _scan_quota_error(stderr_path: Path) -> str | None:
    """Return the first quota-exhaustion line from the live stderr file,
    or None. Reads the whole file each poll -- UFO2 stderr stays small
    (warnings only at --log-level WARNING)."""
    try:
        text = stderr_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if any(p in line for p in _QUOTA_PATTERNS):
            return line.strip()
    return None


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


# Warmup subprocess handle. The first real task GATES on this finishing
# (see _await_warmup) -- spawning a second cold python while the warmup
# is still paying the Defender venv-scan bill starves BOTH processes;
# observed twice as a 300s run with zero stdout/stderr.
_warmup_proc: subprocess.Popen | None = None
_warmup_done = False


def _warm_up_ufo() -> None:
    """Spawn `python -m ufo --help` at server startup.

    UFO2 imports are ~1-3s warm but MINUTES on a cold machine: Windows
    Defender real-time scans every .py/.pyd in the venv on first load
    after boot. Warming at server start moves that bill to gateway boot;
    the first task then waits for the warmup instead of double-spawning
    into the same cold scan.
    """
    global _warmup_proc
    try:
        _warmup_proc = subprocess.Popen(
            [str(UFO_VENV_PY), "-m", "ufo", "--help"],
            cwd=str(UFO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        pass  # venv missing -- run_desktop_task surfaces the real error.


def _await_warmup(max_wait_s: int = 240) -> None:
    """Block the FIRST task until the warmup subprocess exits (or the
    grace cap passes). Runs outside the task's own timeout budget, so a
    cold-start Defender scan no longer eats the user's 300s."""
    global _warmup_done, _warmup_proc
    if _warmup_done:
        return
    proc = _warmup_proc
    if proc is not None:
        try:
            proc.wait(timeout=max_wait_s)
        except subprocess.TimeoutExpired:
            pass  # proceed anyway; better than blocking forever
    _warmup_done = True
    _warmup_proc = None


if __name__ == "__main__":
    _warm_up_ufo()
    mcp.run()  # stdio transport
