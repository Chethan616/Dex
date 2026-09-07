"""
Unit tests for DEX Browser Cross-Task Isolation & State Scoping.
Validates:
1. Adapter selection does not get hijacked by stale current_url from previous tasks.
2. ArtifactStore & BrowserManager partition artifacts by task_id.
3. Mode B ('in my browser') raises clear error when CDP is unavailable without silent fallback.
4. YouTube exact identity tracking matches selected video URL/ID.
"""
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "browser"))
sys.path.insert(0, str(ROOT / "agents"))

from adapters.registry import AdapterRegistry
from adapters.instagram_adapter import InstagramAdapter, extract_instagram_account
from agent_runner import _is_navigation_only_task
from adapters.youtube_adapter import YouTubeAdapter
from browser_state import BrowserArtifact
from browser_manager import BrowserManager
from session_manager import SessionManager, MODE_B_USER_ATTACHED

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

def test_adapter_isolation():
    print("\n\x1b[1mTest 1: Cross-site adapter isolation (no tab hijacking)\x1b[0m")
    registry = AdapterRegistry()
    stale_instagram_url = "https://www.instagram.com/netflixuk/reel/DBC123/"

    # Case 1A: User asks for YouTube while tab is on Instagram
    yt_task = "Open youtube in my browser, find the official Sidemen account, open their latest video"
    selected = registry.find_adapter(yt_task, current_url=stale_instagram_url, target_site="youtube.com")
    check("1A: YouTube task on Instagram tab selects YouTubeAdapter (not Instagram)", isinstance(selected, YouTubeAdapter))

    # Case 1B: User asks for YouTube without target_site, but tab is on Instagram
    selected_auto = registry.find_adapter(yt_task, current_url=stale_instagram_url)
    check("1B: YouTube task without target_site selects YouTubeAdapter via keyword guard", isinstance(selected_auto, YouTubeAdapter))

    # Case 1C: InstagramAdapter hard-rejects YouTube tasks
    ig_adapter = InstagramAdapter()
    check("1C: InstagramAdapter rejects YouTube task on Instagram tab", not ig_adapter.can_handle(yt_task, stale_instagram_url))
    check("1C: InstagramAdapter rejects task when target_site='youtube.com'", not ig_adapter.can_handle(yt_task, stale_instagram_url, target_site="youtube.com"))

    # Case 1D: Instagram task on YouTube tab selects InstagramAdapter
    stale_yt_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ig_task = "Open Instagram, find Sidemen, show latest post"
    selected_ig = registry.find_adapter(ig_task, current_url=stale_yt_url, target_site="instagram.com")
    check("1D: Instagram task on YouTube tab selects InstagramAdapter", isinstance(selected_ig, InstagramAdapter))

    yt_adapter = YouTubeAdapter()
    check("1D: YouTubeAdapter rejects Instagram task on YouTube tab", not yt_adapter.can_handle(ig_task, stale_yt_url))

def test_artifact_isolation():
    print("\n\x1b[1mTest 2: Artifact partitioning by task_id\x1b[0m")
    manager = BrowserManager(cdp_port=9999, headless=True)

    manager.set_current_task("task-insta-1", "step-1")
    art1 = BrowserArtifact(
        kind="post",
        name="Instagram Post",
        locator="https://www.instagram.com/p/ABC/",
        verification_status="verified",
    )
    manager.add_artifact(art1)

    manager.set_current_task("task-youtube-2", "step-1")
    art2 = BrowserArtifact(
        kind="page",
        name="YouTube Video",
        locator="https://www.youtube.com/watch?v=XYZ",
        verification_status="verified",
    )
    manager.add_artifact(art2)

    task1_arts = manager.get_task_artifacts("task-insta-1")
    task2_arts = manager.get_task_artifacts("task-youtube-2")
    task3_arts = manager.get_task_artifacts("task-other-3")

    check("2A: Task 1 sees only its own artifact", len(task1_arts) == 1 and task1_arts[0].locator == "https://www.instagram.com/p/ABC/")
    check("2B: Task 2 sees only its own artifact", len(task2_arts) == 1 and task2_arts[0].locator == "https://www.youtube.com/watch?v=XYZ")
    check("2C: Unrelated task sees 0 artifacts", len(task3_arts) == 0)

