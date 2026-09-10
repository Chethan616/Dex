"""
Coverage for agent_loop.py's two loop-termination mechanisms (Phase C of the
vision-first migration), ported in spirit from
agents/browser/agent_runner.py's already-proven equivalents
(MAX_CONSECUTIVE_LLM_FAILURES / STUCK_REPEAT_THRESHOLD, covered by
tests/test_stuck_loop_detection.py):

1. Bounded provider-failure escape hatch: a Worker provider failure (marked
   _provider_error by worker_providers.py — a parse/HTTP failure, not a
   genuine model decision) must give up after MAX_CONSECUTIVE_WORKER_FAILURES,
   with a specific reason, not exhaust MAX_STEPS or loop forever.
2. Stuck detector: the same action on the same target repeated
   STUCK_REPEAT_THRESHOLD times, regardless of whether each individual
   attempt "succeeded", must also give up cleanly.

Usage:
    python tests/test_agent_loop_bounded_failure.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "desktop"))

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


class FakeExecutor:
    """Never touches a real screen — screenshot is a constant, execute always succeeds."""

    def screenshot_b64(self) -> str:
        return "fake-screenshot-b64"

    def execute(self, action: dict, coords: dict | None = None) -> bool:
        return True


class FakeGrounding:
    def resolve(self, screenshot_b64: str, target: str) -> dict:
        return {"x": 100, "y": 100}


class AlwaysProviderErrorWorker:
    """Every decide() call fails at the provider level — never a real model decision."""

    name = "fake/always-errors"

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict:
        return {"action_type": "failed", "failure_reason": "simulated HTTP 500", "reasoning": "", "_provider_error": True}


class AlwaysSameClickWorker:
    """Every decide() call is a REAL decision (no _provider_error) but always identical."""

    name = "fake/always-same-click"

    async def decide(self, screenshot_b64: str, task: str, history: str) -> dict:
        return {"reasoning": "Clicking the same button again.", "action_type": "click", "target_description": "the Save button"}


async def check_bounded_provider_failure() -> None:
    print("\n\x1b[1m1. Bounded provider-failure escape hatch\x1b[0m")
    from agent_loop import AgentLoop, MAX_CONSECUTIVE_WORKER_FAILURES, MAX_STEPS

    loop = AgentLoop(AlwaysProviderErrorWorker(), FakeGrounding())
    result = await loop.run("do something", FakeExecutor())

    check(
        "task fails with the specific reasoning-provider reason, not a generic timeout",
        "reasoning provider" in result.get("error", "").lower() and "failed" in result.get("error", "").lower(),
        str(result.get("error")),
    )
    check(
        f"gives up at exactly MAX_CONSECUTIVE_WORKER_FAILURES ({MAX_CONSECUTIVE_WORKER_FAILURES}), not MAX_STEPS ({MAX_STEPS})",
        len(result.get("steps", [])) == MAX_CONSECUTIVE_WORKER_FAILURES,
        f"got {len(result.get('steps', []))} steps",
    )
    check(
        "recorded steps are marked as provider_error, not a real action",
        all(s.get("action_type") == "provider_error" for s in result.get("steps", [])),
        str(result.get("steps")),
    )


async def check_provider_failure_recovers() -> None:
    print("\n\x1b[1m2. A provider failure followed by a real decision resets the counter\x1b[0m")
    from agent_loop import AgentLoop

    class RecoversAfterOneFailure:
        name = "fake/recovers"

        def __init__(self):
            self.calls = 0

        async def decide(self, screenshot_b64, task, history):
            self.calls += 1
            if self.calls == 1:
                return {"action_type": "failed", "failure_reason": "transient", "reasoning": "", "_provider_error": True}
            return {"reasoning": "All done.", "action_type": "done"}

    worker = RecoversAfterOneFailure()
    loop = AgentLoop(worker, FakeGrounding())
    result = await loop.run("do something", FakeExecutor())

    check("task succeeds once the provider answers for real", result.get("success") is True, str(result))
    check("only one provider_error step was recorded before recovery", len(result.get("steps", [])) == 1, str(result.get("steps")))


async def check_stuck_detector() -> None:
    print("\n\x1b[1m3. Stuck detector (real decisions, but no progress)\x1b[0m")
    from agent_loop import AgentLoop, STUCK_REPEAT_THRESHOLD

    loop = AgentLoop(AlwaysSameClickWorker(), FakeGrounding())
    result = await loop.run("save the file", FakeExecutor())

    check(
        "task fails with the stuck-detector's specific reason",
        "stuck" in result.get("error", "").lower() and "save button" in result.get("error", "").lower(),
        str(result.get("error")),
    )
    check(
        f"gives up at exactly STUCK_REPEAT_THRESHOLD ({STUCK_REPEAT_THRESHOLD}) repeats",
        len(result.get("steps", [])) == STUCK_REPEAT_THRESHOLD,
        f"got {len(result.get('steps', []))} steps",
    )


async def check_alternating_actions_not_flagged_stuck() -> None:
    print("\n\x1b[1m4. Alternating targets are NOT flagged as stuck\x1b[0m")
    from agent_loop import AgentLoop

    class AlternatingWorker:
        name = "fake/alternating"

        def __init__(self):
            self.calls = 0

        async def decide(self, screenshot_b64, task, history):
            self.calls += 1
            if self.calls > 6:
                return {"reasoning": "Finished.", "action_type": "done"}
            target = "button A" if self.calls % 2 == 0 else "button B"
            return {"reasoning": f"Clicking {target}.", "action_type": "click", "target_description": target}

    loop = AgentLoop(AlternatingWorker(), FakeGrounding())
    result = await loop.run("click alternately", FakeExecutor())

    check("alternating between two real targets completes normally, not flagged stuck", result.get("success") is True, str(result))


async def run_tests() -> int:
    print("\n\x1b[1m=== Agent Loop Bounded-Failure Regression Suite ===\x1b[0m")
    await check_bounded_provider_failure()
    await check_provider_failure_recovers()
    await check_stuck_detector()
    await check_alternating_actions_not_flagged_stuck()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
