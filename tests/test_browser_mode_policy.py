"""
Coverage for the Mode A/Mode B default-selection policy: server.py's
_resolve_mode_hint (the single policy for what an unset `browser` field
means), and SessionManager's auto_launch_owner_browser gate (which must
default to False so no test, or any direct SessionManager construction,
ever spawns a real, visible browser process as a side effect).

Usage:
    python tests/test_browser_mode_policy.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))
sys.path.insert(0, str(ROOT / "agents"))

import server as browser_server
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


def run_policy_checks() -> None:
    print("\n\x1b[1m1. _resolve_mode_hint — explicit requests always win\x1b[0m")
    check("explicit 'owner' -> 'owner'", browser_server._resolve_mode_hint("owner") == "owner")
    check("explicit 'dex' -> None (isolated)", browser_server._resolve_mode_hint("dex") is None)

    os.environ.pop("DEX_BROWSER_DEFAULT_MODE", None)
    print("\n\x1b[1m2. Unspecified browser mode defaults to the DEX-owned browser (no env override)\x1b[0m")
    check("unset with no env var -> None (DEX profile)", browser_server._resolve_mode_hint(None) is None)

    os.environ["DEX_BROWSER_DEFAULT_MODE"] = "owner"
    print("\n\x1b[1m3. DEX_BROWSER_DEFAULT_MODE=owner flips the unset default back to the owner's real browser\x1b[0m")
    check("unset with DEX_BROWSER_DEFAULT_MODE=owner -> 'owner'", browser_server._resolve_mode_hint(None) == "owner")
    check("explicit 'dex' still wins even with the env override", browser_server._resolve_mode_hint("dex") is None)
    os.environ.pop("DEX_BROWSER_DEFAULT_MODE", None)


async def run_no_launch_checks() -> None:
    print("\n\x1b[1m4. auto_launch_owner_browser defaults to False -- no test ever spawns a real browser\x1b[0m")
    session_default = SessionManager(cdp_port=59998, headless=True)
    check(
        "SessionManager() with no explicit flag has auto_launch_owner_browser=False",
        session_default._auto_launch_owner_browser is False,
    )
    try:
        await session_default.initialize(mode_hint="owner")
        check("Mode B without auto-launch raises instead of spawning a browser", False, "did not raise")
    except RuntimeError as e:
        msg = str(e)
        check(
            "Mode B without auto-launch raises the explicit CDP-instructions error",
            MODE_B_USER_ATTACHED in msg and "not attachable via CDP" in msg,
            msg,
        )
    finally:
        if session_default._playwright:
            await session_default._playwright.stop()

    print("\n\x1b[1m5. auto_launch_owner_browser=True still refuses safely when no browser is installed\x1b[0m")
    session_auto = SessionManager(cdp_port=59997, headless=True, auto_launch_owner_browser=True)
    # Simulate "no supported browser found" without touching a real install —
    # this exercises _launch_personal_browser's own guard, not a live launch.
    session_auto.browser_path = None
    try:
        await session_auto.initialize(mode_hint="owner")
        check("Missing browser_path still refuses rather than launching anything", False, "did not raise")
    except RuntimeError as e:
        check(
            "auto-launch with no installed browser raises a clear, safe error",
            "No supported personal browser installation was found" in str(e),
            str(e),
        )
    finally:
        if session_auto._playwright:
            await session_auto._playwright.stop()


def main() -> int:
    run_policy_checks()
    asyncio.run(run_no_launch_checks())
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
