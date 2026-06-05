"""Unit tests for the Phase C.6 provider resolver in `server.py`.

Validates that ``_resolve_browser_llm()`` picks the right adapter and the
right API-key env var based on ``DEX_BROWSER_PROVIDER``. The tests stub
``browser_use`` in ``sys.modules`` so we don't need the real package
(Playwright, etc.) installed just to run them.

Run from the repo root with::

    py -3 -m pytest dex/drivers/browser-control/test_provider_resolver.py -q
"""
from __future__ import annotations

import importlib
import os
import sys
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
DRIVERS_ROOT = HERE.parent

# Drivers root must be on sys.path so `from _shared.approval import ...`
# resolves the same way it does when FastMCP runs server.py.
sys.path.insert(0, str(DRIVERS_ROOT))


def _stub_browser_use(monkeypatch: pytest.MonkeyPatch) -> dict[str, type]:
    """Inject a fake `browser_use` module so `_resolve_browser_llm` can
    import its adapters without us shipping the real (heavy) package in
    the test environment. Returns the stub adapter classes so tests can
    assert which one was picked."""

    class _StubLLM:
        provider_label = "stub"

        def __init__(self, model: str, api_key: str) -> None:
            self.model = model
            self.api_key = api_key

    class ChatGroq(_StubLLM):
        provider_label = "groq"

    class ChatGoogle(_StubLLM):
        provider_label = "google"

    class ChatAnthropic(_StubLLM):
        provider_label = "anthropic"

    class ChatOpenAI(_StubLLM):
        provider_label = "openai"

    fake = types.ModuleType("browser_use")
    fake.ChatGroq = ChatGroq  # type: ignore[attr-defined]
    fake.ChatGoogle = ChatGoogle  # type: ignore[attr-defined]
    fake.ChatAnthropic = ChatAnthropic  # type: ignore[attr-defined]
    fake.ChatOpenAI = ChatOpenAI  # type: ignore[attr-defined]
    fake.Agent = object  # type: ignore[attr-defined]
    fake.BrowserSession = object  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "browser_use", fake)
    return {
        "groq": ChatGroq,
        "google": ChatGoogle,
        "anthropic": ChatAnthropic,
        "openai": ChatOpenAI,
    }


def _reload_server(monkeypatch: pytest.MonkeyPatch, provider: str):
    """Reload `server` after setting DEX_BROWSER_PROVIDER so the module-level
    constants (BROWSER_PROVIDER) reflect the env var. The resolver reads
    those at function-call time, so we don't strictly need to reload --
    but doing so keeps each test hermetic."""

    monkeypatch.setenv("DEX_BROWSER_PROVIDER", provider)
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server")


def test_groq_uses_groq_adapter_and_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    adapters = _stub_browser_use(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.delenv("DEX_BROWSER_MODEL", raising=False)
    server = _reload_server(monkeypatch, "groq")

    llm = server._resolve_browser_llm()

    assert isinstance(llm, adapters["groq"])
    assert llm.api_key == "gsk_test"
    assert llm.model == "qwen/qwen3-32b"


def test_google_uses_chat_google_with_flash_lite_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapters = _stub_browser_use(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "AIza_test")
    monkeypatch.delenv("DEX_BROWSER_MODEL", raising=False)
    server = _reload_server(monkeypatch, "google")

    llm = server._resolve_browser_llm()

    assert isinstance(llm, adapters["google"])
    assert llm.api_key == "AIza_test"
    assert llm.model == "gemini-2.5-flash-lite"


def test_anthropic_uses_chat_anthropic_with_sonnet_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapters = _stub_browser_use(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.delenv("DEX_BROWSER_MODEL", raising=False)
    server = _reload_server(monkeypatch, "anthropic")

    llm = server._resolve_browser_llm()

    assert isinstance(llm, adapters["anthropic"])
    assert llm.model == "claude-sonnet-4-6"


def test_openai_uses_chat_openai_with_gpt5_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapters = _stub_browser_use(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("DEX_BROWSER_MODEL", raising=False)
    server = _reload_server(monkeypatch, "openai")

    llm = server._resolve_browser_llm()

    assert isinstance(llm, adapters["openai"])
    assert llm.model == "gpt-5"


def test_dex_browser_model_override_wins_over_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_browser_use(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "AIza_test")
    monkeypatch.setenv("DEX_BROWSER_MODEL", "gemini-2.5-pro")
    server = _reload_server(monkeypatch, "google")

    llm = server._resolve_browser_llm()

    assert llm.model == "gemini-2.5-pro"


def test_unknown_provider_raises_runtime_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_browser_use(monkeypatch)
    server = _reload_server(monkeypatch, "totally-fake-provider")

    with pytest.raises(RuntimeError, match="Unknown DEX_BROWSER_PROVIDER"):
        server._resolve_browser_llm()


def test_missing_api_key_raises_runtime_error_naming_the_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_browser_use(monkeypatch)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    server = _reload_server(monkeypatch, "google")

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        server._resolve_browser_llm()
