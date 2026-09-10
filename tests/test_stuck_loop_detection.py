"""
Coverage for the two loop-termination fixes added after a live acceptance
test (Phase 8 of the WebAdapter migration) found the generic loop could burn
its entire step budget on a real YouTube task: the LLM call kept failing,
and every failure silently fell back to the same blind `scroll`, forever,
with no distinction between "the model chose to scroll" and "the model
never actually answered."

1. Bounded LLM-failure escape hatch: consecutive reasoning-provider failures
   (not bad decisions -- failures to decide at all) must give up with a
   specific, honest reason well before max_steps, not disguise themselves as
   a generic timeout.
2. General stuck detector: the same action, on the same target, on the same
   URL, repeated back to back -- regardless of which tier produced it or
   what exec_res.success says -- must also give up rather than exhaust the
   step budget with no progress.

Usage:
    python tests/test_stuck_loop_detection.py
"""
from __future__ import annotations

import asyncio
import http.server
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))
sys.path.insert(0, str(ROOT / "agents"))

from browser_manager import BrowserManager
import agent_runner as agent_runner_module

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


HTML_PAGE = """
<!DOCTYPE html>
<html><head><title>Stuck Loop Fixture</title></head>
<body><p>Nothing here matches any heuristic on purpose.</p></body></html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML_PAGE.encode("utf-8"))

    def log_message(self, format, *args):
        pass


async def run_tests() -> int:
    print("\n\x1b[1m=== Stuck-Loop Detection Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9337, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        print("\n\x1b[1m1. Bounded LLM-failure escape hatch (no reasoning provider configured)\x1b[0m")
        # Force every decision past the heuristic tier and into _llm_decide,
        # which then hits its "no provider" branch every single time --
        # exactly what a real, intermittent provider failure looks like from
        # the loop's perspective.
        manager.runner._get_llm = lambda mode="smart": None
        run_res = await manager.runner.run_task(
            task="do something with no matching heuristic at all zzqxv",
            start_url=f"{base_url}/",
            max_steps=25,
        )
        check(
            "Task fails with the specific reasoning-provider reason, not a generic timeout",
            "reasoning provider failed" in str(run_res.get("error", "")),
            str(run_res.get("error")),
        )
        steps_taken = len(run_res.get("steps", []))
        check(
            f"Gave up well before max_steps=25 (took {steps_taken} steps)",
            0 < steps_taken <= 5,
            f"steps_taken={steps_taken}",
        )

        print("\n\x1b[1m2. General stuck detector (same action+target+url repeated, decisions succeed)\x1b[0m")
        # Bypass the LLM path entirely: a heuristic that always confidently
        # returns the exact same non-terminal action never escalates to
        # _llm_decide, so consecutive_llm_failures stays 0 -- this isolates
        # the general stuck detector from the LLM-failure one above.
        manager.runner._heuristic_decision = lambda task, elements, current_url, history: (
            {"type": "scroll", "direction": "down", "amount": 100, "_tier": "heuristic"},
            1.0,
        )
        run_res2 = await manager.runner.run_task(
            task="scroll forever on purpose",
            start_url=f"{base_url}/",
            max_steps=25,
        )
        check(
            "Task fails with the stuck-detector's specific reason",
            "Stuck:" in str(run_res2.get("error", "")) and "scroll" in str(run_res2.get("error", "")),
            str(run_res2.get("error")),
        )
        steps_taken2 = len(run_res2.get("steps", []))
        check(
            f"Gave up well before max_steps=25 (took {steps_taken2} steps)",
            0 < steps_taken2 <= 6,
            f"steps_taken={steps_taken2}",
        )

        await manager.close()

    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(temp_profile, ignore_errors=True)

    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
