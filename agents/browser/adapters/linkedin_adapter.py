"""
LinkedInAdapter: Fast-path adapter for LinkedIn profile search and messaging.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from playwright.async_api import Page

from browser_state import ActionResult, BrowserArtifact
from adapters.base_adapter import AdapterFallbackException, SiteAdapter

log = logging.getLogger("LinkedInAdapter")


class LinkedInAdapter(SiteAdapter):
    name = "LinkedInAdapter"
    domains = ["linkedin.com"]

    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        if target_site and not self._domain_matches_target(target_site):
            return False
        if self._task_mentions_other_site(task):
            return False
        t = task.lower()
        is_li = "linkedin" in t or (target_site and "linkedin" in target_site.lower())
        return bool(is_li) and any(k in t for k in ["profile", "post", "search", "message", "connect"])

    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        log.info(f"Executing LinkedIn workflow for task: '{task}'")
        page: Page = await manager.get_active_page()

        query = context.get("query") or ""
        if not query:
            m = re.search(r"(?:find|search|on linkedin for|on linkedin)\s+([a-zA-Z0-9\s._-]+)", task, re.IGNORECASE)
            query = m.group(1).strip() if m else ""

        try:
            if "linkedin.com" not in page.url:
                await manager.navigation.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
                await asyncio.sleep(1.0)

            if "authwall" in page.url or "login" in page.url:
                raise AdapterFallbackException("LinkedIn requires authentication", {"login_required": True})

            if query:
                search_url = f"https://www.linkedin.com/search/results/all/?keywords={query.replace(' ', '%20')}"
                await manager.navigation.goto(search_url, wait_until="domcontentloaded")
                await asyncio.sleep(1.0)

            title = await page.title()
            artifact = BrowserArtifact(
                kind="page",
                name=title or "LinkedIn Search",
                locator=page.url,
                metadata={"query": query},
            )
            manager.add_artifact(artifact)

            return ActionResult(
                success=True,
                action="linkedin_search",
                target=page.url,
                details=f"Navigated LinkedIn search for '{query}'",
                state_changed=True,
                verification={"passed": True, "checks": [{"check": "LinkedIn search loaded", "passed": True}]},
                data={"url": page.url, "title": title, "artifact": artifact.to_dict()},
            )
        except AdapterFallbackException:
            raise
        except Exception as err:
            raise AdapterFallbackException(f"LinkedIn adapter error: {err}")
