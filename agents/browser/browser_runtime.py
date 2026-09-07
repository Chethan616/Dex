"""Lazy, persistent browser runtime lifecycle for DEX."""
from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from browser_manager import BrowserManager

log = logging.getLogger("BrowserRuntimeManager")


class RuntimeState(StrEnum):
    STOPPED = "STOPPED"
    STARTING = "STARTING"
    READY = "READY"
    BUSY = "BUSY"
    IDLE = "IDLE"
    STOPPING = "STOPPING"


class BrowserRuntimeManager:
    """Own lifecycle transitions without starting a browser at server startup."""

    def __init__(self, manager: BrowserManager):
        self.manager = manager
        self.state = RuntimeState.STOPPED
        self.current_task_id: str | None = None
        self.current_step_id: str | None = None

    async def ensure_running(self, mode_hint: str | None = None) -> BrowserManager:
        if self.manager.session.is_connected:
            if self.state in (RuntimeState.STOPPED, RuntimeState.IDLE):
                self.state = RuntimeState.READY
            log.info("BROWSER_RUNTIME_REUSE state=%s mode=%s", self.state, mode_hint or "MODE_A_PERSISTENT")
            return self.manager

        self.state = RuntimeState.STARTING
        log.info("BROWSER_RUNTIME_START mode=%s", mode_hint or "MODE_A_PERSISTENT")
        try:
            await self.manager.initialize(mode_hint=mode_hint)
        except Exception:
            self.state = RuntimeState.STOPPED
            raise
        self.state = RuntimeState.READY
        return self.manager

    async def run_task(self, *, mode_hint: str | None = None, **kwargs: Any) -> dict[str, Any]:
        await self.ensure_running(mode_hint=mode_hint)
        self.state = RuntimeState.BUSY
        self.current_task_id = kwargs.get("task_id")
        self.current_step_id = kwargs.get("step_id")
        try:
            return await self.manager.runner.run_task(**kwargs)
        finally:
            self.state = RuntimeState.IDLE if self.manager.session.is_connected else RuntimeState.STOPPED
            log.info("BROWSER_RUNTIME_IDLE task_id=%s state=%s", self.current_task_id, self.state)

    async def close(self) -> None:
        if self.state == RuntimeState.STOPPED and not self.manager.session.is_connected:
            return
        self.state = RuntimeState.STOPPING
        log.info("BROWSER_RUNTIME_STOP")
        await self.manager.close()
        self.state = RuntimeState.STOPPED

    async def diagnostics(self) -> dict[str, Any]:
        result = await self.manager.get_diagnostics()
        result.update({
            "runtime_state": self.state.value,
            "current_task_id": self.current_task_id or result.get("current_task_id"),
            "current_step_id": self.current_step_id or result.get("current_step_id"),
        })
        return result
