"""
BaseAdapter: Standard interface for domain-specific fast-path adapters.
Adapters are optional accelerators, NEVER hard dependencies.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from browser_state import ActionResult

log = logging.getLogger("BaseAdapter")


class AdapterFallbackException(Exception):
    """
    Raised when an adapter encounters unexpected UI changes or cannot complete
    a step, signaling the system to fall back immediately to the generic BrowserManager.

    The optional ``context`` dict can carry structured signals back to the runner:
    - ``needs_handoff``: a reason string or handoff-signal dict — when set the
      runner will surface a handoff to the owner instead of trying the generic loop.
    """
    def __init__(
        self,
        reason: str,
        partial_data: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ):
        super().__init__(reason)
        self.reason = reason
        self.partial_data = partial_data or {}
        self.context = context or {}


class SiteAdapter(ABC):
    """Abstract base class for all domain-specific adapters."""

    name: str = "BaseAdapter"
    domains: list[str] = []

    @abstractmethod
    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        """
        Determines if this adapter has a specialized workflow for the given task and domain.

        Args:
            task: The user-facing task description.
            current_url: The URL currently loaded in the browser.
            target_site: The explicit target domain for this task (e.g. "youtube.com",
                         "instagram.com"). When provided, adapters MUST NOT claim
                         handling unless their own domain matches target_site.
                         This is the primary cross-task contamination guard.
        """
        pass

    @abstractmethod
    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        """
        Executes the specialized workflow.
        Must raise AdapterFallbackException if UI does not match expectations.
        """
        pass

    def _domain_matches_target(self, target_site: str | None) -> bool:
        """
        Returns True if this adapter's domains intersect with the given target_site.
        When target_site is None, domain constraint is not applied.
        """
        if target_site is None:
            return True
        for domain in self.domains:
            if domain in target_site or target_site in domain:
                return True
        return False

    def _task_mentions_other_site(self, task: str) -> bool:
        """
        Returns True if the task explicitly mentions another site that this
        adapter does NOT serve. Used to block cross-site keyword hijacking.
        """
        task_lower = task.lower()
        # Sites that are definitely NOT this adapter's domain
        other_sites: set[str] = set()
        all_known = {"youtube.com", "instagram.com", "gmail.com", "linkedin.com", "whatsapp.com"}
        for domain in self.domains:
            other_sites = all_known - {domain}

        for site in other_sites:
            short = site.split(".")[0]  # e.g. "youtube", "instagram"
            if short in task_lower or site in task_lower:
                return True
        return False
