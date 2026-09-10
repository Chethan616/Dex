"""
ABOUT_BLANK recovery — bounded and explicit, per the spec's forbidden-failure-
mode rule: "adapter_fallback @ about:blank / scroll @ about:blank" looping
until max_steps is never allowed. A transient about:blank (cleared by the
first recovery navigation) must not produce a hand-off; a persistent one
must produce exactly one needs_handoff(kind="about_blank") once the bounded
retry budget is exhausted — never an unhandled crash, even when the recovery
target itself can't be reached.

Usage:
    python tests/test_about_blank_recovery.py
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


HTML_HOME = """
<!DOCTYPE html>
<html><head><title>Recovered Home</title></head>
<body><p>Recovery worked.</p></body></html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/home":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_HOME.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


async def run_tests() -> int:
    print("\n\x1b[1m=== ABOUT_BLANK Recovery Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9336, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        print("\n\x1b[1m1. Recovery primitive detects about:blank correctly\x1b[0m")
        await manager.navigation.goto("about:blank")
        is_blank = await manager.recovery.is_about_blank()
        check("is_about_blank() is True on about:blank", is_blank is True)
        await manager.navigation.goto(f"{base_url}/home")
        is_blank2 = await manager.recovery.is_about_blank()
        check("is_about_blank() is False on a real page", is_blank2 is False)

        print("\n\x1b[1m2. Transient about:blank — cleared by the first recovery navigation\x1b[0m")
        await manager.navigation.goto("about:blank")
        run_res = await manager.runner.run_task(
            task="read the page",
            max_steps=5,
            expected_url=f"{base_url}/home",
        )
        handoff_kind = (run_res.get("needs_handoff") or {}).get("kind")
        check(
            "A transient about:blank never produces an about_blank hand-off",
            handoff_kind != "about_blank",
            str(run_res.get("needs_handoff")),
        )

        print("\n\x1b[1m3. Persistent about:blank — exhausts bounded retries, then hands off (never crashes)\x1b[0m")
        await manager.navigation.goto("about:blank")
        run_res2 = await manager.runner.run_task(
            task="read the page",
            max_steps=5,
            # The recovery target is about:blank itself, so every retry
            # "succeeds" at navigating but never actually leaves about:blank —
            # forcing the bounded-retry path to exhaust and hand off.
            expected_url="about:blank",
        )
        check(
            "run_task returns a structured result instead of raising",
            isinstance(run_res2, dict),
        )
        check(
            "A persistent about:blank produces exactly one about_blank hand-off",
            (run_res2.get("needs_handoff") or {}).get("kind") == "about_blank",
            str(run_res2),
        )
        check("The hand-off result reports success=False", run_res2.get("success") is False)

        print("\n\x1b[1m4. Persistent about:blank with an unreachable recovery target — never crashes\x1b[0m")
        await manager.navigation.goto("about:blank")
        run_res3 = await manager.runner.run_task(
            task="read the page",
            max_steps=5,
            # Port 1 refuses connections outright — this exercises the
            # navigation-failure branch inside the recovery attempt itself.
            expected_url="http://127.0.0.1:1/unreachable",
        )
        check(
            "An unreachable recovery target still resolves to a structured hand-off, not a crash",
            (run_res3.get("needs_handoff") or {}).get("kind") == "about_blank",
            str(run_res3),
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
