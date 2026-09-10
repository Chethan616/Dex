"""
Which LLM provider a Python agent process should use, read the same way the
TypeScript core reads it — one non-secret setting, not a second config
channel per process.

Originally lived only in agents/browser/agent_runner.py as
_configured_browser_provider; promoted here once agents/desktop/agent_loop.py
needed the identical selection logic for its own Worker. Behavior is
unchanged, just no longer duplicated.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def configured_provider() -> str:
    """
    'groq', 'claude-code', or '' (caller decides its own default/fallback).

    Checked in order: DEX_BRAIN_PROVIDER env var, then settings.json's
    brainProvider, then — only if neither named a provider explicitly —
    'groq' if a Groq key is actually present.
    """
    configured = os.environ.get("DEX_BRAIN_PROVIDER", "").strip().lower()
    if not configured:
        settings_path = (
            Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
            / "DEX" / "settings.json"
        )
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            configured = str(settings.get("brainProvider", "")).strip().lower()
        except (OSError, ValueError, TypeError):
            configured = ""
    if configured in {"groq", "claude-code"}:
        return configured
    if os.environ.get("GROQ_API_KEY", "").strip():
        return "groq"
    return ""
