"""
Recovery: Automatic recovery from stale elements, overlays, cookie banners, login walls, and CAPTCHAs.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable
from playwright.async_api import Page

log = logging.getLogger("Recovery")

COOKIE_DISMISS_SELECTORS = [
    'button:has-text("Accept all")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Allow all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    '[aria-label="Accept all"]',
    '[aria-label="Allow all cookies"]',
    '#onetrust-accept-btn-handler',
    '.cookie-consent-accept',
    'button:has-text("Decline optional cookies")',
    'button:has-text("Not now")',
    'button:has-text("Dismiss")',
]


class Recovery:
    def __init__(self, page_getter: Callable[[], Any], verifier_getter: Callable[[], Any] | None = None):
        self._get_page = page_getter
        self._get_verifier = verifier_getter

    async def dismiss_common_overlays(self) -> bool:
        """Attempts to dismiss common cookie banners, 'Not now', notification prompts, or auth dialogs."""
        page: Page = await self._get_page()
        dismissed = False

        # Attempt domain-specific modal dismissal first (e.g. Instagram)
        if self._get_verifier:
            try:
                verifier = self._get_verifier()
                if verifier and hasattr(verifier, "dismiss_auth_or_signup_modal"):
                    if await verifier.dismiss_auth_or_signup_modal(page):
                        dismissed = True
            except Exception as e:
                log.debug(f"Domain-specific overlay dismissal check failed: {e}")

        for selector in COOKIE_DISMISS_SELECTORS:
            try:
                locator = page.locator(selector).first
                if await locator.is_visible():
                    log.info(f"Dismissing overlay using selector: {selector}")
                    await locator.click(timeout=2000)
                    await asyncio.sleep(0.3)
                    dismissed = True
                    break
            except Exception:
                continue

        return dismissed

    async def detect_human_wall(self) -> dict[str, str] | None:
        """
        Detects if the current page requires human intervention (CAPTCHA, Login, MFA, blocking overlay).
        Returns handoff info if a wall is detected, else None.
        """
        page: Page = await self._get_page()
        url = page.url.lower()

        # Check domain-specific blocking modals (e.g. Instagram auth/signup overlay)
        if self._get_verifier:
            try:
                verifier = self._get_verifier()
                if verifier and hasattr(verifier, "detect_auth_or_signup_modal"):
                    modal_info = await verifier.detect_auth_or_signup_modal(page)
                    if modal_info.get("detected") and modal_info.get("is_blocking"):
                        dismissed = False
                        if hasattr(verifier, "dismiss_auth_or_signup_modal"):
                            dismissed = await verifier.dismiss_auth_or_signup_modal(page)
                        if not dismissed:
                            domain = re.sub(r"^https?://(?:www\.)?", "", url).split("/")[0] or "Instagram"
                            return {
                                "kind": "login_wall",
                                "reason": f"{domain} requires login/signup: {modal_info.get('title', '')}",
                                "instruction": f"Please sign in or dismiss the modal in the open browser window and click Continue.",
                            }
            except Exception as e:
                log.debug(f"Domain-specific modal check in detect_human_wall failed: {e}")

        # Check URL patterns
        if any(w in url for w in ["/login", "/signin", "auth", "checkpoint", "two_factor", "challenge"]):
            # Confirm with presence of password or login form
            has_password = await page.evaluate(
                "() => !!document.querySelector('input[type=\"password\"], #password, [name=\"password\"]')"
            )
            has_captcha = await page.evaluate(
                "() => !!document.querySelector('.g-recaptcha, .cf-turnstile, iframe[src*=\"captcha\"], iframe[src*=\"recaptcha\"], [id*=\"captcha\"]')"
            )

            domain = re.sub(r"^https?://(?:www\.)?", "", url).split("/")[0]

            if has_captcha:
                return {
                    "kind": "captcha",
                    "reason": f"A security check / CAPTCHA was encountered on {domain}",
                    "instruction": "Please solve the security challenge in the open browser window and click Continue.",
                }
            if has_password:
                return {
                    "kind": "login_required",
                    "reason": f"{domain} requires you to log in",
                    "instruction": f"Please sign in to your {domain} account in the open browser window and click Continue.",
                }

        # Check in-page text for Bot/Cloudflare challenges
        try:
            page_text = (await page.evaluate("() => document.title + ' ' + (document.body ? document.body.innerText.slice(0, 1000) : '')")).lower()
            if any(p in page_text for p in ["verify you are human", "just a moment...", "cloudflare", "enable javascript and cookies"]):
                return {
                    "kind": "cloudflare_challenge",
                    "reason": "Cloudflare / Bot protection challenge detected",
                    "instruction": "Please complete the verification in the open browser window and click Continue.",
                }
        except Exception:
            pass

        return None

    async def check_wall_cleared(self) -> bool:
        """Verifies if the previously detected login/CAPTCHA wall has been cleared."""
        wall = await self.detect_human_wall()
        return wall is None
