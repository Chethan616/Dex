"""
InstagramAdapter: Fast-path adapter for Instagram workflows.
Supports:
- Navigating to profile / finding account
- Locating latest post
- Opening post and extracting media/caption
- Sharing post to a specific chat / recipient
- Verifying delivery
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from playwright.async_api import Page

from browser_state import ActionResult, BrowserArtifact
from adapters.base_adapter import AdapterFallbackException, SiteAdapter
from verification import log_verification_step

log = logging.getLogger("InstagramAdapter")


def extract_instagram_account(task: str, expected_entity: str | None = None) -> str | None:
    """Extract the requested Instagram account without inventing a default.

    Natural-language requests commonly use possessives (``MrBeast's latest``)
    or omit the apostrophe (``mrbeasts latest``).  Keep this parser small and
    conservative: a site name such as ``Instagram`` is never accepted as the
    account, and an unknown account remains unknown so verification cannot
    silently fall back to an unrelated profile.
    """
    def clean(value: str | None) -> str | None:
        if not value:
            return None
        candidate = value.strip().lstrip("@").rstrip(".,!?/\\")
        if not candidate or candidate.lower() in {"instagram", "insta"}:
            return None
        return candidate.lower()

    candidate = clean(expected_entity)
    if candidate:
        return candidate

    # A profile URL is the strongest signal and also handles planner-generated
    # tasks such as: navigate to instagram.com/mrbeast/, then open the latest.
    profile = re.search(
        r"instagram\.com/(?!p(?:/|$)|reel(?:/|$)|explore(?:/|$)|accounts(?:/|$))([a-zA-Z0-9._]+)/?",
        task,
        re.IGNORECASE,
    )
    candidate = clean(profile.group(1) if profile else None)
    if candidate:
        return candidate

    # Profile requests: "PewDiePie's Instagram profile" or
    # "open PewDiePie Instagram account".
    profile_name = re.search(
        r"\b([a-zA-Z0-9._]+?)(?:['’]s|s)?\s+(?:instagram|insta)\s+"
        r"(?:profile|account)\b",
        task,
        re.IGNORECASE,
    )
    candidate = clean(profile_name.group(1) if profile_name else None)
    if candidate:
        return candidate

    # A bare possessive "profile", with no "instagram"/"insta" required —
    # covers a planner rewrite like "navigate to KSI's profile, find the
    # latest post, and send it..." where the account name and "latest post"
    # end up separated by other words, so neither the pattern above (needs
    # "instagram profile" together) nor the "X's latest post" pattern
    # further below (needs them adjacent) matches at all.
    bare_profile = re.search(
        r"\b([a-zA-Z0-9._]+?)(?:['’]s|s)\s+profile\b", task, re.IGNORECASE,
    )
    candidate = clean(bare_profile.group(1) if bare_profile else None)
    if candidate:
        return candidate

    # Explicit relationships: "latest post from/of/on @mrbeast".
    explicit = re.search(
        r"(?:from|of|on)\s+@?([a-zA-Z0-9._]+)", task, re.IGNORECASE
    )
    candidate = clean(explicit.group(1) if explicit else None)
    if candidate:
        return candidate

    # Possessive requests: "MrBeast's latest Instagram post".  The optional
    # bare trailing s supports the common keyboard-shortened form "mrbeasts".
    possessive = re.search(
        r"\b([a-zA-Z0-9._]+?)(?:['’]s|s)\s+(?:latest|newest|most\s+recent)\s+"
        r"(?:(?:instagram|insta)\s+)?(?:posts?|reels?)\b",
        task,
        re.IGNORECASE,
    )
    candidate = clean(possessive.group(1) if possessive else None)
    if candidate:
        return candidate

    # "latest MrBeast post" / "latest MrBeast Instagram post".
    latest = re.search(
        r"\b(?:latest|newest|most\s+recent)\s+@?([a-zA-Z0-9._]+)\s+"
        r"(?:(?:instagram|insta)\s+)?(?:posts?|reels?)\b",
        task,
        re.IGNORECASE,
    )
    candidate = clean(latest.group(1) if latest else None)
    if candidate:
        return candidate

    named_latest = re.search(
        r"\b([a-zA-Z0-9._]+)\s+(?:latest|newest|most\s+recent)\s+"
        r"(?:(?:instagram|insta)\s+)?posts?\b",
        task,
        re.IGNORECASE,
    )
    candidate = clean(named_latest.group(1) if named_latest else None)
    if candidate:
        return candidate

    # Short follow-ups such as "pewdipies post?" are intentionally accepted
    # only when the surrounding request names Instagram and a post/profile.
    # This keeps an arbitrary word from becoming an account while allowing a
    # conversational follow-up to use the same adapter as a full request.
    short = re.search(
        r"\b(?:open|show|find|see|view|latest|about)?\s*@?([a-zA-Z0-9._]+)\s+"
        r"(?:(?:instagram|insta)\s+)?posts?\b",
        task,
        re.IGNORECASE,
    )
    return clean(short.group(1) if short else None)


def requested_post_count(task: str) -> int:
    """Return the number of Instagram posts requested, capped for safety."""
    t = task.lower()
    number_words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
    }
    match = re.search(
        r"\b(?:latest|newest|most\s+recent)\s+(\d+|one|two|three|four|five)\s+"
        r"(?:(?:instagram|insta)\s+)?posts?\b",
        t,
        re.IGNORECASE,
    )
    if match:
        raw = match.group(1).lower()
        count = number_words.get(raw, int(raw) if raw.isdigit() else 1)
        return max(1, min(count, 10))

    # Plural requests without a number mean a small, useful review set. The
    # planner previously chose three; keep that behavior deterministic.
    if re.search(r"\b(?:latest|newest|most\s+recent)\s+(?:(?:instagram|insta)\s+)?posts\b", t):
        return 3
    return 1


class InstagramAdapter(SiteAdapter):
    name = "InstagramAdapter"
    domains = ["instagram.com"]

    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        # Hard guard 1: if target_site is explicitly set to a non-Instagram domain, reject immediately.
        if target_site and not self._domain_matches_target(target_site):
            return False

        # Hard guard 2: if the task text explicitly names a competing site, reject immediately.
        # This prevents a stale Instagram tab from hijacking YouTube/Gmail/etc tasks.
        if self._task_mentions_other_site(task):
            return False

        t = task.lower()
        # Must have explicit Instagram intent OR a confirmed instagram.com target_site.
        # We do NOT use "instagram.com in current_url" as a positive signal because
        # the current tab may be from a previous task on a different domain.
        has_ig_keyword = bool(re.search(r"\binsta(?:gram)?\b", t))
        has_ig_target = target_site and "instagram" in target_site.lower()
        is_ig = has_ig_keyword or bool(has_ig_target)

        intents = ["post", "share", "profile", "chat", "direct", "dm", "reel", "story", "account", "find", "latest", "open"]
        return is_ig and any(k in t for k in intents)

    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        log.info(f"Executing Instagram workflow for task: '{task}'")
        page: Page = await manager.get_active_page()

        # A generic request to open Instagram is navigation, not a request for
        # a person's latest post.  Never manufacture an account here: the old
        # fallback to ``sidemen`` made "open Instagram" perform an unrelated
        # content lookup and return a misleading verified artifact.
        generic_open = bool(re.fullmatch(
            r"\s*(?:open|visit|go\s+to)(?:\s+the)?\s+insta(?:gram)?(?:\s+website)?(?:\s+in\s+(?:a\s+)?browser)?\s*\.?\s*",
            task,
            re.IGNORECASE,
        ))
        if generic_open:
            await manager.navigation.goto("https://www.instagram.com/", wait_until="domcontentloaded")
            return ActionResult(
                success=True,
                action="instagram_open_home",
                target="https://www.instagram.com/",
                details="Instagram website opened.",
                state_changed=True,
                verification={"passed": True, "url": page.url, "home_page": True},
                data={"url": page.url, "title": await page.title()},
            )

        # Extract the target account from the user/planner task.  Do not use a
        # hard-coded account: "open Instagram" must never turn into a Sidemen
        # or any other unrelated content request.
        account = extract_instagram_account(task, context.get("expected_entity")) or ""
        if not account:
            raise AdapterFallbackException(
                "Instagram task needs an explicit account, post URL, or profile target"
            )

        # Extract recipient if task is an affirmative share/send command (not a negative constraint)
        recipient = None
        has_negative_constraint = bool(re.search(r"\b(?:do not|don'?t|never|without)\s+.*?\b(?:share|send|like|comment)\b", task, re.IGNORECASE))
        if not has_negative_constraint:
            rm = re.search(r"(?:share|send)(?:\s+it|\s+that)?\s+(?:with|to)\s+([a-zA-Z0-9\s._]+?)(?:\s+from|\s+on|$)", task, re.IGNORECASE)
            if rm:
                recipient = rm.group(1).strip()

        # Check if task includes an explicit post URL
        post_hint_m = re.search(r"https?://(?:www\.)?instagram\.com/(?:[a-zA-Z0-9._]+/)?(?:p|reel)/[a-zA-Z0-9_-]+/?", task)
        explicit_post_url = post_hint_m.group(0) if post_hint_m else None

        try:
            # 1. Navigate to target profile (or direct post if profile not needed)
            profile_url = f"https://www.instagram.com/{account}/"
            if explicit_post_url:
                post_url = explicit_post_url
                locator = None
            else:
                if profile_url not in page.url:
                    await manager.navigation.goto(profile_url, wait_until="domcontentloaded")
                    await asyncio.sleep(1.0)

                # Check if login is required
                if "accounts/login" in page.url:
                    raise AdapterFallbackException("Instagram requires login", {"login_required": True})

                # Dismiss common cookie or app banners, and any visible auth modal
                await manager.recovery.dismiss_common_overlays()
                await manager.verifier.dismiss_auth_or_signup_modal(page)

                # Verify profile page loaded
                prof_verify = await manager.verifier.verify_browser_state(
                    action=f"navigate to @{account} profile",
                    expected={"url_contains": account},
                    artifact_status_on_pass="discovered",
                )
                if not prof_verify["passed"]:
                    raise AdapterFallbackException(f"Profile page verification failed for @{account}")

                # 2. Locate the latest post
                post_link_selector = 'article a[href*="/p/"], main a[href*="/p/"], a[href^="/p/"], article a[href*="/reel/"], main a[href*="/reel/"]'
                try:
                    locator = page.locator(post_link_selector).first
                    await locator.wait_for(state="visible", timeout=8000)
                    post_href = await locator.get_attribute("href")
                except Exception as err:
                    log.warning(f"Could not locate post grid directly: {err}. Checking if auth modal is blocking...")
                    modal_info = await manager.verifier.detect_auth_or_signup_modal(page)
                    if modal_info.get("detected"):
                        dismissed = await manager.verifier.dismiss_auth_or_signup_modal(page)
                        if not dismissed:
                            raise AdapterFallbackException(
                                f"Instagram login/signup modal is blocking @{account} profile",
                                context={
                                    "needs_handoff": {
                                        "kind": "login_wall",
                                        "reason": f"Instagram login/signup modal is blocking @{account} profile: {modal_info.get('title')}",
                                        "instruction": "Please sign in or dismiss the modal in the open browser window, then click 'Done, continue'.",
                                    }
                                },
                            )
                        try:
                            locator = page.locator(post_link_selector).first
                            await locator.wait_for(state="visible", timeout=5000)
                            post_href = await locator.get_attribute("href")
                        except Exception as re_err:
                            raise AdapterFallbackException(f"Failed to locate latest post grid for {account} after modal dismissal: {re_err}")
                    else:
                        raise AdapterFallbackException(f"Failed to locate latest post grid for {account}: {err}")

                if not post_href:
                    raise AdapterFallbackException("Post link href attribute was empty")

                post_url = post_href if post_href.startswith("http") else f"https://www.instagram.com{post_href}"
                selected_post_id = None
                m_id = re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", post_url)
                if m_id:
                    selected_post_id = m_id.group(1)
                selected_position = "grid_first_post"
                selection_source = "profile_grid"
                log.info(f"Found latest post from {account}: {post_url} (ID: {selected_post_id})")

            if explicit_post_url:
                selected_post_id = None
                m_id = re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", explicit_post_url)
                if m_id:
                    selected_post_id = m_id.group(1)
                selected_position = "user_provided_url"
                selection_source = "user_provided_url"

            # Register post artifact as DISCOVERED with exact identity
            post_artifact = BrowserArtifact(
                kind="post",
                name=f"{account.capitalize()} latest post",
                locator=post_url,
                task_id=context.get("task_id", ""),
                step_id=context.get("step_id", ""),
                source_site="instagram.com",
                source_url=post_url,
                verification_status="discovered",
                metadata={
                    "account": account,
                    "post_url": post_url,
                    "selected_post_url": post_url,
                    "selected_post_id": selected_post_id,
                    "selected_position": selected_position,
                    "selection_source": selection_source,
                },
                verification_metadata={
                    "actual_url": page.url,
                    "source_site": "instagram.com",
                    "identified_account": account,
                    "selected_post_url": post_url,
                    "selected_post_id": selected_post_id,
                    "selected_position": selected_position,
                    "artifact_type": "post",
                    "verification_status": "discovered",
                    "timestamp": time.time(),
                },
            )
            manager.add_artifact(post_artifact)
            log_verification_step(
                action=f"locate latest post from @{account}",
                expected="post URL link found on profile grid",
                observed=f"discovered {post_url} (ID: {selected_post_id}, pos: {selected_position})",
                result="PASS",
                artifact_status="discovered",
            )

            # 3. Open the post:
            # normal click → inspect obstruction → dismiss known modal → retry → direct navigation
            post_artifact.verification_status = "opened"
            opened_via_click = False

            if locator is not None:
                try:
                    await locator.click(timeout=3000)
                    opened_via_click = True
                except Exception as click_err:
                    log.info(f"Normal click intercepted or timed out: {click_err}. Inspecting obstruction...")
                    # Dismiss known modal if present
                    modal_dismissed = await manager.verifier.dismiss_auth_or_signup_modal(page)
                    if modal_dismissed:
                        log.info("Obstruction dismissed. Retrying normal click...")
                        try:
                            await locator.click(timeout=3000)
                            opened_via_click = True
                        except Exception:
                            pass

            # Direct navigation to exact selected URL if not on post URL/dialog
            if not opened_via_click or ("/p/" not in page.url and "/reel/" not in page.url):
                log.info(f"Navigating directly to exact selected post URL: {post_url}")
                await manager.navigation.goto(post_url, wait_until="domcontentloaded")

            await asyncio.sleep(1.0)

            # 4. HARD VERIFICATION GATE: Verify exact post is actually open, visible, and authentic
            verification = await manager.verifier.verify_instagram_post(
                expected_account=account,
                expected_post_url=post_url,
                expected_post_id=selected_post_id,
            )

            if not verification["passed"]:
                log.warning(f"Instagram post verification FAILED for {post_url}: {verification.get('reason')}")
                post_artifact.verification_status = "opened"
                # Do NOT promote artifact to verified
                # Do NOT attach screenshot as verified evidence
                if verification.get("needs_handoff"):
                    raise AdapterFallbackException(
                        f"Instagram login required: {verification.get('reason')}",
                        partial_data={"verification": verification},
                        context={
                            "needs_handoff": {
                                "kind": "login_wall",
                                "reason": verification.get("reason") or "Instagram login/signup modal is blocking the post",
                                "instruction": "Please sign in to Instagram in the open browser window and click \"Done, continue\".",
                            }
                        },
                    )
                raise AdapterFallbackException(
                    f"Instagram post verification failed: {verification.get('reason')}",
                    partial_data={"verification": verification},
                )

            # Extract post image/video and caption
            media_url = verification.get("media_url") or ""
            caption = ""
            try:
                caption_el = page.locator('article h1, article span:has-text("")').first
                if await caption_el.is_visible():
                    caption = (await caption_el.inner_text())[:200]
            except Exception:
                pass

            # 5. Capture screenshot from verified state and run post-screenshot validation
            screenshot_res = await manager.visual.screenshot()
            screenshot_path = screenshot_res.get("path") if isinstance(screenshot_res, dict) else None

            # Post-screenshot validation: ensure page is still on the post and not navigated away
            if "/p/" not in page.url and "/reel/" not in page.url and not (await page.locator('div[role="dialog"] article').count() > 0):
                log.warning("Post-screenshot validation failed: page navigated away from post during capture")
                raise AdapterFallbackException("State changed during screenshot capture; post no longer visible")

            # Promote artifact to VERIFIED ONLY NOW
            post_artifact.verification_status = "verified"
            post_artifact.verification_metadata = {
                "actual_url": page.url,
                "source_site": "instagram.com",
                "identified_account": account,
                "selected_post_url": post_url,
                "selected_post_id": selected_post_id,
                "selected_position": selected_position,
                "artifact_type": "post",
                "verification_status": "verified",
                "screenshot_ref": screenshot_path,
                "timestamp": time.time(),
                "observed_facts": verification.get("observed", {}),
            }
            post_artifact.metadata["media_url"] = media_url
            post_artifact.metadata["caption"] = caption
            post_artifact.metadata["screenshot_path"] = screenshot_path
            post_artifact.metadata["verified"] = True

            # 6. If the task actually asked to download/save the media (not
            # just view it), do that before returning — this used to be
            # missing entirely: "download the media" and "show me the post"
            # both fell into the view-only branch below, so a plan chaining
            # send_file on {{step_1.output.downloads[0].path}} always found
            # an empty downloads[] and failed instantly, even though the
            # post itself had been found and verified correctly.
            wants_download = not has_negative_constraint and bool(re.search(
                r"\b(?:download|save)\b.*\b(?:media|image|photo|picture|video|reel|post)\b"
                r"|\b(?:media|image|photo|picture|video|reel)\b.*\bdownload\b",
                task, re.IGNORECASE,
            ))
            downloads: list[dict[str, Any]] = []
            if wants_download:
                dl_res = await manager.interaction.download_media()
                if not dl_res.success:
                    raise AdapterFallbackException(
                        f"Could not download the media on @{account}'s post: {dl_res.error}",
                        partial_data={"verification": verification, "post_url": post_url},
                    )
                file_artifact = BrowserArtifact(
                    kind="file",
                    name=dl_res.data.get("filename", "downloaded_media"),
                    locator=dl_res.data.get("path", ""),
                    task_id=context.get("task_id", ""),
                    step_id=context.get("step_id", ""),
                    source_site="instagram.com",
                    source_url=post_url,
                    verification_status="verified",
                    metadata=dl_res.data,
                )
                manager.add_artifact(file_artifact)
                downloads = [file_artifact.to_dict()]

            # 7. If the task only asked to find/open/show/download the post
            # (or explicitly forbade sharing), return now.
            wants_share = bool(recipient) or (
                not has_negative_constraint and bool(re.search(r"\b(?:share|send)\s+(?:it|this|that|the post|the reel)\b", task, re.IGNORECASE))
            )
            if not wants_share:
                return ActionResult(
                    success=True,
                    action="instagram_open_post",
                    target=post_url,
                    details=f"Verified @{account}'s latest post is open and visible: {post_url}",
                    state_changed=True,
                    verification=verification,
                    screenshot_path=screenshot_path,
                    data={
                        "post_url": post_url,
                        "account": account,
                        "caption": caption,
                        "media_url": media_url,
                        "screenshot_path": screenshot_path,
                        "artifact": post_artifact.to_dict(),
                        "artifacts": [post_artifact.to_dict()] + downloads,
                        "downloads": downloads,
                    },
                )

            # 7. Safe Downstream Gate: Before any share/send side-effect, require verified state
            if post_artifact.verification_status != "verified":
                raise AdapterFallbackException("Cannot share post: post artifact is not verified")

            log.info(f"Initiating share workflow to recipient: '{recipient}'")

            # Click Share button
            share_btn = page.locator('button [aria-label="Share Post"], [aria-label="Share Post"], svg[aria-label="Share Post"], button:has-text("Share")').first
            try:
                await share_btn.wait_for(state="visible", timeout=6000)
                await share_btn.click()
                await asyncio.sleep(1.0)
            except Exception as err:
                log.warning(f"Could not click share button: {err}")
                raise AdapterFallbackException("Share button not found on post")

            # Search recipient in the share dialog
            search_input = page.locator('input[placeholder*="Search"], input[name="queryBox"]').first
            try:
                await search_input.wait_for(state="visible", timeout=6000)
                await search_input.fill(recipient)
                await asyncio.sleep(1.0)
            except Exception as err:
                log.warning(f"Search input in share dialog not found: {err}")
                raise AdapterFallbackException("Recipient search input not found in share dialog")

            # Verify and select the recipient in results
            recipient_result = page.locator(f'div[role="dialog"] [role="checkbox"], div[role="dialog"] button:has-text("{recipient}"), div[role="dialog"] span:has-text("{recipient}")').first
            try:
                await recipient_result.wait_for(state="visible", timeout=6000)
                await recipient_result.click()
                await asyncio.sleep(0.5)
            except Exception as err:
                log.warning(f"Recipient '{recipient}' not found in search results: {err}")
                raise AdapterFallbackException(f"Recipient '{recipient}' not found in chat contacts")

            # Click Send button
            send_btn = page.locator('div[role="dialog"] button:has-text("Send"), div[role="dialog"] [aria-label="Send"]').first
            try:
                await send_btn.wait_for(state="visible", timeout=6000)
                await send_btn.click()
                await asyncio.sleep(1.5)
            except Exception as err:
                log.warning(f"Could not click send button: {err}")
                raise AdapterFallbackException("Send button in share dialog failed to click")

            # Verification: dialog should close or send confirmation
            dialog_closed = not (await page.locator('div[role="dialog"]').is_visible())
            log.info(f"Instagram share completed: recipient='{recipient}', dialog_closed={dialog_closed}")

            return ActionResult(
                success=True,
                action="instagram_share_post",
                target=recipient,
                details=f"Successfully shared {account}'s latest post with {recipient} on Instagram.",
                state_changed=True,
                verification={
                    "passed": True,
                    "checks": [
                        {"check": f"Located latest post for @{account}", "passed": True},
                        {"check": f"Found recipient '{recipient}' in chats", "passed": True},
                        {"check": "Sent post and share dialog closed", "passed": dialog_closed},
                    ],
                },
                data={
                    "post_url": post_url,
                    "account": account,
                    "recipient": recipient,
                    "artifact": post_artifact.to_dict(),
                },
            )

        except AdapterFallbackException:
            raise
        except Exception as err:
            log.error(f"Unexpected error in Instagram adapter: {err}")
            raise AdapterFallbackException(f"Instagram adapter unexpected failure: {err}")
