"""
TabManager: Multi-tab and popup management for DEX Browser Automation.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable
from playwright.async_api import BrowserContext, Dialog, Page

from browser_state import TabInfo

log = logging.getLogger("TabManager")


class TabManager:
    def __init__(self, context_getter: Callable[[], BrowserContext]):
        self._get_context = context_getter
        self._active_page: Page | None = None
        self._page_ids: dict[Page, int] = {}
        self._task_pages: dict[str, Page] = {}
        self._next_id = 1
        self._dialog_handlers: list[Callable[[Dialog], Any]] = []

    def attach_context_listeners(self, context: BrowserContext) -> None:
        """Sets up popup tracking and dialog listeners on context."""
        context.on("page", self._on_new_page)

    def _on_new_page(self, page: Page) -> None:
        tab_id = self._get_or_create_id(page)
        log.info(f"New tab/popup detected: Tab #{tab_id}")
        page.on("dialog", self._handle_dialog)
        page.on("close", lambda: self._on_page_closed(page))
        # Make the new popup/page active
        self._active_page = page

    def _on_page_closed(self, page: Page) -> None:
        tab_id = self._page_ids.pop(page, None)
        log.info(f"Tab #{tab_id} closed")
        for task_id, task_page in list(self._task_pages.items()):
            if task_page == page:
                self._task_pages.pop(task_id, None)
        if self._active_page == page:
            ctx = self._get_context()
            remaining = ctx.pages
            self._active_page = remaining[-1] if remaining else None

    async def _handle_dialog(self, dialog: Dialog) -> None:
        log.info(f"Browser dialog opened: [{dialog.type}] '{dialog.message}'")
        for handler in self._dialog_handlers:
            try:
                res = handler(dialog)
                if asyncio.iscoroutine(res):
                    await res
                return
            except Exception as err:
                log.warning(f"Dialog handler error: {err}")
        # Default auto-dismissal/acceptance:
        try:
            await dialog.accept()
        except Exception:
            pass

    def _get_or_create_id(self, page: Page) -> int:
        if page not in self._page_ids:
            self._page_ids[page] = self._next_id
            self._next_id += 1
        return self._page_ids[page]

    async def get_active_page(self) -> Page:
        """Returns the currently active page, opening a new one if none exist."""
        ctx = self._get_context()
        pages = ctx.pages
        if not pages:
            page = await ctx.new_page()
            self._on_new_page(page)
            return page

        if self._active_page and not self._active_page.is_closed() and self._active_page in pages:
            return self._active_page

        # Fallback to the last opened page
        self._active_page = pages[-1]
        self._get_or_create_id(self._active_page)
        return self._active_page

    async def get_task_page(self, task_id: str) -> Page:
        """Return the stable page owned by a task, never a random foreground tab."""
        ctx = self._get_context()
        page = self._task_pages.get(task_id)
        if page is None or page.is_closed() or page not in ctx.pages:
            page = await ctx.new_page()
            self._on_new_page(page)
            self._task_pages[task_id] = page
            log.info("TAB_BIND task_id=%s tab_id=%s", task_id, self._get_or_create_id(page))
        self._active_page = page
        return page

    async def list_tabs(self) -> list[TabInfo]:
        """Returns structured information about all currently open tabs."""
        ctx = self._get_context()
        active = self._active_page if self._active_page and not self._active_page.is_closed() else None
        tabs: list[TabInfo] = []

        for page in ctx.pages:
            if page.is_closed():
                continue
            tid = self._get_or_create_id(page)
            try:
                title = await page.title()
            except Exception:
                title = ""
            url = page.url
            tabs.append(
                TabInfo(
                    tab_id=tid,
                    title=title,
                    url=url,
                    is_active=(active is not None and page == active),
                )
            )
        return tabs

    async def new_tab(self, url: str | None = None) -> Page:
        """Opens a new tab, optionally navigating to a URL, and brings it to front."""
        ctx = self._get_context()
        page = await ctx.new_page()
        self._on_new_page(page)
        await page.bring_to_front()
        if url:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        return page

    async def switch_tab(self, target: int | str) -> Page:
        """
        Switch active tab by tab_id (int) or URL/title substring (str).
        """
        ctx = self._get_context()
        for page in ctx.pages:
            if page.is_closed():
                continue
            tid = self._get_or_create_id(page)
            if isinstance(target, int) and tid == target:
                self._active_page = page
                await page.bring_to_front()
                return page
            elif isinstance(target, str):
                if target in page.url or target.lower() in (await page.title()).lower():
                    self._active_page = page
                    await page.bring_to_front()
                    return page

        raise ValueError(f"No open tab found matching target: {target}")

    async def close_tab(self, target: int | str | None = None) -> bool:
        """Closes the specified tab, or active tab if None."""
        if target is None:
            page = await self.get_active_page()
            await page.close()
            return True

        ctx = self._get_context()
        for page in ctx.pages:
            if page.is_closed():
                continue
            tid = self._get_or_create_id(page)
            if (isinstance(target, int) and tid == target) or (
                isinstance(target, str) and (target in page.url or target.lower() in (await page.title()).lower())
            ):
                await page.close()
                return True
        return False
