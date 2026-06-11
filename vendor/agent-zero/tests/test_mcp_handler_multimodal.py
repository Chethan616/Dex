from __future__ import annotations

import asyncio
import base64
import importlib
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@dataclass
class _StubResponse:
    message: str
    break_loop: bool
    additional: dict | None = None


class _StubTool:
    def __init__(
        self,
        agent=None,
        name="",
        method=None,
        args=None,
        message="",
        loop_data=None,
        **kwargs,
    ):
        self.agent = agent
        self.name = name
        self.method = method
        self.args = args or {}
        self.message = message
        self.loop_data = loop_data
        self.log = None

    def nice_key(self, key: str) -> str:
        return key


class _FakeContent(SimpleNamespace):
    pass


class _FakeCallToolResult(SimpleNamespace):
    pass


@pytest.fixture
def mcp_handler_module(monkeypatch, tmp_path):
    monkeypatch.delitem(sys.modules, "helpers.mcp_handler", raising=False)

    agent_module = ModuleType("agent")
    agent_module.AgentContext = type("AgentContext", (), {})
    agent_module.Agent = type("Agent", (), {})
    agent_module.LoopData = type("LoopData", (), {})
    monkeypatch.setitem(sys.modules, "agent", agent_module)

    tool_module = ModuleType("helpers.tool")
    tool_module.Response = _StubResponse
    tool_module.Tool = _StubTool
    monkeypatch.setitem(sys.modules, "helpers.tool", tool_module)

    settings_module = ModuleType("helpers.settings")
    monkeypatch.setitem(sys.modules, "helpers.settings", settings_module)

    history_module = ModuleType("helpers.history")
    history_module.RawMessage = lambda **kwargs: dict(kwargs)
    monkeypatch.setitem(sys.modules, "helpers.history", history_module)

    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = type("ClientSession", (), {})
    mcp_module.StdioServerParameters = type("StdioServerParameters", (), {})
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)

    mcp_client_stdio = ModuleType("mcp.client.stdio")
    mcp_client_stdio.stdio_client = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", mcp_client_stdio)

    mcp_client_sse = ModuleType("mcp.client.sse")
    mcp_client_sse.sse_client = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, "mcp.client.sse", mcp_client_sse)

    mcp_client_streamable_http = ModuleType("mcp.client.streamable_http")
    mcp_client_streamable_http.streamablehttp_client = lambda *args, **kwargs: None
    monkeypatch.setitem(
        sys.modules,
        "mcp.client.streamable_http",
        mcp_client_streamable_http,
    )

    mcp_shared_message = ModuleType("mcp.shared.message")
    mcp_shared_message.SessionMessage = type("SessionMessage", (), {})
    monkeypatch.setitem(sys.modules, "mcp.shared.message", mcp_shared_message)

    mcp_types = ModuleType("mcp.types")
    mcp_types.CallToolResult = _FakeCallToolResult
    mcp_types.ListToolsResult = type("ListToolsResult", (), {})
    monkeypatch.setitem(sys.modules, "mcp.types", mcp_types)

    module = importlib.import_module("helpers.mcp_handler")

    class _SilentPrintStyle:
        def __init__(self, *args, **kwargs):
            pass

        def print(self, *args, **kwargs):
            return self

        def stream(self, *args, **kwargs):
            return self

    def _fake_get_abs_path(*parts):
        return str(tmp_path.joinpath(*parts))

    def _fake_normalize_a0_path(path: str) -> str:
        path_obj = Path(path)
        try:
            rel = path_obj.relative_to(tmp_path)
        except ValueError:
            return str(path_obj)
        return "/a0/" + str(rel).replace("\\", "/")

    monkeypatch.setattr(module, "PrintStyle", _SilentPrintStyle)
    monkeypatch.setattr(module.media_artifacts.files, "get_abs_path", _fake_get_abs_path)
    monkeypatch.setattr(module.media_artifacts.files, "normalize_a0_path", _fake_normalize_a0_path)
    return module, tmp_path


def _agent_recorder(context_id: str = "ctx-mcp"):
    tool_results: list[tuple[tuple, dict]] = []
    messages: list[tuple[tuple, dict]] = []
    updates: list[dict] = []
    warnings: list[dict] = []
    agent = SimpleNamespace(
        agent_name="Agent Zero",
        context=SimpleNamespace(
            id=context_id,
            log=SimpleNamespace(log=lambda **kwargs: warnings.append(kwargs)),
        ),
        hist_add_tool_result=lambda *args, **kwargs: tool_results.append((args, kwargs)),
        hist_add_message=lambda *args, **kwargs: messages.append((args, kwargs)),
    )
    log = SimpleNamespace(id="mcp-log", update=lambda **kwargs: updates.append(kwargs))
    return agent, log, tool_results, messages, updates, warnings


