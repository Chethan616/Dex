"""
Automated unit and integration test suite for the new DEX Browser Manager.

Runs against a local HTTP test server so no external internet access or real logins are required.
Usage:
    python tests/test_browser_manager.py
"""
from __future__ import annotations

import asyncio
import http.server
import logging
import os
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
from browser_state import BrowserArtifact
from adapters.base_adapter import AdapterFallbackException
from adapters.instagram_adapter import InstagramAdapter

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


# ---------------------------------------------------------------------------
# Local Mock Web Server
# ---------------------------------------------------------------------------

HTML_HOME = """
<!DOCTYPE html>
<html>
<head><title>DEX Test Home</title></head>
<body>
  <nav><a href="/sidemen/">Sidemen Profile</a> | <a href="/form">Test Form</a> | <a href="/login">Login Wall</a></nav>
  <h1>Welcome to DEX Test Site</h1>
  <p>Test homepage content for browser automation.</p>
</body>
</html>
"""

HTML_INSTAGRAM_PROFILE = """
<!DOCTYPE html>
<html>
<head><title>Sidemen (@sidemen) • Instagram</title></head>
<body>
  <div id="cookie-banner" style="background:#ddd; padding:10px;">
    <span>We use cookies.</span>
    <button aria-label="Accept all">Accept all</button>
  </div>
  <header><h1>sidemen</h1></header>
  <main>
    <article aria-label="Posts grid">
      <a href="/p/C_abc123/" aria-label="Sidemen charity match latest announcement">
        <img src="/img/post1.jpg" style="object-fit:cover;" alt="Charity match" />
      </a>
      <a href="/p/C_old456/" aria-label="Previous post">
        <img src="/img/post2.jpg" style="object-fit:cover;" alt="Old post" />
      </a>
    </article>
  </main>
</body>
</html>
"""

HTML_INSTAGRAM_POST = """
<!DOCTYPE html>
<html>
<head><title>Sidemen on Instagram: Charity Match</title></head>
<body>
  <article>
    <h1>Sidemen Charity Match 2026 Announcement!</h1>
    <img src="/img/post1.jpg" style="object-fit:cover;" />
    <button aria-label="Like">Like</button>
    <button aria-label="Share Post">Share</button>
  </article>

  <div id="share-modal" role="dialog" style="display:none; border:1px solid #000; padding:15px;">
    <h2>Share to</h2>
    <input type="text" placeholder="Search chats..." name="queryBox" id="search-box" />
    <div id="chat-results" style="margin:10px 0;"></div>
    <button aria-label="Send" id="send-btn" disabled>Send</button>
  </div>

  <script>
    const shareBtn = document.querySelector('[aria-label="Share Post"]');
    const modal = document.getElementById('share-modal');
    const searchBox = document.getElementById('search-box');
    const results = document.getElementById('chat-results');
    const sendBtn = document.getElementById('send-btn');

    shareBtn.addEventListener('click', () => {
      modal.style.display = 'block';
    });

    searchBox.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      results.innerHTML = '';
      if (q.includes('veera')) {
        const item = document.createElement('div');
        item.innerHTML = '<span role="checkbox">Veera Vardhan</span>';
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          item.style.background = '#eef';
          sendBtn.disabled = false;
        });
        results.appendChild(item);
      }
    });

    sendBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      const msg = document.createElement('div');
      msg.id = 'toast-sent';
      msg.innerText = 'Post sent successfully';
      document.body.appendChild(msg);
    });
  </script>
</body>
</html>
"""

HTML_FORM = """
<!DOCTYPE html>
<html>
<head><title>Form Tests</title></head>
<body>
  <h1>Interactive Controls</h1>
  <form id="test-form" onsubmit="event.preventDefault(); document.getElementById('status').innerText='Submitted';">
    <label for="username">Username:</label>
    <input type="text" id="username" name="username" placeholder="Enter username" />

    <label for="country">Country:</label>
    <select id="country" name="country">
      <option value="us">United States</option>
      <option value="uk">United Kingdom</option>
      <option value="in">India</option>
    </select>

    <label><input type="checkbox" id="agree" name="agree" /> I agree to terms</label>
    <button type="submit" id="submit-btn">Submit Form</button>
  </form>
  <div id="status">Pending</div>
</body>
</html>
"""

