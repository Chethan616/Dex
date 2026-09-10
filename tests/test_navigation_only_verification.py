"""
Reproduces a real failure reported live: "open instagram" (and equivalent
plain navigation requests naming a known site) kept failing with "Generic
browser liveliness passed but task-specific state verification was not
performed" — even though there was no post/entity to verify in the first
place. The generic-loop force-fail check was keying on `site` (any mention
of a known site name) instead of `is_post_task` (an actual request for
specific content), so simply naming Instagram was enough to demand a bar the
task never asked to clear.

Two things must both hold after the fix:
1. A plain "open <site>" task succeeds on generic liveliness alone.
2. A task that actually asks for specific content ("find X's latest post")
   still gets held to real target/entity verification — the fix must not
   have loosened that.

Usage:
    python tests/test_navigation_only_verification.py
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
<html><head><title>sidemen (@sidemen) - Instagram</title></head>
<body><h1>Welcome to the (fake) Instagram home</h1></body></html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML_HOME.encode("utf-8"))

    def log_message(self, format, *args):
        pass


async def run_tests() -> int:
    print("\n\x1b[1m=== Navigation-Only Verification Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9338, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        print("\n\x1b[1m1. 'Open Instagram website' succeeds on generic liveliness (the reported bug)\x1b[0m")
        # No matching heuristic for "open" phrasing without a bare URL in the
        # task text, so this exercises the LLM decision path the same way
        # the real failure did -- but forcing the heuristic directly keeps
        # this test deterministic and independent of a live LLM call.
        manager.runner._heuristic_decision = lambda task, elements, current_url, history: (
            {"type": "done", "is_complete": True, "summary": "Instagram homepage is open.", "_tier": "heuristic"},
            1.0,
        )
        run_res = await manager.runner.run_task(
            task="Open Instagram website",
            start_url=f"{base_url}/",
            target_site="instagram.com",
            max_steps=5,
        )
        check(
            "Task succeeds instead of failing with the generic-liveliness reason",
            run_res.get("success") is True,
            str(run_res.get("verification") or run_res.get("error")),
        )
        check(
            "No needs_handoff / retry-forever loop was triggered",
            not run_res.get("needs_handoff"),
            str(run_res.get("needs_handoff")),
        )

        print("\n\x1b[1m2. A real content request ('find sidemen's latest post') still enforces strict verification\x1b[0m")
        # Same "done" heuristic, but this time the task actually names an
        # entity and wants a post -- the fix must not have made this path
        # any less strict. The fixture page has no post open at all, so this
        # must FAIL, not pass on liveliness.
        run_res2 = await manager.runner.run_task(
            task="find sidemen's latest instagram post",
            start_url=f"{base_url}/",
            target_site="instagram.com",
            max_steps=5,
        )
        check(
            "Task FAILS when no actual post is open, despite the page being 'live'",
            run_res2.get("success") is False,
            str(run_res2),
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
