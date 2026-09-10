"""
Schema-conformance coverage for the desktop agent's three Worker providers
(Phase A of the vision-first migration): AnthropicWorker, GroqVisionWorker,
ClaudeCodeWorker must all satisfy the same `decide() -> WORKER_TOOL`-shaped
dict contract, so agent_loop.py's control flow never has to know which one
answered.

This intentionally does NOT test "did it pick the right button" — that's
Phase C's concern, once grounding+execution are wired to a real screen. This
only proves the three backends are interchangeable at the schema boundary,
with no real API calls (fully mocked).

Usage:
    python tests/test_desktop_worker_providers.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "desktop"))
sys.path.insert(0, str(ROOT / "agents" / "browser"))
sys.path.insert(0, str(ROOT / "agents"))

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  \x1b[32m✓\x1b[0m {name}")
    else:
        failed += 1
        print(f"  \x1b[31m✗\x1b[0m {name}" + (f" -- {detail}" if detail else ""))


FAKE_SCREENSHOT_B64 = "iVBORw0KGgo="  # content doesn't matter, never decoded by these mocks
REQUIRED_FIELDS = {"reasoning", "action_type"}
VALID_ACTION_TYPES = {
    "click", "double_click", "right_click", "type", "key", "scroll",
    "open_app", "done", "failed",
}


def is_worker_tool_shaped(result: dict) -> bool:
    if not isinstance(result, dict):
        return False
    if not REQUIRED_FIELDS.issubset(result.keys()):
        return False
    return result.get("action_type") in VALID_ACTION_TYPES


async def check_anthropic_worker() -> None:
    print("\n\x1b[1m1. AnthropicWorker\x1b[0m")
    from worker_providers import AnthropicWorker

    fake_block = MagicMock()
    fake_block.type = "tool_use"
    fake_block.input = {"reasoning": "The Save button is visible.", "action_type": "click", "target_description": "Save button"}
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("anthropic.Anthropic") as mock_anthropic:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic.return_value = mock_client

        worker = AnthropicWorker(api_key="fake-key")
        result = await worker.decide(FAKE_SCREENSHOT_B64, "Save the file", "")

    check("returns a WORKER_TOOL-shaped dict", is_worker_tool_shaped(result), str(result))
    check("name identifies the provider", worker.name.startswith("anthropic/"), worker.name)

    # No tool_use block at all -> a clean 'failed', not a crash.
    fake_response_empty = MagicMock()
    fake_response_empty.content = []
    with patch("anthropic.Anthropic") as mock_anthropic:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response_empty
        mock_anthropic.return_value = mock_client
        worker2 = AnthropicWorker(api_key="fake-key")
        result2 = await worker2.decide(FAKE_SCREENSHOT_B64, "Save the file", "")
    check("no tool_use block -> failed, not an exception", result2.get("action_type") == "failed", str(result2))


async def check_groq_vision_worker() -> None:
    print("\n\x1b[1m2. GroqVisionWorker\x1b[0m")
    from worker_providers import GroqVisionWorker

    fake_json = '{"reasoning": "Clicking Save.", "action_type": "click", "target_description": "Save button"}'
    fake_http_response = MagicMock()
    fake_http_response.status_code = 200
    fake_http_response.json.return_value = {"choices": [{"message": {"content": fake_json}}]}

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=fake_http_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        worker = GroqVisionWorker(api_key="fake-key")
        result = await worker.decide(FAKE_SCREENSHOT_B64, "Save the file", "")

    check("returns a WORKER_TOOL-shaped dict", is_worker_tool_shaped(result), str(result))
    check("name identifies the provider", worker.name.startswith("groq/"), worker.name)

    # A reply with a sentence wrapped around the JSON still parses.
    wrapped_json = 'Sure, here you go:\n' + fake_json + '\nHope that helps!'
    fake_http_response2 = MagicMock()
    fake_http_response2.status_code = 200
    fake_http_response2.json.return_value = {"choices": [{"message": {"content": wrapped_json}}]}
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=fake_http_response2)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        worker2 = GroqVisionWorker(api_key="fake-key")
        result2 = await worker2.decide(FAKE_SCREENSHOT_B64, "Save the file", "")
    check("tolerant of prose wrapped around the JSON", is_worker_tool_shaped(result2), str(result2))

    # An HTTP error -> a clean 'failed', not a crash.
    fake_error_response = MagicMock()
    fake_error_response.status_code = 429
    fake_error_response.text = "rate limited"
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=fake_error_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        worker3 = GroqVisionWorker(api_key="fake-key")
        result3 = await worker3.decide(FAKE_SCREENSHOT_B64, "Save the file", "")
    check("HTTP error -> failed, not an exception", result3.get("action_type") == "failed", str(result3))


async def check_claude_code_worker() -> None:
    print("\n\x1b[1m3. ClaudeCodeWorker\x1b[0m")
    from worker_providers import ClaudeCodeWorker

    fake_completion = MagicMock()
    fake_completion.content = {"reasoning": "Clicking Save.", "action_type": "click", "target_description": "Save button"}

    worker = ClaudeCodeWorker(mode="fast")
    with patch.object(worker._client, "ainvoke", new=AsyncMock(return_value=fake_completion)):
        result = await worker.decide(FAKE_SCREENSHOT_B64, "Save the file", "")

    check("returns a WORKER_TOOL-shaped dict", is_worker_tool_shaped(result), str(result))
    check("name identifies the provider", worker.name.startswith("claude-code/"), worker.name)

    # A non-dict content (parse failure inside ChatClaudeCode) -> clean 'failed'.
    fake_completion_bad = MagicMock()
    fake_completion_bad.content = "not a dict"
    with patch.object(worker._client, "ainvoke", new=AsyncMock(return_value=fake_completion_bad)):
        result2 = await worker.decide(FAKE_SCREENSHOT_B64, "Save the file", "")
    check("unparseable content -> failed, not an exception", result2.get("action_type") == "failed", str(result2))


async def run_tests() -> int:
    print("\n\x1b[1m=== Desktop Worker Providers Regression Suite ===\x1b[0m")
    await check_anthropic_worker()
    await check_groq_vision_worker()
    await check_claude_code_worker()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
