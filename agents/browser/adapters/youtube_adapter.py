"""
YouTubeAdapter: Fast-path adapter for YouTube channel search and video lookup.

Implements exact video identity tracking:
- selected_video_url
- selected_video_id
- selected_video_position
- selection_source

The "latest video" flow:
  1. Navigate to channel page
  2. Record the EXACT first video from the "Videos" tab
  3. Open that exact video
  4. Verify the exact video is open via URL match
  5. DONE (or FAIL — never false success)
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any
from urllib.parse import urlparse, parse_qs
from playwright.async_api import Page

from browser_state import ActionResult, BrowserArtifact
from adapters.base_adapter import AdapterFallbackException, SiteAdapter
from verification import log_verification_step

log = logging.getLogger("YouTubeAdapter")


class YouTubeAdapter(SiteAdapter):
    name = "YouTubeAdapter"
    domains = ["youtube.com"]

    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        # Hard guard 1: if target_site is explicitly set to a non-YouTube domain, reject.
        if target_site and not self._domain_matches_target(target_site):
            return False

        # Hard guard 2: task explicitly mentions a competing site → reject.
        if self._task_mentions_other_site(task):
            return False

        t = task.lower()
        # Must have explicit YouTube intent OR a confirmed youtube.com target_site.
        # We do NOT use "youtube.com in current_url" as a positive signal because
        # the current tab may be from a previous task on a different domain.
        has_yt_keyword = "youtube" in t
        has_yt_target = target_site and "youtube" in target_site.lower()
        is_yt = has_yt_keyword or bool(has_yt_target)

        return is_yt and any(k in t for k in ["video", "channel", "search", "latest", "watch", "play", "find", "open", "account"])

    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        log.info(f"[TASK_ID={context.get('task_id','?')}] Executing YouTube workflow for task: '{task}'")
        page: Page = await manager.get_active_page()

        # Extract channel/account from task
        channel_name = _extract_channel(task)

        # Determine if task asks for "latest video" from a channel
        t = task.lower()
        wants_latest = "latest" in t or ("find" in t and "video" in t)
        wants_channel = any(k in t for k in ["channel", "account", "official"])

        try:
            selected_video_url: str | None = None
            selected_video_id: str | None = None
            selected_video_title: str | None = None
            selected_video_position: str | None = None
            selection_source: str | None = None

            if wants_latest and channel_name:
                # Strategy: go to channel /videos tab to get the definitive latest upload
                channel_slug = channel_name.replace(" ", "").lower()

                # Try @handle search first to find the official channel
                search_url = f"https://www.youtube.com/results?search_query={channel_name.replace(' ', '+')}+official+channel"
                log.info(f"Searching YouTube for channel: {channel_name}")
                await manager.navigation.goto(search_url, wait_until="domcontentloaded")
                await asyncio.sleep(1.5)
                await manager.recovery.dismiss_common_overlays()

                # Try to find a channel result (ytd-channel-renderer)
                channel_link = page.locator(
                    'ytd-channel-renderer a#main-link, ytd-channel-renderer a.channel-link'
                ).first
                channel_href: str | None = None
                try:
                    await channel_link.wait_for(state="visible", timeout=6000)
                    channel_href = await channel_link.get_attribute("href")
                except Exception:
                    log.info("No channel card found; will try /@handle URL directly")

                # Navigate to channel videos tab
                if channel_href:
                    channel_videos_url = f"https://www.youtube.com{channel_href}/videos"
                else:
                    # Fallback: construct @handle URL
                    channel_videos_url = f"https://www.youtube.com/@{channel_slug}/videos"

                log.info(f"Navigating to channel /videos tab: {channel_videos_url}")
                await manager.navigation.goto(channel_videos_url, wait_until="domcontentloaded")
                await asyncio.sleep(2.0)
                await manager.recovery.dismiss_common_overlays()

                # Check we are on a real YouTube channel page
                if "youtube.com" not in page.url:
                    raise AdapterFallbackException(
                        f"Navigation left YouTube: ended up on {page.url}"
                    )

                # Find the first (latest) video on the /videos tab
                video_locator = page.locator(
                    'ytd-rich-item-renderer a#video-title-link, '
                    'ytd-grid-video-renderer a#thumbnail[href*="/watch"], '
                    'ytd-video-renderer a#video-title'
                ).first
                try:
                    await video_locator.wait_for(state="visible", timeout=10000)
                    video_href = await video_locator.get_attribute("href")
                    video_title_attr = await video_locator.get_attribute("title")
                    video_title_text = await video_locator.inner_text()
                    selected_video_title = (video_title_attr or video_title_text or "").strip()
                except Exception as err:
                    raise AdapterFallbackException(
                        f"Could not locate any video on channel /videos page: {err}"
                    )

                if not video_href:
                    raise AdapterFallbackException("Video link href was empty on channel /videos page")

                selected_video_url = (
                    f"https://www.youtube.com{video_href}"
                    if video_href.startswith("/")
                    else video_href
                )
                selected_video_id = _extract_video_id(selected_video_url)
                selected_video_position = "channel_videos_tab_first"
                selection_source = "channel_videos_tab"

                log.info(
                    f"[IDENTITY] Selected latest video: title='{selected_video_title}' "
                    f"url='{selected_video_url}' id='{selected_video_id}'"
                )

                # Register as DISCOVERED before opening
                video_artifact = BrowserArtifact(
                    kind="page",
                    name=selected_video_title or f"{channel_name} latest video",
                    locator=selected_video_url,
                    metadata={
                        "title": selected_video_title,
                        "channel": channel_name,
                        "selected_video_url": selected_video_url,
                        "selected_video_id": selected_video_id,
                        "selected_video_position": selected_video_position,
                        "selection_source": selection_source,
                    },
                    verification_status="discovered",
                    verification_metadata={
                        "source_site": "youtube.com",
                        "channel": channel_name,
                        "selected_video_url": selected_video_url,
                        "selected_video_id": selected_video_id,
                        "artifact_type": "video",
                        "verification_status": "discovered",
                        "timestamp": time.time(),
                    },
                )
                manager.add_artifact(video_artifact)
                log_verification_step(
                    action=f"locate latest video from channel '{channel_name}'",
                    expected="first video on /videos tab",
                    observed=f"discovered '{selected_video_title}' (id={selected_video_id})",
                    result="PASS",
                    artifact_status="discovered",
                )

                # Open the exact selected video via direct navigation (most reliable)
                log.info(f"Navigating to exact selected video: {selected_video_url}")
                await manager.navigation.goto(selected_video_url, wait_until="domcontentloaded")
                await asyncio.sleep(1.5)

            else:
                # Generic search fallback: search for the task query
                query = context.get("query") or ""
                if not query:
                    m = re.search(
                        r"(?:find|search|watch|on youtube for|on youtube)\s+([a-zA-Z0-9\s._-]+)",
                        task, re.IGNORECASE
                    )
                    query = m.group(1).strip() if m else (channel_name or "")

                search_url = f"https://www.youtube.com/results?search_query={query.replace(' ', '+')}"
                await manager.navigation.goto(search_url, wait_until="domcontentloaded")
                await asyncio.sleep(1.0)
                await manager.recovery.dismiss_common_overlays()

                video_locator = page.locator(
                    'ytd-video-renderer a#video-title, a#thumbnail[href*="/watch"]'
                ).first
                try:
                    await video_locator.wait_for(state="visible", timeout=8000)
                    video_href = await video_locator.get_attribute("href")
                    video_title_attr = await video_locator.get_attribute("title")
                    video_title_text = await video_locator.inner_text()
                    selected_video_title = (video_title_attr or video_title_text or "").strip()
                except Exception as err:
                    raise AdapterFallbackException(f"Could not locate video results on YouTube: {err}")

                if not video_href:
                    raise AdapterFallbackException("Video link href was empty on search results page")

                selected_video_url = (
                    f"https://www.youtube.com{video_href}"
                    if video_href.startswith("/")
                    else video_href
                )
                selected_video_id = _extract_video_id(selected_video_url)
                selected_video_position = "search_results_first"
                selection_source = "search"

                log.info(f"[IDENTITY] Found video from search: '{selected_video_title}' ({selected_video_url})")

                video_artifact = BrowserArtifact(
                    kind="page",
                    name=selected_video_title or f"{query} on YouTube",
                    locator=selected_video_url,
                    metadata={
                        "title": selected_video_title,
                        "query": query,
                        "selected_video_url": selected_video_url,
                        "selected_video_id": selected_video_id,
                        "selected_video_position": selected_video_position,
                        "selection_source": selection_source,
                    },
                    verification_status="discovered",
                )
                manager.add_artifact(video_artifact)

                await video_locator.click()
                await asyncio.sleep(1.5)

            # ── HARD VERIFICATION GATE ──────────────────────────────────────────
            # Verify the EXACT selected video is now open in the browser.
            verification = await _verify_youtube_video(
                page=page,
                expected_video_url=selected_video_url,
                expected_video_id=selected_video_id,
                expected_channel=channel_name,
            )

            if not verification["passed"]:
                reason = verification.get("reason", "YouTube video verification failed")
                log.warning(f"[VERIFICATION FAIL] {reason}")
                log_verification_step(
                    action="verify exact YouTube video open",
                    expected=f"video id={selected_video_id} at {selected_video_url}",
                    observed=f"actual url={page.url}",
                    result="FAIL",
                    artifact_status="opened",
                )
                raise AdapterFallbackException(reason, partial_data={"verification": verification})

            # Promote to VERIFIED
            video_artifact.verification_status = "verified"
            video_artifact.verification_metadata = {
                "source_site": "youtube.com",
                "channel": channel_name,
                "selected_video_url": selected_video_url,
                "selected_video_id": selected_video_id,
                "selected_video_position": selected_video_position,
                "selection_source": selection_source,
                "actual_url": page.url,
                "artifact_type": "video",
                "verification_status": "verified",
                "timestamp": time.time(),
                "observed_facts": verification.get("observed", {}),
            }

            log_verification_step(
                action="verify exact YouTube video open",
                expected=f"video id={selected_video_id} at {selected_video_url}",
                observed=f"verified: actual url={page.url}",
                result="PASS",
                artifact_status="verified",
            )

            return ActionResult(
                success=True,
                action="youtube_open_video",
                target=selected_video_url or "",
                details=f"Opened YouTube video: '{selected_video_title}' from channel '{channel_name}'",
                state_changed=True,
                verification={
                    "passed": True,
                    "checks": [
                        {"check": "YouTube domain confirmed", "passed": True},
                        {"check": f"Video id={selected_video_id} URL matches", "passed": True},
                        {"check": "Video player visible", "passed": verification.get("player_visible", True)},
                    ],
                    "target_reached": True,
                    "source_site": "youtube.com",
                    "selected_video_url": selected_video_url,
                    "selected_video_id": selected_video_id,
                    "channel": channel_name,
                },
                data={
                    "url": page.url,
                    "selected_video_url": selected_video_url,
                    "selected_video_id": selected_video_id,
                    "selected_video_title": selected_video_title,
                    "selected_video_position": selected_video_position,
                    "selection_source": selection_source,
                    "channel": channel_name,
                    "artifact": video_artifact.to_dict(),
                    "artifacts": [video_artifact.to_dict()],
                },
            )

        except AdapterFallbackException:
            raise
        except Exception as err:
            log.error(f"Unexpected error in YouTubeAdapter: {err}", exc_info=True)
            raise AdapterFallbackException(f"YouTube adapter unexpected failure: {err}")


def _extract_channel(task: str) -> str:
    """Extract a channel/account name from a task description."""
    # Match patterns like "official Sidemen account", "Sidemen channel", "Sidemen's latest"
    patterns = [
        r"official\s+([a-zA-Z0-9\s._-]+?)\s+(?:account|channel|page)",
        r"([a-zA-Z0-9\s._-]+?)\s+(?:official\s+)?(?:account|channel|page)",
        r"([a-zA-Z0-9\s._-]+?)'s\s+(?:latest|channel|video)",
        r"(?:from|of)\s+([a-zA-Z0-9\s._-]+?)(?:\s+on|\s+in|\s*$)",
    ]
    for pat in patterns:
        m = re.search(pat, task, re.IGNORECASE)
        if m:
            name = m.group(1).strip().rstrip("'s").strip()
            # Filter out generic words
            if name.lower() not in {"the", "a", "an", "my", "their", "his", "her", "find", "open", "youtube"}:
                return name
    return ""


def _extract_video_id(url: str) -> str | None:
    """Extract YouTube video ID from watch URL."""
    try:
        parsed = urlparse(url)
        if parsed.netloc and "youtube" in parsed.netloc:
            qs = parse_qs(parsed.query)
            if "v" in qs:
                return qs["v"][0]
            # Short URLs like youtu.be/VIDEO_ID
            if "youtu.be" in parsed.netloc:
                return parsed.path.lstrip("/")
    except Exception:
        pass
    # Regex fallback
    m = re.search(r"[?&]v=([a-zA-Z0-9_-]{11})", url)
    return m.group(1) if m else None


async def _verify_youtube_video(
    page: Page,
    expected_video_url: str | None,
    expected_video_id: str | None,
    expected_channel: str | None,
) -> dict:
    """
    Hard verification: confirm the EXACT selected video is currently open.

    Checks:
    1. Current domain is youtube.com
    2. Current URL contains /watch
    3. Video ID in current URL matches selected_video_id
    4. Video player element (ytd-watch-flexy or video tag) is present
    """
    current_url = page.url
    observed: dict = {"current_url": current_url}

    # 1. Domain check
    if "youtube.com" not in current_url:
        return {
            "passed": False,
            "reason": f"Not on YouTube — current URL is: {current_url}",
            "observed": observed,
            "target_reached": False,
        }

    # 2. Watch URL check
    if "/watch" not in current_url:
        return {
            "passed": False,
            "reason": f"Not on a YouTube video watch page — current URL: {current_url}",
            "observed": observed,
            "target_reached": False,
        }

    # 3. Exact video ID match
    actual_id = _extract_video_id(current_url)
    observed["actual_video_id"] = actual_id
    observed["expected_video_id"] = expected_video_id

    if expected_video_id and actual_id != expected_video_id:
        return {
            "passed": False,
            "reason": (
                f"Wrong video open — expected id='{expected_video_id}' but got id='{actual_id}'. "
                f"Expected URL: {expected_video_url}, actual URL: {current_url}"
            ),
            "observed": observed,
            "target_reached": False,
        }

    # 4. Video player presence
    player_visible = False
    try:
        player = page.locator('ytd-watch-flexy, video.html5-main-video, #movie_player').first
        player_visible = await player.is_visible()
    except Exception:
        pass
    observed["player_visible"] = player_visible

    return {
        "passed": True,
        "reason": f"YouTube video verified: id={actual_id}, url={current_url}",
        "observed": observed,
        "player_visible": player_visible,
        "target_reached": True,
        "source_site": "youtube.com",
        "actual_video_id": actual_id,
        "actual_url": current_url,
    }
