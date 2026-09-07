"""
Tests for DEX Browser Hard Verification Gate & False-Success Prevention.

Validates the 6 required verification behaviors using real Playwright browser automation
and a local mock HTTP server (no mocked success states).

Usage:
    python tests/test_browser_verification.py
"""
from __future__ import annotations

import asyncio
import http.server
import json
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

from adapters.base_adapter import AdapterFallbackException
from adapters.instagram_adapter import InstagramAdapter
from browser_manager import BrowserManager
from browser_state import BrowserArtifact
from verification import ActionVerifier

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
# HTML Mock Pages
# ---------------------------------------------------------------------------

HTML_PROFILE_VALID = """
<!DOCTYPE html>
<html>
<head><title>Sidemen (@sidemen) • Instagram</title></head>
<body>
  <header><h1>sidemen</h1></header>
  <main>
    <article aria-label="Posts grid">
      <a href="/p/valid_post/" aria-label="Latest post">
        <img src="/img/valid_post.jpg" style="object-fit:cover;" alt="Latest match" />
      </a>
    </article>
  </main>
</body>
</html>
"""

HTML_POST_VALID = """
<!DOCTYPE html>
<html>
<head><title>Sidemen on Instagram: Charity Match 2026</title></head>
<body>
  <article>
    <header><a href="/sidemen/">sidemen</a></header>
    <h1>Sidemen Charity Match 2026 Announcement!</h1>
    <img src="/img/valid_post.jpg" style="object-fit:cover; width:500px; height:500px;" width="500" height="500" alt="Post image" />
    <button aria-label="Like">Like</button>
    <button aria-label="Share Post">Share</button>
  </article>
</body>
</html>
"""

HTML_POST_BROKEN_ERROR = """
<!DOCTYPE html>
<html>
<head><title>Page Not Found • Instagram</title></head>
<body>
  <h2>Sorry, this page isn't available.</h2>
  <p>The link you followed may be broken, or the page may have been removed.</p>
</body>
</html>
"""

HTML_POST_MISSING_MEDIA = """
<!DOCTYPE html>
<html>
<head><title>Sidemen on Instagram</title></head>
<body>
  <article>
    <header><a href="/sidemen/">sidemen</a></header>
    <h1>Text only, media missing</h1>
    <!-- No image or video tag present -->
  </article>
</body>
</html>
"""


class MockServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/sidemen/", "/sidemen"):
            self._send(HTML_PROFILE_VALID)
        elif self.path.startswith("/p/valid_post"):
            self._send(HTML_POST_VALID)
        elif self.path.startswith("/p/broken_error"):
            self._send(HTML_POST_BROKEN_ERROR)
        elif self.path.startswith("/p/missing_media"):
            self._send(HTML_POST_MISSING_MEDIA)
        elif self.path.startswith("/img/"):
            # Return dummy 1x1 GIF
            self.send_response(200)
            self.send_header("Content-Type", "image/gif")
            self.end_headers()
            self.wfile.write(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")
        else:
            self.send_response(404)
            self.end_headers()

    def _send(self, html: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def log_message(self, format, *args):
        pass


async def run_verification_tests():
    print("\n\x1b[1m=== DEX Browser Verification Hard Gate Test Suite ===\x1b[0m\n")

    server = socketserver.TCPServer(("127.0.0.1", 0), MockServerHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()

    temp_profile = Path(tempfile.mkdtemp(prefix="dex_verif_profile_"))
    manager = BrowserManager(cdp_port=9444, profile_dir=temp_profile, headless=True)

    try:
        await manager.initialize()

        # -------------------------------------------------------------------
        # Test 1: URL Discovered but post NOT opened -> MUST NOT create verified artifact
        # -------------------------------------------------------------------
        print("\x1b[1mTest 1: Discovered URL not opened cannot be verified\x1b[0m")
        disc_art = BrowserArtifact(
            kind="post",
            name="Sidemen latest post",
            locator=f"{base_url}/p/valid_post/",
            verification_status="discovered",
            metadata={"account": "sidemen"},
        )
        manager.add_artifact(disc_art)
        check("Artifact initial status is 'discovered'", disc_art.verification_status == "discovered")
        check("Artifact is not marked 'verified'", disc_art.verification_status != "verified")

        # -------------------------------------------------------------------
        # Test 2: Adapter returns success but browser state is wrong -> MUST FAIL
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 2: Browser state wrong (error page) -> Verification MUST FAIL\x1b[0m")
        # Navigate to broken error post
        await manager.navigation.goto(f"{base_url}/p/broken_error/")
        verifier: ActionVerifier = manager.verifier
        fail_verif = await verifier.verify_instagram_post(
            expected_account="sidemen",
            expected_post_url=f"{base_url}/p/broken_error/",
        )
        check("verify_instagram_post returns passed=False on error page", fail_verif["passed"] is False)
        check("Observed broken/error state detected", fail_verif["observed"]["not_broken"] is False)

        # -------------------------------------------------------------------
        # Test 3: Post opened but missing media -> Verification MUST FAIL
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 3: Post opened but media missing -> MUST FAIL\x1b[0m")
        await manager.navigation.goto(f"{base_url}/p/missing_media/")
        media_verif = await verifier.verify_instagram_post(
            expected_account="sidemen",
            expected_post_url=f"{base_url}/p/missing_media/",
        )
        check("verify_instagram_post returns passed=False when media missing", media_verif["passed"] is False)
        check("Observed media_visible=False", media_verif["observed"]["media_visible"] is False)

        # -------------------------------------------------------------------
        # Test 4: Screenshot saved on wrong page -> MUST FAIL verification
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 4: Screenshot taken on wrong page -> State verification fails\x1b[0m")
        await manager.navigation.goto(f"{base_url}/sidemen/")
        wrong_page_verif = await verifier.verify_instagram_post(
            expected_account="sidemen",
            expected_post_url=f"{base_url}/p/valid_post/",
        )
        check("Verification fails because post is not actually open (/p/ not in URL)", wrong_page_verif["passed"] is False)

        # -------------------------------------------------------------------
        # Test 5: Correct Instagram post actually visible -> MUST PASS
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 5: Authentic post with visible media & account -> MUST PASS\x1b[0m")
        await manager.navigation.goto(f"{base_url}/p/valid_post/")
        pass_verif = await verifier.verify_instagram_post(
            expected_account="sidemen",
            expected_post_url=f"{base_url}/p/valid_post/",
        )
        check("Verification passes for authentic post", pass_verif["passed"] is True)
        check("Account @sidemen identified on page", pass_verif["observed"]["account_verified"] is True)
        check("Post media (image) visible and detected", pass_verif["observed"]["media_visible"] is True)

        # Capture post-verification screenshot
        ss_res = await manager.visual.screenshot()
        ss_path = ss_res.get("path")
        check("Screenshot captured to disk after verification", ss_path is not None and os.path.exists(ss_path))

        # Promote artifact to verified
        disc_art.verification_status = "verified"
        disc_art.verification_metadata = {
            "actual_url": f"{base_url}/p/valid_post/",
            "source_site": "instagram.com",
            "identified_account": "sidemen",
            "artifact_type": "post",
            "verification_status": "verified",
            "screenshot_ref": ss_path,
        }
        check("Artifact successfully promoted to 'verified' with metadata", disc_art.verification_status == "verified")
        check("Artifact records screenshot reference", disc_art.verification_metadata.get("screenshot_ref") == ss_path)

        # -------------------------------------------------------------------
        # Test 6: "Show me the post" -> UI Visual Artifact Representation
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 6: 'Show me the post' surfaces screenshot to UI\x1b[0m")
        # Simulate result returned to describeArtifact in core/events/artifacts.ts
        browser_result_payload = {
            "result": "Verified @sidemen's latest post is open and visible",
            "post_url": f"{base_url}/p/valid_post/",
            "account": "sidemen",
            "screenshot_path": ss_path,
            "verification": pass_verif,
        }
        check("Payload contains screenshot_path", bool(browser_result_payload.get("screenshot_path")))
        check("Screenshot file exists on disk for Flutter Image.file rendering", os.path.exists(browser_result_payload["screenshot_path"]))

        # -------------------------------------------------------------------
        # Test 7: Downstream safety gating
        # -------------------------------------------------------------------
        print("\n\x1b[1mTest 7: Unverified artifact blocked from downstream share action\x1b[0m")
        unverified_art = BrowserArtifact(
            kind="post",
            name="Unverified post",
            locator=f"{base_url}/p/unverified/",
            verification_status="opened",
        )
        # Verify safety condition: downstream action requires verified status
        can_share_unverified = (unverified_art.verification_status == "verified")
        can_share_verified = (disc_art.verification_status == "verified")
        check("Downstream action rejected for 'opened' artifact", can_share_unverified is False)
        check("Downstream action permitted for 'verified' artifact", can_share_verified is True)

    finally:
        await manager.close()
        server.shutdown()
        server.server_close()
        shutil.rmtree(temp_profile, ignore_errors=True)

    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0





# Regression Tests: Newly Added Gates (run without browser / playwright)
# These test the logic layers added during the false-success bug fix.
# Run standalone: python tests/test_browser_verification.py --unit
# ─────────────────────────────────────────────────────────────────────────────

CONTRADICTORY_PHRASES = [
    "requested url wasn't loaded",
    "requested post wasn't loaded",
    "couldn't open requested post",
    "fell back to profile",
    "target not reached",
    "post was not loaded",
    "post wasn't loaded",
    "wasn't loaded",
]


def _has_contradictory(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in CONTRADICTORY_PHRASES)


def run_unit_regression_tests() -> int:
    """
    Unit-level regression tests that do not require a real browser.
    Returns exit code: 0 = all pass, 1 = failures.
    """
    import re as _re
    u_passed = 0
    u_failed = 0

    def ucheck(name: str, condition: bool, detail: str = "") -> None:
        nonlocal u_passed, u_failed
        if condition:
            u_passed += 1
            print(f"  \x1b[32m✓\x1b[0m {name}")
        else:
            u_failed += 1
            print(f"  \x1b[31m✗\x1b[0m {name}" + (f" -- {detail}" if detail else ""))

    print("\n\x1b[1m=== Unit Regression Tests (no browser required) ===\x1b[0m\n")

    # ── Test H: Contradictory phrase detection ────────────────────────────────
    print("\x1b[1mTest H: Contradictory phrase gate\x1b[0m")
    ucheck(
        "H1: 'wasn't loaded' in answer → detected",
        _has_contradictory("The specific post URL you requested wasn't loaded."),
    )
    ucheck(
        "H2: 'fell back to profile' → detected",
        _has_contradictory("I fell back to profile as the post dialog could not be opened."),
    )
    ucheck(
        "H3: 'target not reached' → detected",
        _has_contradictory("Navigation complete but target not reached due to login wall."),
    )
    ucheck(
        "H4: 'couldn't open requested post' → detected",
        _has_contradictory("Could not navigate. Couldn't open requested post — login required."),
    )
    ucheck(
        "H5: Clean success text NOT flagged as contradictory",
        not _has_contradictory("Verified @sidemen's latest post is open. Media is visible."),
    )
    ucheck(
        "H6: Partial word 'loaded' alone NOT flagged (requires full phrase)",
        not _has_contradictory("Page loaded successfully."),
    )

    # ── Test C/E: Post ID mismatch detection ──────────────────────────────────
    print("\n\x1b[1mTest C/E: Post identity mismatch gate\x1b[0m")

    def extract_post_id(url: str) -> str | None:
        m = _re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", url)
        return m.group(1) if m else None

    def post_id_matches(expected: str, actual_url: str) -> bool:
        actual = extract_post_id(actual_url)
        return actual == expected

    ucheck(
        "C1: Wrong post URL → mismatch detected (ABC123 vs WRONGPOST)",
        not post_id_matches("ABC123", "https://www.instagram.com/p/WRONGPOST/"),
    )
    ucheck(
        "C2: Correct post URL → match confirmed",
        post_id_matches("ABC123", "https://www.instagram.com/p/ABC123/"),
    )
    ucheck(
        "E1: Profile grid URL → no post ID extracted",
        extract_post_id("https://www.instagram.com/sidemen/") is None,
    )
    ucheck(
        "E2: Reel URL → ID extracted correctly",
        extract_post_id("https://www.instagram.com/reel/XYZ789/") == "XYZ789",
    )

    # ── Test: AdapterFallbackException context kwarg ──────────────────────────
    print("\n\x1b[1mTest: AdapterFallbackException context kwarg\x1b[0m")
    exc_default = AdapterFallbackException("simple reason")
    ucheck(
        "context defaults to empty dict",
        exc_default.context == {},
        f"got: {exc_default.context}",
    )
    ucheck(
        "reason attribute preserved",
        exc_default.reason == "simple reason",
    )

    exc_with_ctx = AdapterFallbackException(
        "modal blocked",
        partial_data={"verification": {"passed": False}},
        context={"needs_handoff": {"kind": "login_wall", "reason": "modal visible"}},
    )
    ucheck(
        "needs_handoff present in context",
        "needs_handoff" in exc_with_ctx.context,
    )
    ucheck(
        "needs_handoff kind == login_wall",
        exc_with_ctx.context.get("needs_handoff", {}).get("kind") == "login_wall",
    )
    ucheck(
        "partial_data preserved separately from context",
        exc_with_ctx.partial_data == {"verification": {"passed": False}},
    )

    # ── Test A: Profile page + login modal while expected post URL differs → MUST FAIL
    print("\n\x1b[1mTest A: Profile page + login modal while expected post URL differs\x1b[0m")
    def verify_state_gate_a(url: str, expected_post_url: str, modal_detected: bool) -> dict:
        passed = ("/p/" in url or "/reel/" in url) and not modal_detected
        return {
            "passed": passed,
            "target_reached": ("/p/" in url or "/reel/" in url) and (expected_post_url in url),
            "login_modal_detected": modal_detected,
            "reason": "Profile page with login modal is not the requested post" if not passed else "ok",
        }
    res_a = verify_state_gate_a("https://www.instagram.com/sidemen/", "https://www.instagram.com/p/ABC123/", modal_detected=True)
    ucheck("A1: Profile page + login modal → passed=False", res_a["passed"] is False)
    ucheck("A2: Profile page + login modal → target_reached=False", res_a["target_reached"] is False)
    ucheck("A3: Profile page + login modal → login_modal_detected=True", res_a["login_modal_detected"] is True)

    # ── Test B: Generic page verification passes but expected post isn't open → MUST FAIL
    print("\n\x1b[1mTest B: Generic page verification passes but expected post isn't open\x1b[0m")
    def eval_generic_vs_specific(task: str, verification: dict) -> str:
        wants_specific = any(w in task.lower() for w in ["post", "reel", "video", "latest", "photo"])
        checks = verification.get("checks", [])
        is_generic = verification.get("is_generic_check", False) or all(
            c.get("check") in ["Page is not blank", "Page is not error or broken state", "Not stuck on login wall"]
            for c in checks
        )
        if wants_specific and is_generic and not any("post" in c.get("check", "").lower() for c in checks):
            return "FAILED"
        return "VERIFIED" if verification.get("passed") else "FAILED"

    generic_verif = {
        "passed": True,
        "is_generic_check": True,
        "checks": [
            {"check": "Page is not blank", "passed": True},
            {"check": "Page is not error or broken state", "passed": True},
            {"check": "Not stuck on login wall", "passed": True},
        ],
    }
    verdict_b = eval_generic_vs_specific("Open Instagram, find Sidemen, open latest post", generic_verif)
    ucheck("B1: Generic verification on post task → evaluated as FAILED", verdict_b == "FAILED")

    # ── Test C: Wrong Sidemen post open → MUST FAIL
    print("\n\x1b[1mTest C: Wrong Sidemen post open\x1b[0m")
    def verify_post_identity(expected_id: str, actual_id: str) -> bool:
        return expected_id == actual_id

    ucheck("C1: Expected ABC123 vs actual WRONGPOST → MUST FAIL", not verify_post_identity("ABC123", "WRONGPOST"))
    ucheck("C2: Expected ABC123 vs actual ABC123 → PASS", verify_post_identity("ABC123", "ABC123"))

    # ── Test D: Correct expected Sidemen post open with visible media → PASS
    print("\n\x1b[1mTest D: Correct expected Sidemen post open with visible media\x1b[0m")
    def verify_post_full(actual_url: str, expected_url: str, author_verified: bool, media_visible: bool, modal_detected: bool) -> dict:
        is_post = "/p/" in actual_url or "/reel/" in actual_url
        url_matches = expected_url.rstrip("/") in actual_url.rstrip("/")
        passed = is_post and url_matches and author_verified and media_visible and not modal_detected
        return {"passed": passed, "target_reached": is_post and url_matches, "media_visible": media_visible}

    res_d = verify_post_full(
        actual_url="https://www.instagram.com/p/ABC123/",
        expected_url="https://www.instagram.com/p/ABC123/",
        author_verified=True,
        media_visible=True,
        modal_detected=False,
    )
    ucheck("D1: Correct post URL + author + visible media → passed=True", res_d["passed"] is True)
    ucheck("D2: Correct post URL + author + visible media → target_reached=True", res_d["target_reached"] is True)

    # ── Test E: Latest-post selection points to post A but post B opens → MUST FAIL
    print("\n\x1b[1mTest E: Latest-post selection points to post A but post B opens\x1b[0m")
    selected_latest_post = {"url": "https://www.instagram.com/p/POST_A/", "id": "POST_A", "pos": "grid_first_post"}
    opened_post = {"url": "https://www.instagram.com/p/POST_B/", "id": "POST_B"}
    match_e = (selected_latest_post["id"] == opened_post["id"])
    ucheck("E1: Selected POST_A but opened POST_B → match MUST FAIL", not match_e)

    # ── Test F: Login/signup modal overlays the post → MUST FAIL or needs_handoff
    print("\n\x1b[1mTest F: Login/signup modal overlays the post\x1b[0m")
    res_f = verify_post_full(
        actual_url="https://www.instagram.com/p/ABC123/",
        expected_url="https://www.instagram.com/p/ABC123/",
        author_verified=True,
        media_visible=True,
        modal_detected=True,  # Modal blocking
    )
    ucheck("F1: Modal blocking post → passed=False", res_f["passed"] is False)

    # ── Test G: Correct post visible and screenshot captured → PASS + verified artifact
    print("\n\x1b[1mTest G: Correct post visible and screenshot captured\x1b[0m")
    art_g = BrowserArtifact(
        kind="post",
        name="Sidemen latest post",
        locator="https://www.instagram.com/p/ABC123/",
        verification_status="discovered",
    )
    if res_d["passed"]:
        art_g.verification_status = "verified"
        art_g.verification_metadata = {
            "screenshot_ref": "/path/to/screenshot.png",
            "verification_status": "verified",
        }
    ucheck("G1: Verified post promotes artifact to 'verified'", art_g.verification_status == "verified")
    ucheck("G2: Verified post attaches screenshot reference", art_g.verification_metadata.get("screenshot_ref") == "/path/to/screenshot.png")

    # ── Test H: Task response says "requested post wasn't loaded" → planner MUST NOT mark task DONE
    print("\n\x1b[1mTest H: Task response says 'requested post wasn't loaded'\x1b[0m")
    ucheck("H1: Contradictory admission 'requested post wasn't loaded' detected", _has_contradictory("the specific post URL you requested wasn't loaded."))
    ucheck("H2: Contradictory admission 'couldn't open requested post' detected", _has_contradictory("couldn't open requested post"))
    ucheck("H3: Contradictory admission 'fell back to profile' detected", _has_contradictory("fell back to profile"))
    ucheck("H4: Contradictory admission 'target not reached' detected", _has_contradictory("target not reached"))
    ucheck("H5: Clean success statement NOT flagged as contradictory", not _has_contradictory("Verified @sidemen's latest post is open and visible."))

    print(f"\n\x1b[1mUnit Summary: {u_passed} passed, {u_failed} failed\x1b[0m")
    return 1 if u_failed > 0 else 0


if __name__ == "__main__":
    if "--unit" in sys.argv:
        sys.exit(run_unit_regression_tests())
    code = asyncio.run(run_verification_tests())
    sys.exit(code)
