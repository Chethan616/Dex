"""Dex OmniParser MCP server.

Phase C.5 scaffold. Wraps Microsoft OmniParser (MIT) — a YOLO-style screen
parser that takes a screenshot and returns `[(bbox, label, type, ...)]`
for every interactive element. Useful when UFO² has no UIA tree to read
(games, custom-drawn UIs, Java Swing apps) and `browser-use` can't help
(the surface isn't a webpage).

Single MCP tool:
    parse_screen(image_path: str | None,
                 region: tuple[int, int, int, int] | None,
                 max_elements: int = 64)
    -> { "elements": [...], "image_path": str, "model_version": str }

If `image_path` is omitted, the server captures the active screen via
`mss`. If `region` is provided, only that rectangle is parsed.

The actual ONNX inference is in ``inference.py`` and is gated behind a
lazy import + weights download (~2 GB) on first invocation so the
server starts instantly even without weights present.

This server runs as a child of the Dex gateway over MCP stdio. The
orchestrator's TypeScript adapter at
``dex/core/src/orchestration/engines/omniparser.ts`` calls
``parse_screen`` whenever the capability scorer picks OmniParser as the
primary engine for a task (typically: game / Java Swing / pixel-only
custom UI, where UIA + DOM both miss).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover - install-time check
    raise SystemExit(
        "mcp not installed. Run: pip install -r dex/drivers/omniparser/requirements.txt"
    ) from exc

LOG = logging.getLogger("dex.omniparser")

DEFAULT_WEIGHTS_DIR = Path(
    os.environ.get(
        "DEX_OMNIPARSER_WEIGHTS_DIR",
        str(Path.home() / ".dex" / "models" / "omniparser"),
    )
)
DEFAULT_TIMEOUT_S = int(os.environ.get("DEX_OMNIPARSER_TIMEOUT_S", "30"))

mcp = FastMCP("dex-omniparser")


@mcp.tool()
def parse_screen(
    image_path: str | None = None,
    region: tuple[int, int, int, int] | None = None,
    max_elements: int = 64,
    timeout_s: int = DEFAULT_TIMEOUT_S,
) -> dict[str, Any]:
    """Parse a screenshot into interactive elements.

    Returns a dict with:
      elements      : list of {bbox: [x, y, w, h], label, type, confidence}
      image_path    : absolute path to the screenshot OmniParser saw
                      (useful for the gateway's action-preview card)
      model_version : str, e.g. "omniparser-v2"
      duration_ms   : int, wall-clock inference time
      cached_weights: bool, True iff weights were already on disk
    """
    from .inference import OmniParserInference  # lazy import: skip heavy deps on startup

    parser = OmniParserInference.get(weights_dir=DEFAULT_WEIGHTS_DIR)
    result = parser.parse(
        image_path=image_path,
        region=region,
        max_elements=max_elements,
        timeout_s=timeout_s,
    )
    return {
        "elements": result.elements,
        "image_path": str(result.image_path),
        "model_version": result.model_version,
        "duration_ms": result.duration_ms,
        "cached_weights": result.cached_weights,
    }


@mcp.tool()
def status() -> dict[str, Any]:
    """Health check the orchestration scorer + ``dex doctor`` consult.

    Returns:
      ready         : True iff weights are present + ONNX runtime imports cleanly
      weights_dir   : where weights are cached
      weights_bytes : total bytes on disk under weights_dir (0 if missing)
      torch_version : str or None when torch isn't installed
      onnx_version  : str or None
    """
    weights_dir = DEFAULT_WEIGHTS_DIR
    weights_bytes = 0
    if weights_dir.exists():
        for f in weights_dir.rglob("*"):
            if f.is_file():
                try:
                    weights_bytes += f.stat().st_size
                except OSError:
                    pass

    torch_version: str | None = None
    onnx_version: str | None = None
    try:
        import torch  # noqa: PLC0415 - local import keeps server start fast

        torch_version = torch.__version__
    except ImportError:
        pass
    try:
        import onnxruntime  # noqa: PLC0415 - local import keeps server start fast

        onnx_version = onnxruntime.__version__
    except ImportError:
        pass

    return {
        "ready": weights_bytes > 0 and onnx_version is not None,
        "weights_dir": str(weights_dir),
        "weights_bytes": weights_bytes,
        "torch_version": torch_version,
        "onnx_version": onnx_version,
    }


if __name__ == "__main__":  # pragma: no cover - launched by the gateway
    LOG.info("dex-omniparser MCP server starting; weights_dir=%s", DEFAULT_WEIGHTS_DIR)
    mcp.run()
