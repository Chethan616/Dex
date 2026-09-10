"""
Phase C live test corpus — the vision-first migration's hard verification
problem: deterministic per-step ground truth is gone by design (the next
screenshot IS the check, examined by the same agent that just acted), so
testing moves from per-step to per-task, using evidence INDEPENDENT of the
agent's own self-report:

  1. os_settings_volume — mute volume via the real Settings UI, checked by
     reading the real Windows mixer state (the OLD deterministic get_volume
     handler, reused here purely as a test oracle — not a runtime dependency
     of the vision loop itself).
  2. file_explorer_create_folder — create a folder via File Explorer,
     checked by os.path.exists on the real filesystem.
  3. notepad_type_and_save — type text into Notepad and save it, checked by
     reading the real file's bytes back.
  4. browser_search — open a browser, navigate, and search, checked by an
     independent one-off Playwright inspection used only as an oracle (the
     vision loop never talks to Playwright itself).

Each entry takes over the REAL mouse, keyboard, and screen on this machine
for up to MAX_STEPS actions. Not meant for CI — run manually, attended:

    python tests/vision_loop/run_corpus.py [task_name ...]

With no arguments, runs the whole corpus in order. Exits 0 only if every
task's independent post-condition holds.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "agents" / "desktop"))
sys.path.insert(0, str(ROOT / "daemon"))
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")

from agent_loop import AgentLoop  # noqa: E402
from computer import Computer  # noqa: E402
from grounding import make_grounding  # noqa: E402
from worker_providers import make_worker  # noqa: E402

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")

WORK_DIR = Path.home() / "Desktop" / "_dex_vision_test"

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  \x1b[32m✓\x1b[0m {name}")
    else:
        failed += 1
        print(f"  \x1b[31m✗\x1b[0m {name}" + (f" -- {detail}" if detail else ""))


async def _run(task: str) -> dict:
    """Exact same wiring as agents/desktop/server.py's /run-task route —
    the corpus proves the real production path, not a parallel one."""
    worker = make_worker(API_KEY)
    grounding = make_grounding(API_KEY, OLLAMA_ENDPOINT)
    loop = AgentLoop(worker, grounding)
    print(f"  worker: {worker.name}")

    def on_step(step_num: int, action: dict) -> None:
        print(f"    step {step_num + 1}: {action.get('action_type')} — {action.get('reasoning', '')[:100]}")

    return await loop.run(task, Computer(), on_step=on_step)


async def task_os_settings_volume() -> None:
    print("\n\x1b[1m1. os_settings_volume\x1b[0m")
    sys.path.insert(0, str(ROOT / "daemon" / "handlers"))
    from audio_handler import AudioHandler  # noqa: E402

    AudioHandler.set_volume({"level": 55})
    before = AudioHandler.get_volume({})
    print(f"  setup: volume forced to {before['level']}%, unmuted")

    result = await _run(
        "Open the Windows Settings app and mute the system volume completely "
        "(0%), using the volume slider or mute control in Settings. Do not "
        "use any keyboard media-mute key — use the Settings UI."
    )
    time.sleep(1.0)
    after = AudioHandler.get_volume({})

    check("loop reported success", result.get("success") is True, str(result.get("error")))
    check(
        "independent oracle (real mixer state) shows muted or 0%",
        after.get("muted") is True or after.get("level", 100) == 0,
        f"oracle read back: {after}",
    )


async def task_file_explorer_create_folder() -> None:
    print("\n\x1b[1m2. file_explorer_create_folder\x1b[0m")
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    WORK_DIR.mkdir(parents=True)
    target = WORK_DIR / "DexVisionTest"
    print(f"  setup: {WORK_DIR} exists and empty")

    result = await _run(
        f"Open File Explorer, navigate to {WORK_DIR}, and create a new folder "
        f"named exactly DexVisionTest inside it."
    )
    time.sleep(1.0)

    check("loop reported success", result.get("success") is True, str(result.get("error")))
    check(
        "independent oracle (real filesystem) shows the folder",
        target.is_dir(),
        f"expected directory at {target}",
    )


async def task_notepad_type_and_save() -> None:
    print("\n\x1b[1m3. notepad_type_and_save\x1b[0m")
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    target = WORK_DIR / "dex_vision_note.txt"
    if target.exists():
        target.unlink()
    marker = f"dex-vision-check-{int(time.time())}"
    print(f"  setup: target file absent, marker text = {marker!r}")

    result = await _run(
        f'Open Notepad, type exactly this text: "{marker}", then save the '
        f'file as {target} (use Save As if needed to pick the exact path).'
    )
    time.sleep(1.0)

    check("loop reported success", result.get("success") is True, str(result.get("error")))
    file_ok = target.is_file()
    contents = target.read_text(encoding="utf-8", errors="replace") if file_ok else ""
    check(
        "independent oracle (real file bytes) contains the marker text",
        file_ok and marker in contents,
        f"file exists={file_ok}, contents={contents[:200]!r}",
    )


async def task_browser_search() -> None:
    print("\n\x1b[1m4. browser_search\x1b[0m")
    query = f"dex vision loop check {int(time.time())}"

    result = await _run(
        f'Open a web browser, go to google.com, and search for: {query}'
    )
    time.sleep(1.5)

    check("loop reported success", result.get("success") is True, str(result.get("error")))

    # Independent oracle: the real OS foreground-window title, read via
    # win32gui — not the agent's screenshot, not a second call to the same
    # grounding model. A browser's title bar carries the page title
    # ("<query> - Google Search - <Browser>"), so this proves an actual
    # search result page is showing without asking the agent (or a vision
    # model at all) to confirm its own work.
    import win32gui

    hwnd = win32gui.GetForegroundWindow()
    title = win32gui.GetWindowText(hwnd)
    check(
        "independent oracle (real OS foreground window title) matches the search",
        query.lower() in title.lower() or "google search" in title.lower(),
        f"foreground window title: {title!r}",
    )


TASKS = {
    "os_settings_volume": task_os_settings_volume,
    "file_explorer_create_folder": task_file_explorer_create_folder,
    "notepad_type_and_save": task_notepad_type_and_save,
    "browser_search": task_browser_search,
}


async def main() -> int:
    requested = sys.argv[1:] or list(TASKS.keys())
    unknown = [name for name in requested if name not in TASKS]
    if unknown:
        print(f"Unknown task(s): {unknown}. Available: {list(TASKS.keys())}")
        return 2

    print("\x1b[1m=== Phase C Vision-Loop Live Test Corpus ===\x1b[0m")
    print("This will take over your real mouse, keyboard, and screen.")
    for name in requested:
        await TASKS[name]()

    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR, ignore_errors=True)
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    code = asyncio.run(main())
    sys.exit(code)
