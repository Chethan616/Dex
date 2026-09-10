"""
Adapter Registry: Central registration and fast-path resolution for domain adapters.
"""
from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlparse

from adapters.base_adapter import SiteAdapter
from adapters.gmail_adapter import GmailAdapter
from adapters.instagram_adapter import InstagramAdapter
from adapters.linkedin_adapter import LinkedInAdapter
from adapters.whatsapp_adapter import WhatsAppAdapter
from adapters.youtube_adapter import YouTubeAdapter

log = logging.getLogger("AdapterRegistry")


def _disabled_domains() -> set[str]:
    """
    Sites whose fast-path adapter should be skipped, forcing the generic
    WebAdapter loop + SiteKnowledge instead. Live-acceptance-test-only
    escape hatch (Phase 8 of the WebAdapter migration): a site's adapter
    file is only a candidate for removal once the generic loop is proven to
    reach the same verified outcome without it.

    DEX_DISABLE_ADAPTERS="instagram.com,youtube.com" or "all".
    """
    raw = os.environ.get("DEX_DISABLE_ADAPTERS", "").strip().lower()
    if not raw:
        return set()
    if raw == "all":
        return {"*"}
    return {d.strip() for d in raw.split(",") if d.strip()}


class AdapterRegistry:
    def __init__(self):
        self._adapters: list[SiteAdapter] = [
            InstagramAdapter(),
            GmailAdapter(),
            YouTubeAdapter(),
            LinkedInAdapter(),
            WhatsAppAdapter(),
        ]

    def register(self, adapter: SiteAdapter) -> None:
        self._adapters.insert(0, adapter)

    def find_adapter(
        self,
        task: str,
        current_url: str,
        target_site: str | None = None,
    ) -> SiteAdapter | None:
        """
        Finds a matching fast-path adapter, or None if task should use generic browser loop.

        Args:
            task: User-facing task description.
            current_url: URL currently active in the browser.
            target_site: Explicit target domain for this task (e.g. "youtube.com").
                         When provided, only adapters whose domains match target_site
                         are considered. This is the hard cross-task isolation guard.
        """
        # Derive target_site from current_url if not explicitly set.
        # But ONLY use the derived value as a tiebreaker hint, not as a hard match,
        # because the current tab's URL may be from a *previous* task.
        derived_site: str | None = None
        if not target_site and current_url and current_url.startswith("http"):
            try:
                derived_site = urlparse(current_url).netloc  # e.g. "www.instagram.com"
            except Exception:
                pass

        disabled = _disabled_domains()
        for adapter in self._adapters:
            try:
                if disabled and (
                    "*" in disabled or any(d in disabled for d in adapter.domains)
                ):
                    log.info(f"[ADAPTER DISABLED] {adapter.name} skipped via DEX_DISABLE_ADAPTERS")
                    continue

                # Hard guard: if target_site is set and adapter's domain doesn't match, skip.
                if target_site and not adapter._domain_matches_target(target_site):
                    log.debug(
                        f"Skipping adapter {adapter.name}: target_site='{target_site}' "
                        f"does not match adapter.domains={adapter.domains}"
                    )
                    continue

                if adapter.can_handle(task, current_url, target_site):
                    log.info(
                        f"[ADAPTER SELECTED] {adapter.name} for task: '{task[:60]}' "
                        f"(target_site={target_site or 'auto'}, current_url={current_url[:60]})"
                    )
                    return adapter
            except Exception as e:
                log.debug(f"Error checking adapter {adapter.name}: {e}")
        return None
