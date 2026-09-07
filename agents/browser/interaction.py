"""
Interaction: Semantic browser actions with verification hooks and password protection.
"""
from __future__ import annotations

import asyncio
import logging
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
