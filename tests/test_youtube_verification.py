"""
YouTube coverage for ActionVerifier.verify_site — the path that used to crash.

Before Phase 3/4 of the WebAdapter migration, agent_runner.py's generic loop
called `self.manager.verifier.verify_youtube_video(...)`, a method that did
not exist on ActionVerifier (only `verify_instagram_post` did). Any YouTube
task reaching that branch raised AttributeError. This exercises the new
generic `verify_site(site_id="youtube", page_type="video", ...)` end to end
against a real (mock) page, including the exact-item-mismatch case the
project's own spec calls out: selecting video A but landing on video B must
FAIL, never pass because "a video is open".

Usage:
    python tests/test_youtube_verification.py
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


def html_watch_page(title: str, channel: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head><title>{title} - YouTube</title></head>
<body>
  <div id="movie_player" style="width:640px;height:360px;background:#000;">video player</div>
  <div id="channel-name">{channel}</div>
</body>
</html>
"""


HTML_CHANNEL_PAGE = """
<!DOCTYPE html>
<html>
<head><title>Sidemen - YouTube</title></head>
<body><h1>Sidemen</h1><p>Channel videos listing, no player here.</p></body>
</html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/watch"):
            if "v=VIDaaaaaaaA" in self.path:
                self._send_html(html_watch_page("Sidemen charity match highlights", "Sidemen"))
            elif "v=VIDbbbbbbbB" in self.path:
                self._send_html(html_watch_page("A completely different video", "Someone Else"))
            else:
                self.send_response(404)
                self.end_headers()
        elif self.path in ("/@sidemen", "/sidemen"):
            self._send_html(HTML_CHANNEL_PAGE)
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
    print("\n\x1b[1m=== YouTube verify_site Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9335, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        print("\n\x1b[1m1. Correct video open with channel and player visible -> PASS\x1b[0m")
        await manager.navigation.goto(f"{base_url}/watch?v=VIDaaaaaaaA")
        res = await manager.verifier.verify_site(
            site_id="youtube",
            page_type="video",
            expected_entity="sidemen",
            expected_id="VIDaaaaaaaA",
        )
        check("verify_site passes for the correct video", res["passed"] is True, res.get("reason"))
        check("target_reached is True", res["target_reached"] is True)

        print("\n\x1b[1m2. Latest-video selection points to A but B opens -> MUST FAIL\x1b[0m")
        await manager.navigation.goto(f"{base_url}/watch?v=VIDbbbbbbbB")
        res2 = await manager.verifier.verify_site(
            site_id="youtube",
            page_type="video",
            expected_entity="sidemen",
            expected_id="VIDaaaaaaaA",
        )
        check("verify_site FAILS when the wrong video id is open", res2["passed"] is False, str(res2))
        check("target_reached is False for the mismatched video", res2["target_reached"] is False)

        print("\n\x1b[1m3. Channel listing page alone (no video open) -> MUST FAIL\x1b[0m")
        await manager.navigation.goto(f"{base_url}/sidemen")
        res3 = await manager.verifier.verify_site(
            site_id="youtube",
            page_type="video",
            expected_entity="sidemen",
        )
        check("verify_site FAILS when only the channel page is open", res3["passed"] is False, str(res3))

        print("\n\x1b[1m4. agent_runner's generic-loop branch no longer crashes on a YouTube task\x1b[0m")
        await manager.navigation.goto(f"{base_url}/watch?v=VIDaaaaaaaA")
        run_res = await manager.runner.run_task(
            task="find the sidemen latest video",
            max_steps=1,
            context={"expected_entity": "sidemen", "expected_video_id": "VIDaaaaaaaA"},
        )
        check(
            "run_task returns a structured result instead of raising AttributeError",
            "error" not in run_res or "verify_youtube_video" not in str(run_res.get("error", "")),
            str(run_res.get("error")),
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
