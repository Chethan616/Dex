from __future__ import annotations

from typing import Any

from helpers.extension import Extension


_COMPUTER_USE_PROMPT = "agent.system.tool.computer_use_remote.md"
_COMPUTER_USE_TOOL_MARKER = '"tool_name": "computer_use_remote"'


class IncludeRemoteToolStubs(Extension):
    def execute(self, data: dict[str, Any] = {}, **kwargs: Any) -> None:
        if self.agent is None:
            return
        if not isinstance(data, dict):
            return
        result = data.get("result")
        if not isinstance(result, str):
            return
        if _COMPUTER_USE_TOOL_MARKER in result:
            return

        try:
            prompt = self.agent.read_prompt(_COMPUTER_USE_PROMPT).strip()
        except Exception:
            return
        if not prompt:
            return

        data["result"] = f"{result.rstrip()}\n\n{prompt}"
