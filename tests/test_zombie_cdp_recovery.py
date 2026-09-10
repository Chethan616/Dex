"""
Coverage for SessionManager.initialize()'s recovery from a stuck/zombie CDP
endpoint (the live failure: "[MODE_B_USER_ATTACHED] The user's browser is
not attachable via CDP on port 9222. Start Vivaldi with
--remote-debugging-port=9222" — 21 seconds after the request, meaning the
port WAS answering /json/version (a debug-flagged process is up), but the
real attach handshake still failed. That process was already running with
our own debug flag, so it can only be a zombie left over from an earlier
DEX-launched attempt, never the owner's ordinary browsing session — an
ordinary window is never listening on this port at all.

Before this fix, that case fell straight through to the confusing
"start it with --remote-debugging-port" instruction even though a
debug-flagged process WAS already running (just unresponsive). Now, with
auto_launch_owner_browser on, DEX kills the stuck process and launches a
fresh one instead of just reporting failure.

Usage:
    python tests/test_zombie_cdp_recovery.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))

from session_manager import SessionManager, MODE_B_USER_ATTACHED

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


async def check_stuck_cdp_is_killed_and_relaunched() -> None:
    print("\n\x1b[1m1. A matching-but-unresponsive CDP endpoint is killed and replaced\x1b[0m")
    session = SessionManager(cdp_port=59991, headless=True, auto_launch_owner_browser=True)
    session._playwright = object()  # truthy stand-in; never actually used by the mocks below
    session.browser_path = r"C:\fake\vivaldi.exe"
    session.browser_family = "vivaldi"

    fresh_context = object()
    with (
        patch.object(session, "_get_cdp_version", AsyncMock(return_value={"Browser": "Chrome/1.0"})),
        patch.object(session, "_attach_to_cdp", AsyncMock(side_effect=RuntimeError("handshake timeout"))),
        patch.object(session, "_launch_personal_browser", AsyncMock(return_value=fresh_context)) as launch,
        patch("session_manager._kill_by_executable") as kill,
        patch("session_manager.asyncio.sleep", AsyncMock()),
    ):
        result = await session.initialize(mode_hint="owner")

    check("the stuck process was killed", kill.called, "kill was never called")
    check("killed by the browser's own executable path", kill.call_args[0][0] == session.browser_path)
    check("a fresh launch was attempted after killing it", launch.called)
    check("initialize() returns the freshly launched context", result is fresh_context)


async def check_recovery_only_happens_with_auto_launch_on() -> None:
    print("\n\x1b[1m2. Without auto_launch_owner_browser, still fails clearly -- no killing on our own\x1b[0m")
    session = SessionManager(cdp_port=59992, headless=True, auto_launch_owner_browser=False)
    session._playwright = object()
    session.browser_path = r"C:\fake\vivaldi.exe"
    session.browser_family = "vivaldi"

    with (
        patch.object(session, "_get_cdp_version", AsyncMock(return_value={"Browser": "Chrome/1.0"})),
        patch.object(session, "_attach_to_cdp", AsyncMock(side_effect=RuntimeError("handshake timeout"))),
        patch("session_manager._kill_by_executable") as kill,
    ):
        try:
            await session.initialize(mode_hint="owner")
            check("raised RuntimeError", False, "did not raise")
        except RuntimeError as err:
            check(
                "raises the explicit CDP-instructions error",
                MODE_B_USER_ATTACHED in str(err),
                str(err),
            )
    check("nothing was killed without permission to auto-launch", not kill.called)


async def check_successful_attach_never_kills_anything() -> None:
    print("\n\x1b[1m3. A healthy attach never touches the kill path\x1b[0m")
    session = SessionManager(cdp_port=59993, headless=True, auto_launch_owner_browser=True)
    session._playwright = object()
    session.browser_path = r"C:\fake\vivaldi.exe"
    session.browser_family = "vivaldi"

    healthy_context = object()
    with (
        patch.object(session, "_get_cdp_version", AsyncMock(return_value={"Browser": "Chrome/1.0"})),
        patch.object(session, "_attach_to_cdp", AsyncMock(return_value=healthy_context)),
        patch("session_manager._kill_by_executable") as kill,
    ):
        result = await session.initialize(mode_hint="owner")

    check("returns the healthy context directly", result is healthy_context)
    check("no kill needed", not kill.called)


async def run_tests() -> int:
    print("\x1b[1m=== Zombie CDP Recovery Regression Suite ===\x1b[0m")
    await check_stuck_cdp_is_killed_and_relaunched()
    await check_recovery_only_happens_with_auto_launch_on()
    await check_successful_attach_never_kills_anything()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run_tests()))
