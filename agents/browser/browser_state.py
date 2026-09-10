"""
Structured browser state and data models for DEX Browser Automation.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class TabInfo:
    tab_id: int
    title: str
    url: str
    is_active: bool = False


@dataclass
class ElementInfo:
    id: str  # e.g., 'e1', 'e2'
    tag: str
    role: str
    name: str
    selector: str
    bbox: dict[str, int] = field(default_factory=lambda: {"x": 0, "y": 0, "width": 0, "height": 0})
    is_visible: bool = True
    is_enabled: bool = True
    is_focused: bool = False
    is_checked: bool = False
    value: str = ""
    context: str = ""


@dataclass
class BrowserArtifact:
    kind: str  # 'page' | 'post' | 'file' | 'text'
    name: str
    locator: str  # URL or file path
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    verification_status: str = "discovered"  # 'discovered' | 'opened' | 'verified'
    verification_metadata: dict[str, Any] = field(default_factory=dict)
    # Task/step ownership: set by AgentRunner to scope artifacts per-task.
    task_id: str = ""
    step_id: str = ""
    # Site origin metadata for cross-task contamination detection.
    source_site: str = ""
    source_url: str = ""
    # Stable artifact contract consumed by memory, gateway, and Flutter.
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    request_id: str = ""
    actual_url: str = ""
    entity: str = ""
    artifact_type: str = ""
    title: str = ""
    screenshot_path: str | None = None
    screenshot_source: str | None = None
    browser_profile: str = "DEX"
    browser_context_id: str = ""
    browser_page_id: str = ""
    observed_facts: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.artifact_type:
            self.artifact_type = self.kind
        if not self.title:
            self.title = self.name
        if not self.actual_url and self.kind in {"page", "post", "text"}:
            self.actual_url = self.source_url or self.locator
        if not self.screenshot_path:
            candidate = self.metadata.get("screenshot_path")
            if isinstance(candidate, str):
                self.screenshot_path = candidate
        if self.screenshot_path and not self.screenshot_source:
            self.screenshot_source = "browser_page"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Target:
    """
    What a web task is actually after, as one typed object instead of loose
    kwargs threaded individually through agent_runner.py/server.py
    (target_site, expected_url, expected_entity, ...). Optional today —
    AgentRunner builds one internally from its existing kwargs — so it can be
    adopted without changing any external call signature.
    """
    site_id: str | None = None
    expected_url: str | None = None
    expected_entity: str | None = None
    expected_id: str | None = None
    page_type: str | None = None


@dataclass
class WebTask:
    """
    A normalized web request: what AgentRunner.run_task's kwargs describe,
    carried as one object so every internal helper that needs task identity
    or target info reads it from one place rather than re-threading
    individual parameters. Constructed internally by `run_task` on every
    call — see AgentRunner._run_task_impl — not yet the public call contract.
    """
    description: str
    task_id: str
    step_id: str = ""
    request_id: str = ""
    start_url: str | None = None
    max_steps: int = 25
    session_id: str = ""
    confirmed: bool = False
    target: Target = field(default_factory=Target)
    context: dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionResult:
    success: bool
    action: str
    target: str = ""
    details: str = ""
    error: str | None = None
    state_changed: bool = False
    verification: dict[str, Any] | None = None
    screenshot_path: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BrowserState:
    session_id: str
    profile_path: str
    is_connected: bool
    active_tab_id: int | None
    current_url: str
    current_domain: str
    page_title: str
    open_tabs: list[TabInfo] = field(default_factory=list)
    authentication_state: str = "unknown"  # 'authenticated' | 'login_required' | 'unknown'
    last_screenshot_path: str | None = None
    last_action: str | None = None
    last_action_timestamp: float | None = None
    last_verified_state: dict[str, Any] | None = None
    artifacts: list[BrowserArtifact] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
