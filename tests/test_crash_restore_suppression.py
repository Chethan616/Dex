"""
Coverage for session_manager._suppress_crash_restore_prompt.

The bug this exists for: after our earlier fixes, DEX could finally launch
and connect its websocket to the user's browser -- and then
Playwright's connect_over_cdp still hung for the full 180s timeout. The
browser process was up and the debug port was listening, but its main
thread was blocked showing a native "Vivaldi didn't shut down correctly --
restore pages?" dialog, which any prior non-graceful close (a taskkill, a
crash, DEX's own close_app step) leaves behind by writing
exit_type != "Normal" into the profile's Preferences file. Confirmed live
against the real profile at the time this was diagnosed: exit_type was
"CrashedOnlyOnce".

Usage:
    python tests/test_crash_restore_suppression.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))

from session_manager import _suppress_crash_restore_prompt

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


def _write_prefs(profile_dir: Path, profile_name: str, profile_section: dict) -> Path:
    target_dir = profile_dir / profile_name
    target_dir.mkdir(parents=True, exist_ok=True)
    prefs_path = target_dir / "Preferences"
    prefs_path.write_text(json.dumps({"profile": profile_section, "other": {"untouched": True}}), encoding="utf-8")
    return prefs_path


def check_crashed_profile_is_normalized() -> None:
    print("\n\x1b[1m1. A profile marked crashed is rewritten as a clean exit\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        prefs_path = _write_prefs(user_data_dir, "Default", {"exit_type": "CrashedOnlyOnce", "exited_cleanly": False})

        _suppress_crash_restore_prompt(user_data_dir, "Default")

        data = json.loads(prefs_path.read_text(encoding="utf-8"))
        check("exit_type is now Normal", data["profile"]["exit_type"] == "Normal", data["profile"])
        check("exited_cleanly is now True", data["profile"]["exited_cleanly"] is True)
        check("unrelated data is preserved", data.get("other", {}).get("untouched") is True)


def check_already_clean_profile_is_left_alone() -> None:
    print("\n\x1b[1m2. An already-clean profile is not rewritten unnecessarily\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        prefs_path = _write_prefs(user_data_dir, "Default", {"exit_type": "Normal", "exited_cleanly": True})
        before_mtime = prefs_path.stat().st_mtime_ns

        _suppress_crash_restore_prompt(user_data_dir, "Default")

        check("file was not rewritten", prefs_path.stat().st_mtime_ns == before_mtime)


def check_crash_streak_is_reset_in_local_state() -> None:
    print("\n\x1b[1m5. Local State's crash streak (browser-wide, not per-profile) is reset too\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        _write_prefs(user_data_dir, "Default", {"exit_type": "Normal", "exited_cleanly": True})
        local_state_path = user_data_dir / "Local State"
        local_state_path.write_text(json.dumps({
            "variations_crash_streak": 125,
            "user_experience_metrics": {"stability": {"exited_cleanly": False}},
        }), encoding="utf-8")

        _suppress_crash_restore_prompt(user_data_dir, "Default")

        state = json.loads(local_state_path.read_text(encoding="utf-8"))
        check("crash streak reset to 0", state["variations_crash_streak"] == 0, state)
        check(
            "browser-wide exited_cleanly is now True",
            state["user_experience_metrics"]["stability"]["exited_cleanly"] is True,
        )


def check_missing_local_state_does_not_raise() -> None:
    print("\n\x1b[1m6. No Local State file -- does not raise\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        _write_prefs(user_data_dir, "Default", {"exit_type": "Normal", "exited_cleanly": True})
        try:
            _suppress_crash_restore_prompt(user_data_dir, "Default")
            check("no exception raised", True)
        except Exception as err:  # noqa: BLE001
            check("no exception raised", False, str(err))


def check_missing_preferences_file_does_not_raise() -> None:
    print("\n\x1b[1m3. No Preferences file yet (first run) -- does not raise\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        try:
            _suppress_crash_restore_prompt(user_data_dir, "Default")
            check("no exception raised", True)
        except Exception as err:  # noqa: BLE001
            check("no exception raised", False, str(err))


def check_malformed_preferences_file_does_not_raise() -> None:
    print("\n\x1b[1m4. A malformed Preferences file -- does not raise, launch can still proceed\x1b[0m")
    with tempfile.TemporaryDirectory() as tmp:
        user_data_dir = Path(tmp)
        target_dir = user_data_dir / "Default"
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "Preferences").write_text("{not valid json", encoding="utf-8")
        try:
            _suppress_crash_restore_prompt(user_data_dir, "Default")
            check("no exception raised", True)
        except Exception as err:  # noqa: BLE001
            check("no exception raised", False, str(err))


def main() -> int:
    print("\x1b[1m=== Crash-Restore Suppression Regression Suite ===\x1b[0m")
    check_crashed_profile_is_normalized()
    check_already_clean_profile_is_left_alone()
    check_crash_streak_is_reset_in_local_state()
    check_missing_local_state_does_not_raise()
    check_missing_preferences_file_does_not_raise()
    check_malformed_preferences_file_does_not_raise()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
