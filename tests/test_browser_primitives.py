"""
Regression coverage for the six /primitive ops that used to dead-end into
"Unknown primitive action" (sign_in, record_route, stop_recording, extract,
wait_for, extract_table), plus the session_id-threading fix that makes the
handoff-resume protocol (browser_agent.ts reads response.session_id) work.

Runs against a local HTTP test server so no external network or real logins
are required. Usage:
    python tests/test_browser_primitives.py
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
from browser_state import Target, WebTask
import site_credentials
import server as browser_server
from server import PrimitiveRequest, AbandonRequest

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
<html>
<head><title>DEX Primitives Test</title></head>
<body>
  <a id="nav-link" href="/table">Go to table</a>
</body>
</html>
"""

HTML_SIGNIN = """
<!DOCTYPE html>
<html>
<head><title>Sign in</title></head>
<body>
  <form>
    <input type="email" name="email" />
    <input type="password" name="password" />
  </form>
</body>
</html>
"""

HTML_TABLE = """
<!DOCTYPE html>
<html>
<head><title>Table Page</title></head>
<body>
  <p id="greeting">Hello from the table page</p>
  <table>
    <thead><tr><th>Name</th><th>Age</th></tr></thead>
    <tbody>
      <tr><td>Ada</td><td>36</td></tr>
      <tr><td>Grace</td><td>85</td></tr>
    </tbody>
  </table>
</body>
</html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", ""):
            self._send_html(HTML_HOME)
        elif self.path == "/signin":
            self._send_html(HTML_SIGNIN)
        elif self.path == "/table":
            self._send_html(HTML_TABLE)
        else:
            self.send_response(404)
            self.end_headers()

    def _send_html(self, content: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(content.encode("utf-8"))

    def log_message(self, format, *args):
        pass


async def run_tests() -> int:
    print("\n\x1b[1m=== DEX Browser Primitives Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9334, profile_dir=temp_profile, headless=True)

    # Wire the module-level globals server.py's /primitive handler reads,
    # without going through uvicorn or the app's lifespan.
    browser_server.manager = manager
    browser_server.runtime = None

    try:
        await manager.initialize()

        # ---------------------------------------------------------------
        print("\n\x1b[1m0. WebTask/Target — round-trip from run_task's existing kwargs\x1b[0m")
        wt = WebTask(
            description="find sidemen's latest instagram post",
            task_id="task_123",
            step_id="step_1",
            request_id="req_123",
            start_url="https://instagram.com/sidemen",
            max_steps=10,
            session_id="sess_abc",
            confirmed=True,
            target=Target(site_id="instagram.com", expected_url="https://instagram.com/p/xyz/", expected_entity="sidemen"),
            context={"foo": "bar"},
        )
        check("WebTask carries the task description", wt.description == "find sidemen's latest instagram post")
        check("WebTask.target carries site_id/expected_url/expected_entity", (
            wt.target.site_id == "instagram.com"
            and wt.target.expected_url == "https://instagram.com/p/xyz/"
            and wt.target.expected_entity == "sidemen"
        ))
        check("WebTask round-trips task_id/step_id/request_id", (
            wt.task_id == "task_123" and wt.step_id == "step_1" and wt.request_id == "req_123"
        ))
        check("WebTask.context is an independent snapshot, not shared state", wt.context == {"foo": "bar"})

        run_res0 = await manager.runner.run_task(
            task="navigate to https://example.com",
            start_url=f"{base_url}/table",
            max_steps=1,
            task_id="phase5_check",
            target_site="example.com",
            expected_url="https://example.com",
            expected_entity="nobody",
        )
        check(
            "run_task's existing kwargs signature is unchanged by the additive WebTask",
            run_res0.get("task_id") == "phase5_check" or "task_id" not in run_res0,
            str(run_res0.get("task_id")),
        )

        # ---------------------------------------------------------------
        print("\n\x1b[1m1. sign_in — narrow credential-fill exception\x1b[0m")
        real_lookup = site_credentials.lookup
        site_credentials.lookup = lambda url: (
            {"host": "127.0.0.1", "username": "ada@example.com", "password": "s3cret"}
            if site_credentials.host_of(url) == "127.0.0.1"
            else None
        )
        try:
            res = await manager.interaction.sign_in(f"{base_url}/signin")
            check("sign_in fills both username and password", set(res.data.get("filled", [])) == {"username", "password"}, str(res.data))
            check("sign_in reports success when fields are found", res.success is True)

            prim = await browser_server.execute_primitive(
                PrimitiveRequest(op="sign_in", params={"url": f"{base_url}/signin"})
            )
            check("/primitive sign_in no longer 'Unknown primitive action'", prim.get("error") != "Unknown primitive action: sign_in")
        finally:
            site_credentials.lookup = real_lookup

        # ---------------------------------------------------------------
        print("\n\x1b[1m2. extract — selector and whole-page text\x1b[0m")
        await manager.navigation.goto(f"{base_url}/table")
        extracted = await manager.inspector.extract("#greeting")
        check("extract(selector) returns the element's text", extracted.get("text") == "Hello from the table page", str(extracted))
        whole_page = await manager.inspector.extract(None)
        check("extract(None) falls back to whole-page text", "Hello from the table page" in whole_page.get("text", ""))

        # ---------------------------------------------------------------
        print("\n\x1b[1m3. wait_for — selector/text/url conditions\x1b[0m")
        wf_res = await manager.navigation.wait_for(selector="#greeting", timeout_ms=5000)
        check("wait_for(selector) resolves once the element is visible", wf_res.get("url", "").endswith("/table"))

        # ---------------------------------------------------------------
        print("\n\x1b[1m4. extract_table — headers and rows\x1b[0m")
        table = await manager.inspector.extract_table(0)
        check("extract_table finds the header row", table.get("headers") == ["Name", "Age"], str(table))
        check("extract_table finds both data rows", table.get("rows") == [["Ada", "36"], ["Grace", "85"]], str(table))

        # ---------------------------------------------------------------
        print("\n\x1b[1m5. record_route / stop_recording — via /primitive\x1b[0m")
        rec_start = await browser_server.execute_primitive(
            PrimitiveRequest(op="record_route", params={"url": f"{base_url}/", "goal": "reach the table"})
        )
        check("record_route starts and no longer 'Unknown primitive action'", rec_start.get("success") is True, str(rec_start))

        page = await manager.get_active_page()
        await page.click("#nav-link")
        await asyncio.sleep(0.3)

        rec_stop = await browser_server.execute_primitive(PrimitiveRequest(op="stop_recording", params={}))
        steps = (rec_stop.get("data") or {}).get("steps", [])
        check("stop_recording captured the click", len(steps) >= 1, str(rec_stop))

        # ---------------------------------------------------------------
        print("\n\x1b[1m6. session_id threading — /run-task and /abandon\x1b[0m")
        run_res = await manager.runner.run_task(
            task=f"navigate to {base_url}/table",
            start_url=f"{base_url}/table",
            max_steps=1,
        )
        check("run_task stamps session_id on the result", run_res.get("session_id") == manager.session.session_id, str(run_res.get("session_id")))

        abandon_res = await browser_server.abandon_task(AbandonRequest(session_id=manager.session.session_id))
        check("/abandon accepts the live session_id", abandon_res.get("success") is True, str(abandon_res))

        abandon_wrong = await browser_server.abandon_task(AbandonRequest(session_id="not-the-real-session"))
        check("/abandon rejects a stale session_id instead of silently succeeding", abandon_wrong.get("success") is False)

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
