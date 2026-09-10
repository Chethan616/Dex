"""
Coverage for PowerHandler.create_power_plan — the one-step replacement for
the fragile pattern a live plan hit: duplicate a scheme via run_command,
extract its GUID out of powercfg's human-readable text by splicing raw
stdout into ANOTHER PowerShell command via {{step_N.output.stdout}}, then
apply settings with a `/scheme:` flag `powercfg /change` does not actually
accept (/change always targets whichever scheme is currently active). Both
mistakes were structural — there was no real primitive for "create a custom
power plan" — so this replaces the whole chain with one operation.

Every powercfg call is mocked: this must never touch the real machine's
power plans, and never rely on network/hardware being reachable.

Usage:
    python tests/test_power_handler.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from daemon.handlers.power_handler import PowerHandler

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


LIST_NO_CUSTOM = (
    "Existing Power Schemes (* Active)\n"
    "-----------------------------------\n"
    "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n"
    "Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n"
)

DUPLICATE_OUTPUT = (
    "Power Scheme GUID: b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b  "
    "(dex's adaptive powerplan)\n"
)

GETACTIVE_NEW = "Power Scheme GUID: b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b  (dex's adaptive powerplan)\n"
GETACTIVE_BALANCED = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n"


def check_creates_new_plan_when_none_exists() -> None:
    print("\n\x1b[1m1. No plan with this name yet -- duplicates, renames, activates\x1b[0m")
    calls = []

    def fake_run(cmd, timeout=15):
        calls.append(cmd)
        if cmd[:2] == ["powercfg", "/list"]:
            return LIST_NO_CUSTOM
        if cmd[:2] == ["powercfg", "/duplicatescheme"]:
            return DUPLICATE_OUTPUT
        return ""

    with patch("daemon.handlers.power_handler.run", side_effect=fake_run):
        result = PowerHandler.create_power_plan({"name": "dex's adaptive powerplan"})

    check("returns the real new GUID", result["guid"] == "b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b", result)
    check("returns the requested name", result["name"] == "dex's adaptive powerplan")
    check("duplicated the balanced base plan", ["powercfg", "/duplicatescheme", "381b4222-f694-41f0-9685-ff5bb260df2e"] in calls)
    check(
        "renamed it",
        ["powercfg", "/changename", "b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b", "dex's adaptive powerplan"] in calls,
    )
    check("activated it by default", ["powercfg", "/setactive", "b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b"] in calls)


def check_idempotent_on_repeated_name() -> None:
    print("\n\x1b[1m2. Same name asked for again -- updates the existing plan, no duplicate\x1b[0m")
    calls = []
    list_with_custom = LIST_NO_CUSTOM + "Power Scheme GUID: b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b  (dex's adaptive powerplan)\n"

    def fake_run(cmd, timeout=15):
        calls.append(cmd)
        if cmd[:2] == ["powercfg", "/list"]:
            return list_with_custom
        return ""

    with patch("daemon.handlers.power_handler.run", side_effect=fake_run):
        result = PowerHandler.create_power_plan({"name": "dex's adaptive powerplan"})

    check("reuses the existing GUID", result["guid"] == "b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b")
    check(
        "never duplicates a second scheme under the same name",
        not any(c[:2] == ["powercfg", "/duplicatescheme"] for c in calls),
        calls,
    )
    check(
        "never renames it again either -- nothing to rename",
        not any(c[:2] == ["powercfg", "/changename"] for c in calls),
        calls,
    )


def check_settings_applied_to_new_plan_while_active() -> None:
    print("\n\x1b[1m3. Settings are applied via /change, which only ever targets the active scheme\x1b[0m")
    calls = []

    def fake_run(cmd, timeout=15):
        calls.append(list(cmd))
        if cmd[:2] == ["powercfg", "/list"]:
            return LIST_NO_CUSTOM
        if cmd[:2] == ["powercfg", "/duplicatescheme"]:
            return DUPLICATE_OUTPUT
        if cmd[:2] == ["powercfg", "/getactivescheme"]:
            return GETACTIVE_BALANCED
        return ""

    with patch("daemon.handlers.power_handler.run", side_effect=fake_run):
        result = PowerHandler.create_power_plan({
            "name": "dex's adaptive powerplan",
            "settings": {"monitor_timeout_ac": 15, "standby_timeout_ac": 45},
        })

    check("both settings reported as applied", result["settings"] == {"monitor_timeout_ac": 15, "standby_timeout_ac": 45})
    check(
        "used the real powercfg /change flag name, not an invented /scheme flag",
        ["powercfg", "/change", "monitor-timeout-ac", "15"] in calls,
        calls,
    )
    check(
        "no call ever invents a /scheme flag for /change -- it does not exist",
        not any("/change" in c and any(str(a).startswith("/scheme") for a in c) for c in calls),
        calls,
    )


def check_previous_plan_restored_when_not_activating() -> None:
    print("\n\x1b[1m4. activate=False still applies settings, then restores the prior active plan\x1b[0m")
    calls = []

    def fake_run(cmd, timeout=15):
        calls.append(list(cmd))
        if cmd[:2] == ["powercfg", "/list"]:
            return LIST_NO_CUSTOM
        if cmd[:2] == ["powercfg", "/duplicatescheme"]:
            return DUPLICATE_OUTPUT
        if cmd[:2] == ["powercfg", "/getactivescheme"]:
            return GETACTIVE_BALANCED
        return ""

    with patch("daemon.handlers.power_handler.run", side_effect=fake_run):
        result = PowerHandler.create_power_plan({
            "name": "dex's adaptive powerplan",
            "settings": {"disk_timeout_ac": 20},
            "activate": False,
        })

    check("reports active=False", result["active"] is False)
    setactive_calls = [c for c in calls if c[:2] == ["powercfg", "/setactive"]]
    check(
        "switches to the new plan to apply settings, then back to the original",
        setactive_calls == [
            ["powercfg", "/setactive", "b7e2e8e6-9d31-4661-b8f3-340f7cf8a85b"],
            ["powercfg", "/setactive", "381b4222-f694-41f0-9685-ff5bb260df2e"],
        ],
        setactive_calls,
    )


def check_unknown_base_rejected() -> None:
    print("\n\x1b[1m5. An unknown base plan is rejected before touching the system\x1b[0m")
    with patch("daemon.handlers.power_handler.run") as run_mock:
        try:
            PowerHandler.create_power_plan({"name": "X", "base": "turbo"})
            check("raised ValueError", False, "did not raise")
        except ValueError as err:
            check("raised ValueError naming the valid options", "turbo" in str(err) and "balanced" in str(err), str(err))
    check("never called powercfg at all", not run_mock.called)


def check_unknown_setting_rejected() -> None:
    print("\n\x1b[1m6. An unknown setting key is rejected, not silently ignored\x1b[0m")

    def fake_run(cmd, timeout=15):
        if cmd[:2] == ["powercfg", "/list"]:
            return LIST_NO_CUSTOM
        if cmd[:2] == ["powercfg", "/duplicatescheme"]:
            return DUPLICATE_OUTPUT
        return ""

    with patch("daemon.handlers.power_handler.run", side_effect=fake_run):
        try:
            PowerHandler.create_power_plan({"name": "X", "settings": {"screen_brightness": 50}})
            check("raised ValueError", False, "did not raise")
        except ValueError as err:
            check("names the bad key", "screen_brightness" in str(err), str(err))


def check_missing_name_rejected() -> None:
    print("\n\x1b[1m7. No name at all is rejected immediately\x1b[0m")
    with patch("daemon.handlers.power_handler.run") as run_mock:
        try:
            PowerHandler.create_power_plan({})
            check("raised ValueError", False, "did not raise")
        except ValueError:
            check("raised ValueError", True)
    check("never called powercfg at all", not run_mock.called)


def main() -> int:
    print("\x1b[1m=== Power Handler (create_power_plan) Regression Suite ===\x1b[0m")
    check_creates_new_plan_when_none_exists()
    check_idempotent_on_repeated_name()
    check_settings_applied_to_new_plan_while_active()
    check_previous_plan_restored_when_not_activating()
    check_unknown_base_rejected()
    check_unknown_setting_rejected()
    check_missing_name_rejected()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
