"""
Coverage for session_manager._process_name_is_running's fix: it must check
for an actual VISIBLE window owned by the browser's executable, not merely
"a process with this image name exists" (the old `tasklist` check).

The bug this replaces: Chromium browsers (Vivaldi included) run renderer,
GPU, utility, and crashpad-handler subprocesses under the exact same
executable name as the main browser, and those commonly linger for seconds
— sometimes indefinitely — after every window the user can see is closed.
A bare process-name match saw those lingering helpers and reported "still
open" even seconds after the user closed every window (or DEX itself closed
and relaunched via SystemAgent), permanently blocking the retry the error
message itself asked for.

Usage:
    python tests/test_browser_visible_window_check.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))

import psutil
import win32gui
import win32process

from session_manager import _process_name_is_running

EXE_PATH = r"C:\Users\cheth\AppData\Local\Vivaldi\Application\vivaldi.exe"

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


class FakeProcess:
    def __init__(self, exe_path: str):
        self._exe_path = exe_path

    def exe(self) -> str:
        return self._exe_path


def _enum_windows_with(hwnds: list[int]):
    def fake_enum_windows(callback, extra):
        for hwnd in hwnds:
            if callback(hwnd, extra) is False:
                break
    return fake_enum_windows


def check_real_visible_window_is_detected() -> None:
    print("\n\x1b[1m1. A real, visible window owned by the browser's exe -> True\x1b[0m")
    with (
        patch.object(win32gui, "EnumWindows", _enum_windows_with([111])),
        patch.object(win32gui, "IsWindowVisible", return_value=True),
        patch.object(win32gui, "GetWindowText", return_value="Vivaldi - Instagram"),
        patch.object(win32process, "GetWindowThreadProcessId", return_value=(0, 4242)),
        patch.object(psutil, "Process", return_value=FakeProcess(EXE_PATH)),
    ):
        check("detected as running", _process_name_is_running(EXE_PATH) is True)


def check_lingering_helper_process_is_not_a_window() -> None:
    print("\n\x1b[1m2. No visible windows at all (only a lingering GPU/crashpad helper) -> False\x1b[0m")
    with (
        patch.object(win32gui, "EnumWindows", _enum_windows_with([])),
    ):
        check(
            "NOT detected as running -- this is the exact false positive that was fixed",
            _process_name_is_running(EXE_PATH) is False,
        )


def check_unrelated_visible_window_is_ignored() -> None:
    print("\n\x1b[1m3. A visible window from an unrelated process -> False\x1b[0m")
    with (
        patch.object(win32gui, "EnumWindows", _enum_windows_with([222])),
        patch.object(win32gui, "IsWindowVisible", return_value=True),
        patch.object(win32gui, "GetWindowText", return_value="Notepad"),
        patch.object(win32process, "GetWindowThreadProcessId", return_value=(0, 9999)),
        patch.object(psutil, "Process", return_value=FakeProcess(r"C:\Windows\System32\notepad.exe")),
    ):
        check("not detected as the browser", _process_name_is_running(EXE_PATH) is False)


def check_hidden_window_is_ignored() -> None:
    print("\n\x1b[1m4. A window that exists but is not visible -> False\x1b[0m")
    with (
        patch.object(win32gui, "EnumWindows", _enum_windows_with([333])),
        patch.object(win32gui, "IsWindowVisible", return_value=False),
    ):
        check("not detected -- invisible windows do not count", _process_name_is_running(EXE_PATH) is False)


def check_no_executable_path_is_false() -> None:
    print("\n\x1b[1m5. No executable path known -> False, no crash\x1b[0m")
    check("None path returns False", _process_name_is_running(None) is False)


def main() -> int:
    print("\x1b[1m=== Browser Visible-Window Check Regression Suite ===\x1b[0m")
    check_real_visible_window_is_detected()
    check_lingering_helper_process_is_not_a_window()
    check_unrelated_visible_window_is_ignored()
    check_hidden_window_is_ignored()
    check_no_executable_path_is_false()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
