"""
Coverage for SessionManager.relaunch_for_human_handoff /
resume_after_handoff — the one new browser-lifecycle capability the
browser-use redesign actually needed: a headless Mode A run has no window
for the owner to see and clear a login/CAPTCHA/Cloudflare wall in, so this
temporarily reopens the SAME profile visibly, then returns it to whatever
headless state it was in before.

Hard invariant under test: self.profile_dir is never touched by either
method — same user_data_dir in and out, so the owner's login carries back
to the headless session that resumes. A second profile would defeat the
entire "log in once" point of Path A.

Usage:
    python tests/test_human_wall_handoff.py
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

from session_manager import SessionManager

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


async def check_relaunch_goes_visible_same_profile() -> None:
    print("\n\x1b[1m1. relaunch_for_human_handoff: same profile, headless -> visible\x1b[0m")
    session = SessionManager(cdp_port=59981, headless=True)
    session._is_cdp_attached = False
    original_profile_dir = session.profile_dir
    fake_context = object()

    with (
        patch.object(session, "close", AsyncMock()) as close,
        patch.object(session, "initialize", AsyncMock(return_value=fake_context)) as init,
    ):
        result = await session.relaunch_for_human_handoff()

    check("closed the headless context first", close.called)
    check("headless flag flipped to False before reopening", session.headless is False)
    check("profile_dir is untouched -- same user_data_dir", session.profile_dir == original_profile_dir)
    check("reopened via the normal Mode A initialize path", init.called and init.call_args.kwargs.get("mode_hint") is None)
    check("returns the new (visible) context", result is fake_context)
    check("remembered that it was headless before the handoff", session._headless_before_handoff is True)


async def check_resume_returns_to_headless_same_profile() -> None:
    print("\n\x1b[1m2. resume_after_handoff: same profile, visible -> headless again\x1b[0m")
    session = SessionManager(cdp_port=59982, headless=True)
    session._is_cdp_attached = False
    session.headless = False  # simulating: we're mid-handoff, currently visible
    session._headless_before_handoff = True
    original_profile_dir = session.profile_dir
    fake_context = object()

    with (
        patch.object(session, "close", AsyncMock()) as close,
        patch.object(session, "initialize", AsyncMock(return_value=fake_context)) as init,
    ):
        result = await session.resume_after_handoff()

    check("closed the visible context first", close.called)
    check("headless flag restored to True", session.headless is True)
    check("profile_dir is still untouched -- same user_data_dir", session.profile_dir == original_profile_dir)
    check("reopened via the normal Mode A initialize path", init.called and init.call_args.kwargs.get("mode_hint") is None)
    check("returns the new (headless) context", result is fake_context)
    check("handoff-memory cleared after resuming", session._headless_before_handoff is None)


async def check_resume_respects_a_session_that_was_visible_before_handoff() -> None:
    print("\n\x1b[1m3. If the owner had chosen a visible session before the wall, resume keeps it visible\x1b[0m")
    session = SessionManager(cdp_port=59983, headless=False)
    session._is_cdp_attached = False
    session._headless_before_handoff = False  # it was already visible before the wall

    with (
        patch.object(session, "close", AsyncMock()),
        patch.object(session, "initialize", AsyncMock(return_value=object())),
    ):
        await session.resume_after_handoff()

    check("does not force headless=True when the prior state was visible", session.headless is False)


async def check_mode_b_refuses_the_relaunch() -> None:
    print("\n\x1b[1m4. Mode B (already the owner's real, visible browser) refuses -- nothing to relaunch\x1b[0m")
    session = SessionManager(cdp_port=59984, headless=True)
    session._is_cdp_attached = True  # Mode B: attached to the owner's own browser

    with patch.object(session, "close", AsyncMock()) as close:
        try:
            await session.relaunch_for_human_handoff()
            check("raised RuntimeError", False, "did not raise")
        except RuntimeError:
            check("raised RuntimeError", True)
    check("never touched the owner's real session", not close.called)


async def run_tests() -> int:
    print("\x1b[1m=== Human-Wall Handoff Regression Suite ===\x1b[0m")
    await check_relaunch_goes_visible_same_profile()
    await check_resume_returns_to_headless_same_profile()
    await check_resume_respects_a_session_that_was_visible_before_handoff()
    await check_mode_b_refuses_the_relaunch()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run_tests()))