def test_mcp_image_content_becomes_history_image_attachment(mcp_handler_module, monkeypatch):
    module, _tmp_path = mcp_handler_module
    agent, log, tool_results, messages, updates, warnings = _agent_recorder()
    image_b64 = base64.b64encode(b"image-bytes").decode("ascii")
    result = _FakeCallToolResult(
        content=[_FakeContent(type="image", data=image_b64, mimeType="image/webp")],
        isError=False,
    )

    class _FakeConfig:
        async def call_tool(self, name, kwargs):
            return result

    monkeypatch.setattr(module.MCPConfig, "get_instance", lambda: _FakeConfig())

    tool = module.MCPTool(
        agent=agent,
        name="venice_image",
        method=None,
        args={},
        message="",
        loop_data=None,
    )
    tool.log = log

    response = asyncio.run(tool.execute())

    assert "[Tool returned no textual content]" not in response.message
    assert response.message == "MCP returned image attachment (image/webp, 11 bytes)."
    assert response.additional is not None
    data_url = response.additional["raw_content"][0]["image_url"]["url"]
    assert data_url == f"data:image/webp;base64,{image_b64}"

    asyncio.run(tool.after_execution(response))

    assert tool_results[0][0] == ("venice_image", response.message)
    raw_message = messages[0][1]["content"]
    assert raw_message["raw_content"][0]["image_url"]["url"] == data_url
    assert messages[0][1]["tokens"] == module.MCP_MEDIA_TOKENS_ESTIMATE
    assert updates[-1]["content"] == response.message
    assert warnings == []


def test_mcp_audio_content_is_saved_instead_of_discarded(mcp_handler_module, monkeypatch):
    module, tmp_path = mcp_handler_module
    agent, log, tool_results, messages, updates, warnings = _agent_recorder()
    audio_b64 = base64.b64encode(b"audio-bytes").decode("ascii")
    result = _FakeCallToolResult(
        content=[_FakeContent(type="audio", data=audio_b64, mimeType="audio/mpeg")],
        isError=False,
    )

    class _FakeConfig:
        async def call_tool(self, name, kwargs):
            return result

    monkeypatch.setattr(module.MCPConfig, "get_instance", lambda: _FakeConfig())

    tool = module.MCPTool(
        agent=agent,
        name="venice_audio",
        method=None,
        args={},
        message="",
        loop_data=None,
    )
    tool.log = log

    response = asyncio.run(tool.execute())

    assert response.additional is None
    assert "[Tool returned no textual content]" not in response.message
    assert "Saved MCP audio attachment (audio/mpeg, 11 bytes) to /a0/tmp/mcp/ctx_mcp/venice_audio/" in response.message
    saved_path = response.message.split(" to ", 1)[1].rstrip(".")
    assert (tmp_path / saved_path.removeprefix("/a0/")).exists()

    asyncio.run(tool.after_execution(response))

    assert tool_results[0][0] == ("venice_audio", response.message)
    assert messages == []
    assert updates[-1]["content"] == response.message
    assert warnings == []


def test_mcp_image_resource_blob_becomes_history_image_attachment(mcp_handler_module, monkeypatch):
    module, _tmp_path = mcp_handler_module
    agent, log, tool_results, messages, updates, warnings = _agent_recorder()
    image_b64 = base64.b64encode(b"resource-image").decode("ascii")
    result = _FakeCallToolResult(
        content=[
            _FakeContent(
                type="resource",
                resource=_FakeContent(
                    uri="memory://venice/image.webp",
                    mimeType="image/webp",
                    blob=image_b64,
                ),
            )
        ],
        isError=False,
    )

    class _FakeConfig:
        async def call_tool(self, name, kwargs):
            return result

    monkeypatch.setattr(module.MCPConfig, "get_instance", lambda: _FakeConfig())

    tool = module.MCPTool(
        agent=agent,
        name="venice_resource_image",
        method=None,
        args={},
        message="",
        loop_data=None,
    )
    tool.log = log

    response = asyncio.run(tool.execute())

    assert response.message == "MCP returned resource image attachment (image/webp, 14 bytes)."
    assert response.additional is not None
    data_url = response.additional["raw_content"][0]["image_url"]["url"]
    assert data_url == f"data:image/webp;base64,{image_b64}"

    asyncio.run(tool.after_execution(response))

    assert tool_results[0][0] == ("venice_resource_image", response.message)
    raw_message = messages[0][1]["content"]
    assert raw_message["raw_content"][0]["image_url"]["url"] == data_url
    assert updates[-1]["content"] == response.message
    assert warnings == []


def test_mcp_resource_text_is_preserved(mcp_handler_module, monkeypatch):
    module, _tmp_path = mcp_handler_module
    agent, log, tool_results, messages, updates, warnings = _agent_recorder()
    result = _FakeCallToolResult(
        content=[
            _FakeContent(
                type="resource",
                resource=_FakeContent(
                    uri="memory://venice/caption.txt",
                    mimeType="text/plain",
                    text="Generated caption text",
                ),
            )
        ],
        isError=False,
    )

    class _FakeConfig:
        async def call_tool(self, name, kwargs):
            return result

    monkeypatch.setattr(module.MCPConfig, "get_instance", lambda: _FakeConfig())

    tool = module.MCPTool(
        agent=agent,
        name="venice_resource",
        method=None,
        args={},
        message="",
        loop_data=None,
    )
    tool.log = log

    response = asyncio.run(tool.execute())

    assert response.additional is None
    assert "Resource memory://venice/caption.txt:" in response.message
    assert "Generated caption text" in response.message

    asyncio.run(tool.after_execution(response))

    assert tool_results[0][0] == ("venice_resource", response.message)
    assert messages == []
    assert updates[-1]["content"] == response.message
    assert warnings == []
