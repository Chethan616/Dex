"""
Coverage for Interaction.download_media — the fix for "fetch that post and
save it as a download" failing on pages (like Instagram) that expose no
download button/link, where download_file's page.on('download') listener
never fires. download_media instead finds the page's own media element,
resolves its real src, and fetches the bytes through the page's own
authenticated request context (page.request), not a second, cookie-less
fetch.

Usage:
    python tests/test_download_media.py
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


# A real, valid 8x8 red PNG and a smaller 1x1 "avatar" PNG (generated with
# Pillow, not hand-assembled), so the largest-wins selection logic has
# something the browser can actually decode to pick between.
PNG_BIG = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x08\x00\x00\x00\x08\x08\x02\x00\x00\x00Km)\xdc'
    b'\x00\x00\x00\x12IDATx\x9cc\xfc\xcf\x80\x1d0\xe1\x10\x1f\xa4\x12\x00\xcdA\x01\x0f\xe8A\xe2o'
    b'\x00\x00\x00\x00IEND\xaeB`\x82'
)
PNG_SMALL = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
    b'\x00\x00\x00\x0cIDATx\x9cc`\xf8\xcf\x00\x00\x02\x02\x01\x00{\t\x81x'
    b'\x00\x00\x00\x00IEND\xaeB`\x82'
)

HTML_POST_PAGE = """
<!DOCTYPE html>
<html><head><title>Fake Post</title></head>
<body>
  <img src="/avatar.png" width="1" height="1" alt="avatar" />
  <article>
    <header>testaccount</header>
    <img src="/post.png" alt="the actual post image" />
    <p>A caption, so this page has real visible text like an actual post does.</p>
  </article>
</body>
</html>
"""

HTML_NO_MEDIA_PAGE = """
<!DOCTYPE html>
<html><head><title>No Media Here</title></head>
<body><p>Just text, nothing to download.</p></body></html>
"""


class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/post":
            self._send(HTML_POST_PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/no-media":
            self._send(HTML_NO_MEDIA_PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/post.png":
            self._send(PNG_BIG, "image/png")
        elif self.path == "/avatar.png":
            self._send(PNG_SMALL, "image/png")
        else:
            self.send_response(404)
            self.end_headers()

    def _send(self, body: bytes, content_type: str):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


async def run_tests() -> int:
    print("\n\x1b[1m=== download_media Regression Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))
    manager = BrowserManager(cdp_port=9339, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        print("\n\x1b[1m1. download_media picks the largest media element, not the first\x1b[0m")
        await manager.navigation.goto(f"{base_url}/post")
        temp_out = tempfile.mkdtemp(prefix="dex_test_downloads_")
        res = await manager.interaction.download_media(save_directory=temp_out)
        check("download_media succeeds", res.success is True, res.error)
        check("picked the larger post image, not the 1x1 avatar", res.data.get("src", "").endswith("/post.png"), str(res.data))
        saved_path = Path(res.data.get("path", ""))
        check("file actually exists on disk", saved_path.is_file())
        check("saved bytes match the real PNG size", res.data.get("bytes") == len(PNG_BIG), str(res.data.get("bytes")))

        print("\n\x1b[1m2. A page with no media fails cleanly (no false success)\x1b[0m")
        await manager.navigation.goto(f"{base_url}/no-media")
        res2 = await manager.interaction.download_media(save_directory=temp_out)
        check("download_media fails when there's nothing to download", res2.success is False)
        check("error names the actual problem", "No image or video" in (res2.error or ""), res2.error)

        print("\n\x1b[1m3. Wired into the internal action vocabulary and artifact registration\x1b[0m")
        await manager.navigation.goto(f"{base_url}/post")
        manager.runner._heuristic_decision = lambda task, elements, current_url, history: (
            {"type": "download_media", "_tier": "heuristic"},
            1.0,
        )
        # Force completion on the next iteration so the loop doesn't need a
        # real LLM call to finish after the download step.
        call_count = {"n": 0}
        real_heuristic = manager.runner._heuristic_decision

        def sequenced(task, elements, current_url, history):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return real_heuristic(task, elements, current_url, history)
            return (
                {"type": "done", "is_complete": True, "summary": "Downloaded the post image.", "_tier": "heuristic"},
                1.0,
            )

        manager.runner._heuristic_decision = sequenced
        # Deliberately phrased as a pure download action, not "save this
        # post" — a real multi-step system resolves the target (which post,
        # which entity) in an earlier turn/step, so this sub-task's job is
        # only to download from the already-correct page, not re-verify a
        # social-media target it was never given the entity for.
        run_res = await manager.runner.run_task(
            task="download the image from this page",
            start_url=f"{base_url}/post",
            max_steps=5,
        )
        check("run_task succeeds end to end", run_res.get("success") is True, str(run_res.get("error")))
        downloads = run_res.get("downloads", [])
        check("the downloaded media appears in downloads[]", len(downloads) >= 1, str(downloads))
        if downloads:
            check(
                "the artifact's locator points at a real saved file",
                Path(downloads[0].get("locator", "")).is_file(),
                str(downloads[0]),
            )

        shutil.rmtree(temp_out, ignore_errors=True)
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
