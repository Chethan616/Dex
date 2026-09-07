"""
VisualFallback: Screenshots and visual coordinate fallback for DEX Browser Automation.
"""
from __future__ import annotations

import base64
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Callable
from playwright.async_api import Page

log = logging.getLogger("VisualFallback")


def get_screenshots_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    path = Path(base) / "DEX" / "screenshots"
    path.mkdir(parents=True, exist_ok=True)
    return path


class VisualFallback:
    def __init__(self, page_getter: Callable[[], Any]):
        self._get_page = page_getter

    async def screenshot(
        self,
        save_path: str | None = None,
        full_page: bool = False,
    ) -> dict[str, Any]:
        """Captures a PNG screenshot of the current page."""
        page: Page = await self._get_page()

        if not save_path:
            filename = f"browser_{int(time.time() * 1000)}.png"
            dest = get_screenshots_dir() / filename
        else:
            dest = Path(save_path)
            dest.parent.mkdir(parents=True, exist_ok=True)

        log.info(f"Capturing screenshot (full_page={full_page}) to {dest}")
        await page.screenshot(path=str(dest), full_page=full_page)

        # Also get base64 for vision model consumption
        bytes_data = dest.read_bytes()
        b64 = base64.b64encode(bytes_data).decode("utf-8")

        return {
            "path": str(dest),
            "size": len(bytes_data),
            "base64": b64,
            "url": page.url,
            "actual_url": page.url,
            "screenshot_source": "browser_page",
            "capture_method": "playwright_page_screenshot",
            "page_id": str(id(page)),
        }

    async def click_coordinate(self, x: int, y: int) -> bool:
        """
        Clicks absolute pixel coordinates on the page as visual fallback.
        """
        page: Page = await self._get_page()
        log.info(f"Visual fallback: clicking coordinates ({x}, {y})")
        try:
            await page.mouse.click(x, y)
            await page.wait_for_timeout(300)
            return True
        except Exception as err:
            log.warning(f"Coordinate click failed at ({x}, {y}): {err}")
            return False
