"""
BrowserManager: Central coordinator for DEX Browser Automation.

Encapsulates:
- SessionManager (persistent user profile, CDP attachment, locking, crash recovery)
- TabManager (multi-tab operations, popups, dialogs)
- Navigation (URL loading, history, waiting)
- Inspector (smart accessibility & DOM inspection, temporary element references e1, e2...)
- Interaction (semantic actions, downloads, uploads, safety protections)
- ActionVerifier (live DOM verification, risk classification)
- VisualFallback (screenshots, coordinate fallback)
- Recovery (overlays, login walls, CAPTCHAs)
- AdapterRegistry (domain adapters for Instagram, Gmail, YouTube, LinkedIn, WhatsApp)
- AgentRunner (5-tier autonomous execution)
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any
from playwright.async_api import BrowserContext, Page

from adapters.registry import AdapterRegistry
from agent_runner import AgentRunner
from browser_state import BrowserArtifact, BrowserState
from inspector import Inspector
from interaction import Interaction
from navigation import Navigation
from recovery import Recovery
from session_manager import SessionManager
from tab_manager import TabManager
from verification import ActionVerifier
from visual_fallback import VisualFallback

log = logging.getLogger("BrowserManager")


class BrowserManager:
    def __init__(
        self,
        cdp_port: int = 9222,
        profile_dir: Path | None = None,
        headless: bool | None = None,
    ):
        self.session = SessionManager(cdp_port=cdp_port, profile_dir=profile_dir, headless=headless)
        self.tabs = TabManager(lambda: self.session.context)
        self.navigation = Navigation(self.get_active_page)
        self.inspector = Inspector(self.get_active_page)
        self.interaction = Interaction(self.get_active_page, self.inspector)
        self.verifier = ActionVerifier(self.get_active_page)
        self.visual = VisualFallback(self.get_active_page)
        self.recovery = Recovery(self.get_active_page, verifier_getter=lambda: self.verifier)

        self.adapters = AdapterRegistry()
        self.runner = AgentRunner(self, self.adapters)

        # All artifacts for this session, keyed by task_id for isolation.
        self.artifacts: list[BrowserArtifact] = []
        self._current_task_id: str | None = None
        self._current_step_id: str | None = None
        self._last_action: str | None = None
        self._last_action_timestamp: float | None = None

    def set_current_task(self, task_id: str, step_id: str = "") -> None:
        """Bind the manager to a specific task/step context for artifact scoping."""
        if task_id != self._current_task_id:
            log.info(
                f"[TASK SCOPE] Switching task context: "
                f"{self._current_task_id or '(none)'} → {task_id}"
            )
        self._current_task_id = task_id
        self._current_step_id = step_id

    async def initialize(self, mode_hint: str | None = None) -> BrowserContext:
        """Initializes persistent browser session and attaches event listeners."""
        ctx = await self.session.initialize(mode_hint=mode_hint)
        self.tabs.attach_context_listeners(ctx)
        log.info("BrowserManager successfully initialized.")
        return ctx

    async def get_active_page(self, mode_hint: str | None = None) -> Page:
        """Ensures browser is running and returns the active page."""
        if not self.session.is_connected:
            await self.initialize(mode_hint=mode_hint)
        if self._current_task_id:
            return await self.tabs.get_task_page(self._current_task_id)
        return await self.tabs.get_active_page()

    def add_artifact(self, artifact: BrowserArtifact) -> None:
        """Registers a durable artifact produced by a browser action, tagged with current task_id."""
        # Stamp the artifact with the current task's identity.
        if self._current_task_id:
            artifact.task_id = self._current_task_id
        if self._current_step_id:
            artifact.step_id = self._current_step_id
        if not artifact.request_id:
            artifact.request_id = self._current_task_id or ""
        if not artifact.browser_profile:
            artifact.browser_profile = "user-attached" if self.session._is_cdp_attached else "DEX"
        if artifact.screenshot_path and not artifact.screenshot_source:
            artifact.screenshot_source = "browser_page"
        if artifact.screenshot_source == "desktop":
            raise ValueError("Browser artifacts cannot use desktop screenshots")
        self.artifacts.append(artifact)
        log.info(
            f"Registered browser artifact: [{artifact.kind}] '{artifact.name}' → {artifact.locator} "
            f"(task_id={artifact.task_id or 'unscoped'})"
        )

    def get_task_artifacts(self, task_id: str) -> list[BrowserArtifact]:
        """Returns only artifacts belonging to the specified task_id."""
        return [a for a in self.artifacts if a.task_id == task_id]

    async def get_state(self) -> BrowserState:
        """Collects structured browser state for DEX system and memory."""
        is_conn = self.session.is_connected
        active_tab_id = None
        curr_url = "about:blank"
        page_title = ""
        domain = ""
        open_tabs_info = []

        if is_conn:
            try:
                open_tabs_info = await self.tabs.list_tabs()
                if open_tabs_info:
                    page = await self.get_active_page()
                    curr_url = page.url
                    page_title = await page.title()
                    if curr_url.startswith("http"):
                        from urllib.parse import urlparse
                        domain = urlparse(curr_url).netloc
                for t in open_tabs_info:
                    if t.is_active:
                        active_tab_id = t.tab_id
            except Exception as err:
                log.debug(f"Error gathering live state: {err}")

        # Assess authentication state
        auth_state = "unknown"
        if is_conn and open_tabs_info:
            wall = await self.recovery.detect_human_wall()
            if wall:
                auth_state = "login_required"
            elif domain and not any(w in curr_url for w in ["login", "signin", "auth"]):
                auth_state = "authenticated"

        return BrowserState(
            session_id=self.session.session_id,
            profile_path=str(self.session.profile_dir),
            is_connected=is_conn,
            active_tab_id=active_tab_id,
            current_url=curr_url,
            current_domain=domain,
            page_title=page_title,
            open_tabs=open_tabs_info,
            authentication_state=auth_state,
            last_action=self._last_action,
            last_action_timestamp=self._last_action_timestamp,
            artifacts=self.artifacts[-20:],
        )

    async def get_diagnostics(self) -> dict[str, Any]:
        """
        Returns detailed diagnostics for debugging browser mode and task state.
        Implements Requirement 14 (visible browser-mode indicator).
        """
        is_conn = self.session.is_connected
        curr_url = "about:blank"
        page_title = ""
        all_urls: list[str] = []
        pages_metadata: list[dict[str, Any]] = []
        session_id = self.session.session_id

        if is_conn:
            try:
                tabs = await self.tabs.list_tabs()
                all_urls = [t.url for t in tabs]
                pages_metadata = [
                    {"tab_id": t.tab_id, "url": t.url, "title": t.title, "active": t.is_active}
                    for t in tabs
                ]
                if tabs:
                    page = await self.get_active_page()
                    curr_url = page.url
                    page_title = await page.title()
            except Exception as err:
                log.debug(f"Diagnostics page read error: {err}")

        browser_mode = "MODE_B_USER_ATTACHED" if self.session._is_cdp_attached else "MODE_A_PERSISTENT"

        return {
            "browser_mode": browser_mode,
            "attached_to_user_browser": self.session._is_cdp_attached,
            "browser_session_id": session_id,
            "browser_connected": is_conn,
            "profile_directory": str(self.session.profile_dir),
            "profile_name": self.session.profile_name,
            "executable": self.session.browser_path,
            "process_id": self.session._browser_process.pid if self.session._browser_process else None,
            "context_id": str(id(self.session._context)) if self.session._context else None,
            "browser_profile": "user-attached" if self.session._is_cdp_attached else "DEX",
            "connected_via": "cdp" if self.session._is_cdp_attached else ("playwright" if is_conn else None),
            "headless": self.session.headless,
            "visible_window": bool(is_conn and not self.session.headless),
            "current_url": curr_url,
            "current_title": page_title,
            "all_tab_urls": all_urls,
            "pages": pages_metadata,
            "auth_metadata": {"state": "unknown", "secrets_included": False},
            "current_task_id": self._current_task_id,
            "current_step_id": self._current_step_id,
            "total_artifacts": len(self.artifacts),
            "task_artifact_counts": _count_by_task(self.artifacts),
            "timestamp": time.time(),
        }

    async def close(self) -> None:
        """Graceful shutdown of browser resources."""
        await self.session.close()


def _count_by_task(artifacts: list[BrowserArtifact]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for a in artifacts:
        key = a.task_id or "unscoped"
        counts[key] = counts.get(key, 0) + 1
    return counts
