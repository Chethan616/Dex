"""
Navigation: Robust URL navigation and history controls for DEX Browser Automation.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

log = logging.getLogger("Navigation")


def normalize_url(url: str) -> str:
    """Ensure URL has a valid scheme."""
    url = url.strip()
    if not url:
        return "about:blank"
    if url.startswith(("http://", "https://", "file://", "about:", "chrome:", "data:")):
        return url
    if url.startswith("localhost") or url.startswith("127.0.0.1"):
        return f"http://{url}"
    return f"https://{url}"


class Navigation:
    def __init__(self, page_getter):
        self._get_page = page_getter

    async def goto(
        self,
        url: str,
        wait_until: str = "domcontentloaded",
        timeout_ms: int = 30000,
    ) -> dict[str, str]:
        """
        Navigate to a URL with error handling and normalization.
        Returns {'url': current_url, 'title': page_title}.
        """
        target_url = normalize_url(url)
        page: Page = await self._get_page()

        log.info(f"Navigating to {target_url} (wait_until={wait_until}, timeout={timeout_ms}ms)")
        try:
            response = await page.goto(target_url, wait_until=wait_until, timeout=timeout_ms)
            status_code = response.status if response else 200
            log.info(f"Navigation complete: HTTP {status_code} at {page.url}")
        except PlaywrightTimeoutError:
            log.warning(f"Navigation timed out waiting for '{wait_until}', proceeding with current state")
        except Exception as err:
            log.error(f"Navigation error for {target_url}: {err}")
            raise

        title = await page.title()
        return {"url": page.url, "title": title}

    async def back(self, timeout_ms: int = 15000) -> dict[str, str]:
        page: Page = await self._get_page()
        log.info("Navigating back in history")
        try:
            await page.go_back(wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            log.warning(f"Go back error: {e}")
        return {"url": page.url, "title": await page.title()}

    async def forward(self, timeout_ms: int = 15000) -> dict[str, str]:
        page: Page = await self._get_page()
        log.info("Navigating forward in history")
        try:
            await page.go_forward(wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            log.warning(f"Go forward error: {e}")
        return {"url": page.url, "title": await page.title()}

    async def reload(self, timeout_ms: int = 20000) -> dict[str, str]:
        page: Page = await self._get_page()
        log.info("Reloading active page")
        try:
            await page.reload(wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            log.warning(f"Reload error: {e}")
        return {"url": page.url, "title": await page.title()}

    async def wait_for_url(self, pattern: str, timeout_ms: int = 20000) -> bool:
        """Wait until page URL matches pattern or contains substring."""
        page: Page = await self._get_page()
        try:
            if re.search(r"[*?+^$]", pattern):
                # Regex pattern
                regex = re.compile(pattern)
                await page.wait_for_url(regex, timeout=timeout_ms)
            else:
                # Substring check
                await page.wait_for_url(lambda u: pattern in u, timeout=timeout_ms)
            return True
        except Exception as err:
            log.debug(f"wait_for_url timeout for '{pattern}': {err}")
            return False

    async def wait_for_load(self, state: str = "networkidle", timeout_ms: int = 10000) -> None:
        page: Page = await self._get_page()
        try:
            await page.wait_for_load_state(state, timeout=timeout_ms)
        except Exception:
            pass