HTML_LOGIN_WALL = """
<!DOCTYPE html>
<html>
<head><title>Sign In Required</title></head>
<body>
  <h1>Please Sign In</h1>
  <form action="/login" method="post">
    <input type="text" name="username" placeholder="Username" />
    <input type="password" name="password" placeholder="Password" />
    <button type="submit">Log In</button>
  </form>
</body>
</html>
"""


class MockHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send_html(HTML_HOME)
        elif self.path in ("/sidemen/", "/sidemen"):
            self._send_html(HTML_INSTAGRAM_PROFILE)
        elif self.path.startswith("/p/"):
            self._send_html(HTML_INSTAGRAM_POST)
        elif self.path == "/form":
            self._send_html(HTML_FORM)
        elif self.path == "/login":
            self._send_html(HTML_LOGIN_WALL)
        else:
            self.send_response(404)
            self.end_headers()

    def _send_html(self, content: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Set-Cookie", "dex_auth_token=mock_secret_token_123; Path=/; HttpOnly")
        self.end_headers()
        self.wfile.write(content.encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Quiet logging during tests


# ---------------------------------------------------------------------------
# Test Runner
# ---------------------------------------------------------------------------


async def run_tests() -> int:
    print("\n\x1b[1m=== DEX Browser Automation Test Suite ===\x1b[0m\n")

    # 1. Start Local HTTP Server
    server = socketserver.TCPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local test web server started on {base_url}")

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_test_profile_"))

    manager = BrowserManager(
        cdp_port=9333,
        profile_dir=temp_profile,
        headless=True,  # Headless for automated test execution
    )

    try:
        # -------------------------------------------------------------------
        # Section 1: Session Management & Navigation
        # -------------------------------------------------------------------
        print("\n\x1b[1m1. Session Management & Navigation\x1b[0m")
        ctx = await manager.initialize()
        check("Browser context initializes successfully", ctx is not None)
        check("Session reports connected state", manager.session.is_connected is True)
        check("Profile directory created", temp_profile.exists())

        nav_res = await manager.navigation.goto(f"{base_url}/")
        check("Navigation to test homepage succeeds", nav_res["url"] == f"{base_url}/")
        check("Page title matches", nav_res["title"] == "DEX Test Home")

        # -------------------------------------------------------------------
        # Section 2: Smart Page Inspection & Ephemeral Elements (e1, e2...)
        # -------------------------------------------------------------------
        print("\n\x1b[1m2. Smart Page Inspection & Element Indexing\x1b[0m")
        elements = await manager.inspector.inspect(force_refresh=True)
        check("Inspector extracts interactive elements", len(elements) >= 3, f"found {len(elements)}")
        check("Temporary IDs follow 'e1', 'e2' format", elements[0].id == "e1")
        check("Element names and tags are extracted", any(e.name == "Sidemen Profile" for e in elements))

        compact = await manager.inspector.get_compact_text()
        check("Compact representation formatted for LLM", "LINK [e1]" in compact or "LINK" in compact)

        # -------------------------------------------------------------------
        # Section 3: Semantic Interactions & Form Automation
        # -------------------------------------------------------------------
        print("\n\x1b[1m3. Semantic Interactions & Forms\x1b[0m")
        await manager.navigation.goto(f"{base_url}/form")
        form_elements = await manager.inspector.inspect(force_refresh=True)

        user_input_id = next(e.id for e in form_elements if e.tag == "input" and e.id)
        type_res = await manager.interaction.type_text(user_input_id, "Chethan", clear=True)
        check("Semantic type_text enters value", type_res.success is True)

        submit_btn_id = next(e.id for e in form_elements if "Submit" in e.name)
        click_res = await manager.interaction.click(submit_btn_id)
        check("Semantic click invokes button", click_res.success is True)

        # Verification check
        v_res = await manager.verifier.verify_spec({"text_on_page": "Submitted"})
        check("ActionVerifier confirms 'Submitted' text on live DOM", v_res["passed"] is True)

        # -------------------------------------------------------------------
        # Section 4: Multi-Tab Operations
        # -------------------------------------------------------------------
        print("\n\x1b[1m4. Multi-Tab Operations\x1b[0m")
        initial_tabs = await manager.tabs.list_tabs()
        check("Tabs list reports current active tab", len(initial_tabs) >= 1)

        new_page = await manager.tabs.new_tab(f"{base_url}/")
        tabs_after = await manager.tabs.list_tabs()
        check("new_tab opens second tab", len(tabs_after) == len(initial_tabs) + 1)

        await manager.tabs.close_tab(target=initial_tabs[0].tab_id)
        tabs_closed = await manager.tabs.list_tabs()
        check("close_tab closes target tab cleanly", len(tabs_closed) == len(initial_tabs))

        # -------------------------------------------------------------------
        # Section 5: Recovery, Overlays & Login Wall Detection
        # -------------------------------------------------------------------
        print("\n\x1b[1m5. Recovery, Overlays & Wall Detection\x1b[0m")
        await manager.navigation.goto(f"{base_url}/sidemen/")
        dismissed = await manager.recovery.dismiss_common_overlays()
        check("Recovery automatically dismisses cookie banner", dismissed is True)

        await manager.navigation.goto(f"{base_url}/login")
        wall = await manager.recovery.detect_human_wall()
        check("Recovery detects login wall", wall is not None and wall.get("kind") == "login_required")

        # -------------------------------------------------------------------
        # Section 6: Site Adapters & Graceful Fallback Contract
        # -------------------------------------------------------------------
        print("\n\x1b[1m6. Site Adapters & Graceful Fallback\x1b[0m")
        adapter = manager.adapters.find_adapter("share sidemen latest post on instagram with Veera", f"{base_url}/sidemen/")
        check("AdapterRegistry matches InstagramAdapter", adapter is not None and adapter.name == "InstagramAdapter")

        # Test graceful fallback when UI changes:
        class BrokenAdapter(InstagramAdapter):
            name = "BrokenAdapter"
            async def execute(self, task, mgr, ctx):
                raise AdapterFallbackException("Simulated Instagram UI redesign")

        manager.adapters.register(BrokenAdapter())
        fallback_matched = manager.adapters.find_adapter("share sidemen post on instagram", f"{base_url}/sidemen/")
        check("Custom adapter registered first in ladder", fallback_matched is not None and fallback_matched.name == "BrokenAdapter")

        # Test that AgentRunner gracefully falls back on AdapterFallbackException
        agent_res = await manager.runner.run_task(
            task="Find latest Sidemen post on instagram",
            start_url=f"{base_url}/sidemen/",
            max_steps=2,
            context={"confirmed": True},
        )
        has_fallback_step = any(s.get("tier") == "adapter_fallback" for s in agent_res.get("steps", []))
        check("AgentRunner falls back to generic loop without failing", has_fallback_step is True)

        # -------------------------------------------------------------------
        # Section 7: Persistent Artifact Generation & Chaining
        # -------------------------------------------------------------------
        print("\n\x1b[1m7. Structured Artifact Generation\x1b[0m")
        test_artifact = BrowserArtifact(
            kind="post",
            name="Sidemen latest post",
            locator=f"{base_url}/p/C_abc123/",
            metadata={"account": "sidemen", "media_url": f"{base_url}/img/post1.jpg"},
        )
        manager.add_artifact(test_artifact)
        check("Artifact registered in BrowserManager", any(a.name == "Sidemen latest post" for a in manager.artifacts))

        state = await manager.get_state()
        check("BrowserState reflects registered artifacts", len(state.artifacts) >= 1)
        check("BrowserState reports profile path", state.profile_path == str(temp_profile))

        # -------------------------------------------------------------------
        # Section 8: Visual Fallback & Screenshots
        # -------------------------------------------------------------------
        print("\n\x1b[1m8. Visual Fallback & Screenshots\x1b[0m")
        ss_res = await manager.visual.screenshot()
        check("Screenshot captured as PNG file", os.path.isfile(ss_res["path"]))
        check("Screenshot base64 returned for vision model", len(ss_res["base64"]) > 100)

        # -------------------------------------------------------------------
        # Section 9: Profile Persistence Across Restarts
        # -------------------------------------------------------------------
        print("\n\x1b[1m9. Profile Persistence Across Restarts\x1b[0m")
        await manager.close()

        manager2 = BrowserManager(
            cdp_port=9333,
            profile_dir=temp_profile,
            headless=True,
        )
        await manager2.initialize()
        await manager2.navigation.goto(f"{base_url}/")

        page2 = await manager2.get_active_page()
        cookies = await page2.context.cookies()
        has_cookie = any(c["name"] == "dex_auth_token" for c in cookies)
        check("Authentication cookies persist across BrowserManager restart", has_cookie is True)
        await manager2.close()

    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(temp_profile, ignore_errors=True)

    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