def test_mode_b_strictness():
    print("\n\x1b[1mTest 3: Mode B strictness (no silent Mode A fallback)\x1b[0m")
    import asyncio

    async def run_mode_b_test():
        # Port 59999 is definitely not running Chrome CDP
        session = SessionManager(cdp_port=59999, headless=True)
        try:
            await session.initialize(mode_hint="owner")
            return False, "Expected RuntimeError was not raised"
        except RuntimeError as e:
            err_msg = str(e)
            is_mode_b_err = MODE_B_USER_ATTACHED in err_msg and "not attachable via CDP" in err_msg
            return is_mode_b_err, err_msg
        finally:
            if session._playwright:
                await session._playwright.stop()

    ok, detail = asyncio.run(run_mode_b_test())
    check("3A: Mode B failure raises explicit RuntimeError with CDP instructions", ok, detail)

def test_youtube_identity_tracking():
    print("\n\x1b[1mTest 4: YouTube exact video identity verification\x1b[0m")
    import re

    def extract_yt_id(url: str) -> str | None:
        m = re.search(r"(?:v=|/v/|youtu\.be/|/shorts/)([a-zA-Z0-9_-]{11})", url)
        return m.group(1) if m else None

    target_video_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    target_id = extract_yt_id(target_video_url)

    wrong_video_url = "https://www.youtube.com/watch?v=9bZkp7q19f0"
    wrong_id = extract_yt_id(wrong_video_url)

    check("4A: Target video ID extracted correctly", target_id == "dQw4w9WgXcQ")
    check("4B: Wrong video ID does not match target ID", wrong_id != target_id)

    # Verification helper logic
    def verify_yt(expected_id: str, actual_url: str) -> bool:
        act_id = extract_yt_id(actual_url)
        return act_id == expected_id

    check("4C: Exact video URL verified", verify_yt(target_id, target_video_url))
    check("4D: Wrong video URL rejected", not verify_yt(target_id, wrong_video_url))
    check("4E: Channel page alone rejected", not verify_yt(target_id, "https://www.youtube.com/@Sidemen/videos"))

def test_instagram_natural_language_routing():
    print("\n\x1b[1mTest 5: Instagram natural-language routing and navigation progress\x1b[0m")
    check(
        "5A: Possessive account is extracted",
        extract_instagram_account("Open MrBeast's latest Instagram post") == "mrbeast",
    )
    check(
        "5B: Apostrophe-free account is extracted",
        extract_instagram_account("open mrbeasts latest instagram post") == "mrbeast",
    )
    check(
        "5C: Planner profile URL supplies the account",
        extract_instagram_account("navigate to https://www.instagram.com/mrbeast/, then open the latest post") == "mrbeast",
    )
    check(
        "5D: Generic Instagram open does not invent an account",
        extract_instagram_account("Open Instagram website") is None,
    )
    check(
        "5E: Multi-step browser request is not navigation-only",
        not _is_navigation_only_task("navigate to https://www.instagram.com/mrbeast/, scroll to the latest post and open it"),
    )
    check(
        "5F: Simple URL open remains navigation-only",
        _is_navigation_only_task("open https://example.com"),
    )

if __name__ == "__main__":
    test_adapter_isolation()
    test_artifact_isolation()
    test_mode_b_strictness()
    test_youtube_identity_tracking()
    test_instagram_natural_language_routing()

    print(f"\n\x1b[1mIsolation Summary: {passed} passed, {failed} failed\x1b[0m")
    sys.exit(1 if failed > 0 else 0)
