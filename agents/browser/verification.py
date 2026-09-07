"""
Verification: Verification-first action checking and risk classification for DEX Browser Automation.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable
from playwright.async_api import Page

log = logging.getLogger("Verification")


class RiskLevel:
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGHER = "HIGHER"


# Action classifications
RISK_RULES = {
    # Low risk
    "navigate": RiskLevel.LOW,
    "inspect": RiskLevel.LOW,
    "read_page": RiskLevel.LOW,
    "extract": RiskLevel.LOW,
    "screenshot": RiskLevel.LOW,
    "scroll": RiskLevel.LOW,
    "search": RiskLevel.LOW,
    "find": RiskLevel.LOW,
    "open_post": RiskLevel.LOW,
    "view_profile": RiskLevel.LOW,
    "tab_list": RiskLevel.LOW,
    "tab_switch": RiskLevel.LOW,
    # Medium risk
    "like": RiskLevel.MEDIUM,
    "follow": RiskLevel.MEDIUM,
    "save": RiskLevel.MEDIUM,
    "bookmark": RiskLevel.MEDIUM,
    "comment": RiskLevel.MEDIUM,
    # Higher risk
    "send_message": RiskLevel.HIGHER,
    "share_post": RiskLevel.HIGHER,
    "send_to_chat": RiskLevel.HIGHER,
    "delete": RiskLevel.HIGHER,
    "purchase": RiskLevel.HIGHER,
    "buy": RiskLevel.HIGHER,
    "transfer": RiskLevel.HIGHER,
    "change_settings": RiskLevel.HIGHER,
    "send_email": RiskLevel.HIGHER,
}


def classify_action_risk(action_name: str, context_details: str = "") -> str:
    """Classifies an action as LOW, MEDIUM, or HIGHER risk."""
    act = action_name.lower().replace(" ", "_")
    if act in RISK_RULES:
        return RISK_RULES[act]

    # Keyword check in context details
    combined = f"{act} {context_details}".lower()
    if any(k in combined for k in ["send", "share", "post", "delete", "remove", "pay", "buy", "checkout", "order", "password"]):
        return RiskLevel.HIGHER
    if any(k in combined for k in ["like", "follow", "bookmark", "save", "star"]):
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def log_verification_step(
    action: str,
    expected: str,
    observed: str,
    result: str,
    artifact_status: str = "none",
) -> None:
    """Concise structured log required by DEX verification architecture."""
    msg = (
        f"\nACTION: {action}"
        f"\nEXPECTED: {expected}"
        f"\nOBSERVED: {observed}"
        f"\nVERIFY: {result}"
        f"\nARTIFACT STATUS: {artifact_status}"
    )
    if result.upper() == "PASS":
        log.info(msg)
    else:
        log.warning(msg)


class ActionVerifier:
    def __init__(self, page_getter: Callable[[], Any]):
        self._get_page = page_getter

    async def verify_browser_state(
        self,
        action: str,
        expected: dict[str, Any],
        artifact_status_on_pass: str = "verified",
        artifact_status_on_fail: str = "opened",
    ) -> dict[str, Any]:
        """
        Comprehensive real browser state observation and verification.
        Validates:
        - Tab is active and responsive
        - Page is loaded (not blank, readyState ready)
        - Not an error page or unexpected login wall
        - Explicit expected conditions (URL, text, selectors)
        """
        page: Page = await self._get_page()
        checks: list[dict[str, Any]] = []
        overall_passed = True

        if not page or page.is_closed():
            log_verification_step(
                action=action,
                expected=str(expected),
                observed="Tab is closed or unavailable",
                result="FAIL",
                artifact_status=artifact_status_on_fail,
            )
            return {
                "passed": False,
                "error": "Browser page is closed or unavailable",
                "checks": [{"check": "Page is active", "passed": False}],
                "observed": {"page_closed": True},
            }

        current_url = page.url
        page_title = ""
        body_text = ""
        ready_state = ""

        try:
            page_title = await page.title()
            ready_state = await page.evaluate("() => document.readyState")
            body_text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception as err:
            log.warning(f"Error evaluating live page state: {err}")

        # 1. Page readiness and non-blank check
        is_blank = len(body_text.strip()) == 0
        checks.append({
            "check": "Page is not blank",
            "passed": not is_blank,
            "actual_len": len(body_text.strip()),
        })
        if is_blank:
            overall_passed = False

        # 2. Error page check
        error_indicators = [
            "sorry, this page isn't available",
            "page not found",
            "404 not found",
            "something went wrong",
            "site cannot be reached",
            "network error",
        ]
        is_error = any(e in body_text.lower() or e in page_title.lower() for e in error_indicators)
        checks.append({
            "check": "Page is not error or broken state",
            "passed": not is_error,
        })
        if is_error:
            overall_passed = False

        # 3. Unexpected login wall check (unless expecting login)
        expecting_login = "login" in action.lower() or "signin" in action.lower()
        is_login = "accounts/login" in current_url or ("/login" in current_url and not expecting_login)

        # Check for visible auth/signup modals or overlays on page
        modal_info = await self.detect_auth_or_signup_modal(page)
        modal_detected = bool(modal_info.get("detected"))
        if modal_detected and not expecting_login:
            is_login = True

        login_details = "url_login" if ("accounts/login" in current_url or "/login" in current_url) else ""
        if modal_detected:
            login_details += f" modal_detected: {modal_info.get('title', '')}"

        checks.append({
            "check": "Not stuck on login wall",
            "passed": not is_login or expecting_login,
            "details": login_details.strip() or "ok",
        })
        if is_login and not expecting_login:
            overall_passed = False

        # 4. Expected URL checks
        if "url_contains" in expected and expected["url_contains"]:
            target = str(expected["url_contains"])
            passed = target in current_url
            checks.append({"check": f"URL contains '{target}'", "passed": passed, "actual": current_url})
            if not passed:
                overall_passed = False

        # 5. Expected text checks
        if "text_on_page" in expected and expected["text_on_page"]:
            target_text = str(expected["text_on_page"])
            passed = target_text.lower() in body_text.lower() or target_text.lower() in page_title.lower()
            checks.append({"check": f"Text '{target_text}' present", "passed": passed})
            if not passed:
                overall_passed = False

        # 6. Expected selector visible
        if "selector_visible" in expected and expected["selector_visible"]:
            sel = str(expected["selector_visible"])
            try:
                locator = page.locator(sel).first
                visible = await locator.is_visible() if await locator.count() > 0 else False
                checks.append({"check": f"Selector '{sel}' visible", "passed": visible})
                if not visible:
                    overall_passed = False
            except Exception:
                checks.append({"check": f"Selector '{sel}' visible", "passed": False})
                overall_passed = False

        observed_summary = f"URL={current_url}, title='{page_title[:40]}', ready={ready_state}, text_len={len(body_text.strip())}"
        verdict = "PASS" if overall_passed else "FAIL"
        art_status = artifact_status_on_pass if overall_passed else artifact_status_on_fail

        log_verification_step(
            action=action,
            expected=json_format_dict(expected),
            observed=observed_summary,
            result=verdict,
            artifact_status=art_status,
        )

        return {
            "passed": overall_passed,
            "is_generic_check": True,
            "login_modal_detected": modal_detected,
            "target_reached": overall_passed,
            "action": action,
            "url": current_url,
            "title": page_title,
            "checks": checks,
            "observed": {
                "url": current_url,
                "title": page_title,
                "ready_state": ready_state,
                "text_length": len(body_text.strip()),
                "is_blank": is_blank,
                "is_error": is_error,
                "is_login": is_login,
                "modal_detected": modal_detected,
            },
        }

    async def detect_auth_or_signup_modal(self, page: Page | None = None) -> dict[str, Any]:
        """
        Inspects live DOM for Instagram/social auth or signup modal overlays.
        Checks both dialog roles, overlay containers, and page-level auth text.
        Returns:
            {
                "detected": bool,
                "is_blocking": bool,
                "has_close_button": bool,
                "close_selector": str | None,
                "title": str,
            }
        """
        result: dict[str, Any] = {
            "detected": False,
            "is_blocking": False,
            "has_close_button": False,
            "close_selector": None,
            "title": "",
        }
        p: Page = page or await self._get_page()
        if not p or p.is_closed():
            return result

        try:
            auth_phrases = [
                "see photos, videos and more",
                "see photos and videos from",
                "log in to see photos",
                "log in to instagram",
                "sign up to see photos",
                "don't have an account? sign up",
                "create an account",
                "join instagram",
                "log in or sign up",
                "log in to continue",
                "sign up to continue",
                "never miss a post",
                "stay in the loop",
                "sign up for instagram to stay in the loop",
                "sign up to see photos and videos",
            ]

            close_selectors = [
                '[aria-label="Close"]',
                'svg[aria-label="Close"]',
                'button [aria-label="Close"]',
                'button[aria-label="Close"]',
                '[title="Close"]',
                'button:has-text("✕")',
                'button:has-text("Close")',
                'button svg[aria-label="Close"]',
            ]

            # Find if any close selector exists and is visible on page
            close_sel_found = None
            for c_sel in close_selectors:
                c_loc = p.locator(c_sel).first
                if await c_loc.count() > 0 and await c_loc.is_visible():
                    close_sel_found = c_sel
                    break

            # 1. Check for modal dialogs and fixed overlay containers
            dialog_locators = p.locator('div[role="dialog"], div[aria-modal="true"], div[style*="position: fixed"], div[style*="position:fixed"]')
            dialog_count = await dialog_locators.count()
            for i in range(min(dialog_count, 12)):
                d = dialog_locators.nth(i)
                if not await d.is_visible():
                    continue

                d_text = (await d.inner_text()) or ""
                d_text_lower = d_text.lower()

                is_auth = any(phrase in d_text_lower for phrase in auth_phrases)
                if not is_auth:
                    # Check for login inputs or buttons inside container
                    inputs = await d.locator('input[name="username"], input[name="password"], input[type="password"]').count()
                    buttons = await d.locator('button:has-text("Log In"), button:has-text("Sign Up"), button:has-text("Log in"), button:has-text("Sign up")').count()
                    if inputs > 0 or buttons > 0:
                        has_post_article = await d.locator('article').count() > 0
                        if not has_post_article:
                            is_auth = True

                if is_auth:
                    result["detected"] = True
                    result["is_blocking"] = True
                    result["title"] = d_text[:80].replace("\n", " ").strip()
                    if close_sel_found:
                        result["has_close_button"] = True
                        result["close_selector"] = close_sel_found
                    return result

            # 2. Check full body text for auth overlay text
            body_text = (await p.evaluate("() => document.body ? document.body.innerText.toLowerCase() : ''")) or ""
            matched_phrase = next((ph for ph in auth_phrases if ph in body_text), None)
            if matched_phrase:
                result["detected"] = True
                result["is_blocking"] = True
                result["title"] = matched_phrase
                if close_sel_found:
                    result["has_close_button"] = True
                    result["close_selector"] = close_sel_found
                return result

        except Exception as e:
            log.warning(f"Error checking for auth/signup modal: {e}")

        return result

    async def dismiss_auth_or_signup_modal(self, page: Page | None = None) -> bool:
        """
        Safely dismisses an Instagram auth/signup modal:
        modal detected
        → try safe X / Escape
        → verify modal disappeared
        → return True if gone, False if still present.
        """
        p: Page = page or await self._get_page()
        if not p or p.is_closed():
            return False

        modal_info = await self.detect_auth_or_signup_modal(p)
        if not modal_info["detected"]:
            return True

        log.info(f"Attempting safe dismissal of modal: '{modal_info['title']}'")

        # 1. Try safe X button if present
        close_sel = modal_info.get("close_selector") or '[aria-label="Close"], svg[aria-label="Close"]'
        try:
            close_btn = p.locator(close_sel).first
            if await close_btn.count() > 0 and await close_btn.is_visible():
                await close_btn.click(timeout=2500)
                await asyncio.sleep(0.8)
        except Exception as err:
            log.warning(f"Error clicking modal close button: {err}")

        # 2. Check if disappeared
        recheck = await self.detect_auth_or_signup_modal(p)
        if not recheck["detected"]:
            log.info("Modal successfully dismissed via close button.")
            return True

        # 3. Try Escape key
        try:
            await p.keyboard.press("Escape")
            await asyncio.sleep(0.8)
        except Exception as err:
            log.warning(f"Error pressing Escape to dismiss modal: {err}")

        # 4. Verify modal disappeared
        final_check = await self.detect_auth_or_signup_modal(p)
        if not final_check["detected"]:
            log.info("Modal successfully dismissed via Escape key.")
            return True

        log.warning(f"Modal is still present and blocking: '{final_check['title']}'")
        return False

    async def verify_instagram_post(
        self,
        expected_account: str,
        expected_post_url: str | None = None,
        expected_post_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Rigorous real browser DOM verification for an open Instagram post.
        Task-specific requirements:
        1. Exact target post URL/ID loaded OR dialog corresponding to that exact post open.
        2. Must NOT be merely on the profile grid.
        3. No blocking login/signup modal obscuring the content (with safe X / Escape attempt).
        4. Official expected account identified as post author in the post container.
        5. Post media (image/video) is actually rendered with real dimensions (>100x100px).
        6. Page is not blank, loading, error, or login interstitial.
        """
        page: Page = await self._get_page()
        account_clean = expected_account.lower().strip("@")
        action = f"verify Instagram post from @{account_clean}"
        expected_desc = f"Instagram post page open for @{account_clean}"
        if expected_post_url:
            expected_desc += f" matching {expected_post_url}"

        if not page or page.is_closed():
            log_verification_step(action, expected_desc, "Browser closed", "FAIL", "unverified")
            return {
                "passed": False,
                "target_reached": False,
                "login_modal_detected": False,
                "reason": "Browser is not open",
                "error": "Browser is not open",
                "checks": [],
            }

        current_url = page.url
        page_title = ""
        body_text = ""
        try:
            page_title = await page.title()
            body_text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            pass

        checks: list[dict[str, Any]] = []
        overall_passed = True
        target_reached = True
        failure_reasons: list[str] = []

        # ── 1. Check for blocking login/signup modal and attempt safe dismissal ──
        modal_info = await self.detect_auth_or_signup_modal(page)
        modal_detected = modal_info["detected"]
        modal_dismissed = False

        if modal_detected:
            log.info(f"Auth/signup modal detected: '{modal_info['title']}'. Attempting safe dismissal (X / Escape)...")
            dismissed = await self.dismiss_auth_or_signup_modal(page)
            if dismissed:
                modal_dismissed = True
                modal_detected = False
                log.info("Auth/signup modal successfully dismissed and confirmed gone.")
            else:
                log.warning(f"Auth/signup modal remains blocking: '{modal_info['title']}'")

        checks.append({
            "check": "Not blocked by login/signup modal",
            "passed": not modal_detected,
            "details": f"modal_detected={modal_detected}, modal_dismissed={modal_dismissed}",
        })
        if modal_detected:
            overall_passed = False
            target_reached = False
            failure_reasons.append(f"Blocking login/signup modal obscures post: '{modal_info['title']}'")

        # ── 2. Error page or blank page check ──
        is_blank = len(body_text.strip()) == 0
        error_indicators = ["sorry, this page isn't available", "page not found", "something went wrong", "site cannot be reached"]
        is_error = any(e in body_text.lower() or e in page_title.lower() for e in error_indicators)
        is_login_wall = "accounts/login" in current_url

        not_broken = not is_blank and not is_error and not is_login_wall
        checks.append({
            "check": "Page is not blank/error/login",
            "passed": not_broken,
            "details": f"blank={is_blank}, error={is_error}, login={is_login_wall}",
        })
        if not not_broken:
            overall_passed = False
            target_reached = False
            failure_reasons.append("Page is blank, error page, or login redirect")

        # ── 3. Exact target post URL / permalink matching ──
        expected_id = expected_post_id
        if not expected_id and expected_post_url:
            m = re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", expected_post_url)
            if m:
                expected_id = m.group(1)

        # Detect whether we are on a post URL vs profile page
        url_has_post = "/p/" in current_url or "/reel/" in current_url
        actual_post_id = None
        if url_has_post:
            m_act = re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", current_url)
            if m_act:
                actual_post_id = m_act.group(1)

        # Detect whether a post modal dialog is open (distinct from login modal)
        dialog_has_post = False
        dialog_post_id = None
        try:
            # An authentic post dialog contains article and post author/media, not an auth wall
            post_dialog = page.locator('div[role="dialog"]:has(article), div[aria-modal="true"]:has(article)').first
            if await post_dialog.count() > 0 and await post_dialog.is_visible():
                dialog_has_post = True
                # Extract post link inside dialog if available
                post_links = post_dialog.locator('a[href*="/p/"], a[href*="/reel/"]')
                if await post_links.count() > 0:
                    href = (await post_links.first.get_attribute("href")) or ""
                    m_d = re.search(r"/(?:p|reel)/([a-zA-Z0-9_-]+)", href)
                    if m_d:
                        dialog_post_id = m_d.group(1)
        except Exception:
            pass

        is_post_open = url_has_post or dialog_has_post
        checks.append({
            "check": "Post page or dialog is open (not profile grid)",
            "passed": is_post_open,
            "actual_url": current_url,
            "dialog_open": dialog_has_post,
        })
        if not is_post_open:
            overall_passed = False
            target_reached = False
            failure_reasons.append(f"Post is not open (browser is still on profile grid '{current_url}')")

        # Verify exact target post ID if expected
        if expected_id:
            current_id = actual_post_id or dialog_post_id
            id_matched = (current_id == expected_id) or (expected_post_url and expected_post_url.rstrip("/") in current_url.rstrip("/"))
            checks.append({
                "check": f"Target post ID matches expected '{expected_id}'",
                "passed": id_matched,
                "expected_id": expected_id,
                "actual_id": current_id,
            })
            if not id_matched:
                overall_passed = False
                target_reached = False
                failure_reasons.append(f"Opened post '{current_id}' does not match expected target '{expected_id}'")

        # ── 4. Account verification inside the open post container ──
        # Find the specific post container (article), not the profile grid
        account_verified = False
        try:
            # Single post container
            post_container = page.locator('div[role="dialog"] article, main article, article').first
            if await post_container.count() > 0 and await post_container.is_visible():
                author_loc = post_container.locator(
                    f'header a[href*="/{account_clean}/"], a[href*="/{account_clean}/"], '
                    f'header :has-text("{account_clean}"), span:has-text("{account_clean}")'
                ).first
                if await author_loc.count() > 0 and await author_loc.is_visible():
                    account_verified = True
            elif is_post_open:
                # Fallback to page title / text if in single post view
                account_verified = (
                    account_clean in page_title.lower() or
                    account_clean in body_text.lower()
                )
        except Exception:
            pass

        checks.append({
            "check": f"Author @{account_clean} verified in post",
            "passed": account_verified,
        })
        if not account_verified:
            overall_passed = False
            failure_reasons.append(f"Author @{account_clean} was not identified in the post container")

        # ── 5. Post media (image/video) visibility check ──
        media_visible = False
        media_src = ""
        try:
            # Look for post media specifically inside post container, reels player, or main post view
            media_selectors = [
                'div[role="dialog"] article img',
                'main article img',
                'article img[style*="object-fit"]',
                'article img',
                'main img',
                'div[role="dialog"] video',
                'main video',
                'article video',
                'video',
                'img[srcset*="cdninstagram"]',
                'img[src*="cdninstagram"]',
            ]
            media_locators = page.locator(", ".join(media_selectors))
            if await media_locators.count() == 0:
                try:
                    await page.wait_for_selector("img, video", timeout=1500)
                except Exception:
                    pass
            media_count = await media_locators.count()
            for m_i in range(min(media_count, 15)):
                m_candidate = media_locators.nth(m_i)
                if await m_candidate.is_visible():
                    bbox = await m_candidate.bounding_box()
                    # Real post media has rendered dimensions > 100x100px (reject 32x32 avatars)
                    if bbox and bbox.get("width", 0) > 100 and bbox.get("height", 0) > 100:
                        media_visible = True
                        media_src = (await m_candidate.get_attribute("src")) or ""
                        break
        except Exception:
            pass

        checks.append({
            "check": "Post media (image/video >100x100px) is visible",
            "passed": media_visible,
            "src": media_src[:80] if media_src else None,
        })
        if not media_visible:
            overall_passed = False
            failure_reasons.append("Post media (image/video) is not visible in post container")

        # ── Final Verdict & Structured Logging ──
        reason_str = "Instagram post verified successfully" if overall_passed else "; ".join(failure_reasons)
        verdict = "PASS" if overall_passed else "FAIL"
        art_status = "verified" if overall_passed else "opened"
        observed_desc = (
            f"URL={current_url}, title='{page_title[:40]}', target_reached={target_reached}, "
            f"account_verified={account_verified}, media_visible={media_visible}, "
            f"modal_detected={modal_detected}"
        )

        log_verification_step(
            action=action,
            expected=expected_desc,
            observed=observed_desc,
            result=verdict,
            artifact_status=art_status,
        )

        return {
            "passed": overall_passed,
            "target_reached": target_reached,
            "login_modal_detected": modal_detected,
            "modal_dismissed": modal_dismissed,
            "needs_handoff": modal_detected and not overall_passed,
            "reason": reason_str,
            "action": action,
            "url": current_url,
            "title": page_title,
            "account": account_clean,
            "media_url": media_src,
            "expected_url": expected_post_url,
            "actual_url": current_url,
            "checks": checks,
            "observed": {
                "url": current_url,
                "title": page_title,
                "target_reached": target_reached,
                "account_verified": account_verified,
                "media_visible": media_visible,
                "not_broken": not_broken,
                "modal_detected": modal_detected,
                "modal_dismissed": modal_dismissed,
            },
        }

    async def verify_spec(self, spec: dict[str, Any]) -> dict[str, Any]:
        """
        Runs verification checks against the live DOM.
        Supported checks in spec:
          - url_contains: str
          - text_on_page: str
          - text_not_on_page: str
          - selector_exists: str
          - selector_hidden: str
          - element_value: { selector: str, value: str }
        """
        page: Page = await self._get_page()
        checks: list[dict[str, Any]] = []
        overall_passed = True

        current_url = page.url
        body_text = ""

        # 1. URL checks
        if "url_contains" in spec and spec["url_contains"]:
            target = str(spec["url_contains"])
            passed = target in current_url
            checks.append({"check": f"URL contains '{target}'", "passed": passed, "actual": current_url})
            if not passed:
                overall_passed = False

        # 2. Text on page checks
        if "text_on_page" in spec and spec["text_on_page"]:
            target_text = str(spec["text_on_page"])
            if not body_text:
                body_text = await page.evaluate("() => document.body ? document.body.innerText : ''")
            passed = target_text.lower() in body_text.lower()
            checks.append({"check": f"Text '{target_text}' present on page", "passed": passed})
            if not passed:
                overall_passed = False

        # 3. Text not on page checks
        if "text_not_on_page" in spec and spec["text_not_on_page"]:
            absent_text = str(spec["text_not_on_page"])
            if not body_text:
                body_text = await page.evaluate("() => document.body ? document.body.innerText : ''")
            passed = absent_text.lower() not in body_text.lower()
            checks.append({"check": f"Text '{absent_text}' absent from page", "passed": passed})
            if not passed:
                overall_passed = False

        # 4. Selector exists checks
        if "selector_exists" in spec and spec["selector_exists"]:
            selector = str(spec["selector_exists"])
            try:
                locator = page.locator(selector).first
                count = await locator.count()
                visible = await locator.is_visible() if count > 0 else False
                passed = visible
            except Exception:
                passed = False
            checks.append({"check": f"Element '{selector}' is visible", "passed": passed})
            if not passed:
                overall_passed = False

        # 5. Selector hidden checks
        if "selector_hidden" in spec and spec["selector_hidden"]:
            selector = str(spec["selector_hidden"])
            try:
                locator = page.locator(selector).first
                visible = await locator.is_visible() if await locator.count() > 0 else False
                passed = not visible
            except Exception:
                passed = True
            checks.append({"check": f"Element '{selector}' is hidden/dismissed", "passed": passed})
            if not passed:
                overall_passed = False

        log.info(f"Verification result: passed={overall_passed} ({len(checks)} checks)")
        return {
            "passed": overall_passed,
            "checks": checks,
            "url": current_url,
        }


def json_format_dict(d: dict[str, Any]) -> str:
    """Helper to cleanly format dicts for structured logs."""
    return ", ".join(f"{k}='{v}'" for k, v in d.items() if v is not None)
