"""
Interaction: Semantic browser actions with verification hooks and password protection.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, Callable
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from browser_state import ActionResult
from inspector import Inspector

log = logging.getLogger("Interaction")


class PasswordFieldAttempted(Exception):
    """Raised when an automated action attempts to fill a password or OTP field."""


class Interaction:
    def __init__(self, page_getter: Callable[[], Any], inspector: Inspector):
        self._get_page = page_getter
        self._inspector = inspector

    async def _check_password_field(self, page: Page, selector: str) -> bool:
        """SAFETY: Ensure automated script never types into password/MFA fields."""
        check_js = """(sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const type = (el.getAttribute('type') || '').toLowerCase();
            const name = (el.getAttribute('name') || '').toLowerCase();
            const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
            return type === 'password' || ac.includes('password') || /pass|otp|mfa|2fa|secret/.test(name);
        }"""
        try:
            return bool(await page.evaluate(check_js, selector))
        except Exception:
            return False

    async def click(self, target: str, timeout_ms: int = 15000) -> ActionResult:
        """
        Clicks an element by temporary ID ('e1'), CSS selector, or visible text.
        """
        page: Page = await self._get_page()
        selector = await self._inspector.resolve_target(target)
        log.info(f"Clicking target '{target}' via selector: {selector}")

        url_before = page.url
        try:
            locator = page.locator(selector).first
            await locator.wait_for(state="visible", timeout=timeout_ms)
            await locator.click(timeout=timeout_ms)
            await asyncio.sleep(0.3)  # Brief settle for UI reactions

            url_after = page.url
            state_changed = (url_before != url_after)

            return ActionResult(
                success=True,
                action="click",
                target=target,
                details=f"Clicked {target}" + (f", navigated to {url_after}" if state_changed else ""),
                state_changed=state_changed,
                data={"url_before": url_before, "url_after": url_after},
            )
        except Exception as err:
            log.warning(f"Click failed on '{target}': {err}")
            return ActionResult(
                success=False,
                action="click",
                target=target,
                error=str(err),
            )

    async def sign_in(self, url: str) -> ActionResult:
        """
        Fills a stored credential into the sign-in form at `url`, for the exact
        origin it lands on. This is the one narrow, deliberate exception to
        `type_text`'s password-field refusal above — see
        agents/browser/site_credentials.py for the properties that make it
        safe (exact origin re-checked here after redirects, never seen by the
        model, read from DPAPI at the moment of typing). Never reachable
        through the generic type/fill_form primitives.
        """
        import site_credentials

        cred = site_credentials.lookup(url)
        if not cred:
            host = site_credentials.host_of(url)
            return ActionResult(
                success=False, action="sign_in", target=url,
                error=f"No stored credential for {host or url}",
                data={"reason": "No stored credential for this site.", "host": host},
            )

        page: Page = await self._get_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as err:
            return ActionResult(success=False, action="sign_in", target=url, error=str(err))

        # The credential is offered only to the origin it actually lands on,
        # re-checked here rather than trusted from the caller's `url`.
        current_host = site_credentials.host_of(page.url)
        if current_host != cred["host"]:
            return ActionResult(
                success=False, action="sign_in", target=url,
                error=f"Page landed on {current_host}, not {cred['host']}; refusing to type the credential there.",
                data={"reason": "Origin mismatch after redirect.", "host": current_host, "url": page.url},
            )

        filled: list[str] = []
        if cred.get("username"):
            try:
                loc = page.locator(
                    "input[type=email], input[autocomplete=username], "
                    "input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]"
                ).first
                await loc.wait_for(state="visible", timeout=8000)
                await loc.fill(cred["username"])
                filled.append("username")
            except Exception as err:
                log.info(f"sign_in: no username field found on {current_host}: {err}")

        if cred.get("password"):
            try:
                loc = page.locator("input[type=password]").first
                await loc.wait_for(state="visible", timeout=8000)
                await loc.fill(cred["password"])
                filled.append("password")
            except Exception as err:
                log.info(f"sign_in: no password field found on {current_host}: {err}")

        return ActionResult(
            success=len(filled) > 0,
            action="sign_in",
            target=url,
            details=(
                f"Filled {' and '.join(filled)} on {current_host}"
                if filled else f"Could not find fields to fill on {current_host}"
            ),
            state_changed=len(filled) > 0,
            data={
                "filled": filled,
                "host": current_host,
                "url": page.url,
                "reason": None if filled else "No matching username/password fields found.",
            },
        )

    async def type_text(
        self,
        target: str,
        text: str,
        press_enter: bool = False,
        clear: bool = False,
        timeout_ms: int = 15000,
    ) -> ActionResult:
        """
        Types text into a field. Refuses password fields to enforce DEX safety policy.
        """
        page: Page = await self._get_page()
        selector = await self._inspector.resolve_target(target)

        # Safety check: do not type into password fields
        if await self._check_password_field(page, selector):
            raise PasswordFieldAttempted(
                f"Target '{target}' is a password or authentication field. "
                "Dex does not type passwords. User must sign in directly."
            )

        log.info(f"Typing into target '{target}' (length={len(text)}, enter={press_enter})")
        try:
            locator = page.locator(selector).first
            await locator.wait_for(state="visible", timeout=timeout_ms)

            if clear:
                await locator.fill("")

            await locator.fill(text)
            if press_enter:
                await locator.press("Enter")
            await asyncio.sleep(0.2)

            return ActionResult(
                success=True,
                action="type",
                target=target,
                details=f"Entered text into {target}",
                state_changed=True,
            )
        except Exception as err:
            log.warning(f"Type failed on '{target}': {err}")
            return ActionResult(
                success=False,
                action="type",
                target=target,
                error=str(err),
            )

    async def select_option(self, target: str, value: str, timeout_ms: int = 10000) -> ActionResult:
        page: Page = await self._get_page()
        selector = await self._inspector.resolve_target(target)
        try:
            locator = page.locator(selector).first
            await locator.select_option(value, timeout=timeout_ms)
            return ActionResult(success=True, action="select", target=target, details=f"Selected '{value}'")
        except Exception as err:
            return ActionResult(success=False, action="select", target=target, error=str(err))

    async def hover(self, target: str, timeout_ms: int = 10000) -> ActionResult:
        page: Page = await self._get_page()
        selector = await self._inspector.resolve_target(target)
        try:
            locator = page.locator(selector).first
            await locator.hover(timeout=timeout_ms)
            return ActionResult(success=True, action="hover", target=target, details=f"Hovered over {target}")
        except Exception as err:
            return ActionResult(success=False, action="hover", target=target, error=str(err))

    async def scroll(self, direction: str = "down", amount: int = 500) -> ActionResult:
        page: Page = await self._get_page()
        delta = amount if direction.lower() == "down" else -amount
        try:
            await page.mouse.wheel(0, delta)
            await asyncio.sleep(0.2)
            return ActionResult(
                success=True,
                action="scroll",
                details=f"Scrolled {direction} by {amount}px",
                state_changed=True,
            )
        except Exception as err:
            return ActionResult(success=False, action="scroll", error=str(err))

    async def press_key(self, key: str) -> ActionResult:
        page: Page = await self._get_page()
        try:
            await page.keyboard.press(key)
            await asyncio.sleep(0.2)
            return ActionResult(success=True, action="press_key", details=f"Pressed key '{key}'", state_changed=True)
        except Exception as err:
            return ActionResult(success=False, action="press_key", error=str(err))

    async def upload_file(self, target: str, file_paths: list[str]) -> ActionResult:
        page: Page = await self._get_page()
        selector = await self._inspector.resolve_target(target)
        existing = [p for p in file_paths if Path(p).exists()]
        if not existing:
            return ActionResult(success=False, action="upload_file", error="No specified files exist on disk.")

        try:
            locator = page.locator(selector).first
            await locator.set_input_files(existing)
            return ActionResult(
                success=True,
                action="upload_file",
                target=target,
                details=f"Uploaded {len(existing)} file(s): {', '.join(existing)}",
                state_changed=True,
            )
        except Exception as err:
            return ActionResult(success=False, action="upload_file", target=target, error=str(err))

    async def download_file(
        self,
        trigger_target: str | None = None,
        save_directory: str | None = None,
        timeout_s: int = 30,
    ) -> ActionResult:
        """
        Triggers a download by clicking trigger_target or waiting for an active download event.
        """
        page: Page = await self._get_page()
        dest_dir = Path(save_directory) if save_directory else Path.home() / "Downloads"
        dest_dir.mkdir(parents=True, exist_ok=True)

        try:
            async with page.expect_download(timeout=timeout_s * 1000) as download_info:
                if trigger_target:
                    click_res = await self.click(trigger_target)
                    if not click_res.success:
                        return ActionResult(
                            success=False,
                            action="download_file",
                            error=f"Trigger click failed: {click_res.error}",
                        )

            download = await download_info.value
            suggested_filename = download.suggested_filename
            target_path = dest_dir / suggested_filename
            await download.save_as(str(target_path))

            size = target_path.stat().st_size if target_path.exists() else 0
            log.info(f"Downloaded file: {target_path} ({size} bytes)")

            return ActionResult(
                success=True,
                action="download_file",
                details=f"Downloaded {suggested_filename} ({size} bytes)",
                state_changed=True,
                data={
                    "path": str(target_path),
                    "filename": suggested_filename,
                    "bytes": size,
                },
            )
        except Exception as err:
            log.warning(f"Download failed: {err}")
            return ActionResult(success=False, action="download_file", error=str(err))

    async def download_media(
        self,
        selector_hint: str | None = None,
        save_directory: str | None = None,
    ) -> ActionResult:
        """
        For pages that ARE the content and expose no download trigger — an
        Instagram post, a raw image page. download_file waits for a
        page.on('download') event that never fires here, because there is
        no download button or link to click.

        Finds the largest matching img/video element, resolves its real src,
        and fetches the bytes through the PAGE's own request context
        (page.request), so the session's cookies apply — a plain unauthenticated
        fetch would get the login page instead of the media.
        """
        page: Page = await self._get_page()
        selectors = [selector_hint] if selector_hint else [
            "video[src], video source[src]",
            "img[srcset]",
            "img[src]",
        ]

        # Measuring naturalWidth/naturalHeight before an image has actually
        # loaded reads 0 for everything, which made the "largest wins" sort
        # fall back to plain DOM order — silently picking a 1x1 tracking
        # pixel over the real content. Give images already in the DOM a
        # bounded chance to finish loading first.
        try:
            await page.wait_for_function(
                """() => Array.from(document.querySelectorAll('img'))
                    .every(img => img.complete)""",
                timeout=3000,
            )
        except Exception:
            pass  # Best-effort — proceed with whatever has loaded so far.

        js = """(els) => els
            .map(e => ({
                src: e.currentSrc || e.src || e.getAttribute('src'),
                w: e.naturalWidth || e.videoWidth || 0,
                h: e.naturalHeight || e.videoHeight || 0,
            }))
            .filter(e => e.src)
            .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || null"""

        src: str | None = None
        for sel in selectors:
            try:
                candidate = await page.eval_on_selector_all(sel, js)
            except Exception:
                candidate = None
            if candidate and candidate.get("src"):
                src = candidate["src"]
                break

        if not src:
            return ActionResult(
                success=False, action="download_media",
                error="No image or video element found on this page",
            )

        dest_dir = Path(save_directory) if save_directory else Path.home() / "Downloads"
        dest_dir.mkdir(parents=True, exist_ok=True)

        try:
            response = await page.request.get(src)
            if not response.ok:
                return ActionResult(
                    success=False, action="download_media",
                    error=f"{src} answered HTTP {response.status}",
                )
            body = await response.body()
        except Exception as err:
            log.warning(f"download_media fetch failed for {src}: {err}")
            return ActionResult(success=False, action="download_media", error=str(err))

        ext = _guess_media_ext(src, response.headers.get("content-type", ""))
        target_path = dest_dir / f"media-{int(time.time())}{ext}"
        target_path.write_bytes(body)

        log.info(f"Downloaded media: {target_path} ({len(body)} bytes) from {src}")
        return ActionResult(
            success=True,
            action="download_media",
            state_changed=True,
            details=f"Downloaded {target_path.name} ({len(body)} bytes)",
            data={
                "path": str(target_path),
                "filename": target_path.name,
                "bytes": len(body),
                "src": src,
            },
        )


def _guess_media_ext(src: str, content_type: str) -> str:
    """Extension from the URL path, falling back to the response's content-type."""
    from urllib.parse import urlparse

    url_path = urlparse(src).path
    suffix = Path(url_path).suffix
    if suffix and len(suffix) <= 5:
        return suffix

    mapping = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
        "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm",
    }
    for mime, ext in mapping.items():
        if mime in content_type:
            return ext
    return ".bin"
