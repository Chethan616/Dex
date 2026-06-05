"""OmniParser ONNX inference + lazy weight download.

Phase C.5 scaffold. Two responsibilities:

1. **Lazy weight download**: the v2 ONNX model is ~2 GB. We don't
   bundle it; on first ``parse_screen()`` we download from a configured
   URL (default: the upstream Microsoft release on Hugging Face) into
   ``~/.dex/models/omniparser/`` and cache there.

2. **Inference**: load the ONNX session once per process, run YOLO-style
   detection over a screenshot, return a list of
   ``{bbox, label, type, confidence}`` for the gateway to consume.

The class is a singleton per (weights_dir, model_version) so concurrent
``parse_screen`` calls share one ONNX session.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOG = logging.getLogger("dex.omniparser.inference")

# OmniParser v2 ONNX weight URL. Override with DEX_OMNIPARSER_WEIGHTS_URL
# when self-hosting (e.g. on an internal mirror).
DEFAULT_WEIGHTS_URL = os.environ.get(
    "DEX_OMNIPARSER_WEIGHTS_URL",
    "https://huggingface.co/microsoft/OmniParser-v2.0/resolve/main/icon_detect/model.onnx",
)
DEFAULT_WEIGHTS_FILENAME = "model.onnx"
DEFAULT_MODEL_VERSION = "omniparser-v2"


@dataclass
class ElementDetection:
    """One interactive UI element detected on the screen."""

    bbox: tuple[int, int, int, int]  # x, y, w, h
    label: str
    type: str
    confidence: float


@dataclass
class ParseResult:
    elements: list[dict[str, Any]]
    image_path: Path
    model_version: str
    duration_ms: int
    cached_weights: bool


class OmniParserInference:
    """Singleton-per-(weights_dir, version) ONNX wrapper.

    Usage:

        parser = OmniParserInference.get(weights_dir=Path("~/.dex/models/omniparser"))
        result = parser.parse(image_path=None)  # auto-capture
    """

    _instances: dict[tuple[Path, str], "OmniParserInference"] = {}

    @classmethod
    def get(
        cls,
        weights_dir: Path,
        version: str = DEFAULT_MODEL_VERSION,
    ) -> "OmniParserInference":
        key = (weights_dir.resolve(), version)
        existing = cls._instances.get(key)
        if existing is not None:
            return existing
        new = cls(weights_dir=weights_dir, version=version)
        cls._instances[key] = new
        return new

    def __init__(self, *, weights_dir: Path, version: str) -> None:
        self._weights_dir = weights_dir
        self._version = version
        self._session: Any = None
        self._weights_path: Path | None = None
        self._weights_were_cached: bool = False

    # ---- public API ---------------------------------------------------------

    def parse(
        self,
        image_path: str | None,
        region: tuple[int, int, int, int] | None,
        max_elements: int,
        timeout_s: int,
    ) -> ParseResult:
        start_ms = _now_ms()
        self._ensure_weights()
        self._ensure_session()
        captured_path = self._capture_or_use(image_path, region)

        # TODO(C.5.b): wire the actual ONNX preprocess + run + postprocess
        # pipeline. For now we surface a stub so the orchestrator's
        # adapter can be smoke-tested end-to-end without a 2 GB download.
        # When wired, this returns the real YOLO outputs converted to
        # the ElementDetection schema.
        elements: list[dict[str, Any]] = []
        if self._session is None or os.environ.get("DEX_OMNIPARSER_STUB") == "1":
            LOG.info("omniparser: stub mode; returning empty elements")
        else:
            LOG.warning(
                "omniparser: inference path not wired yet; returning empty elements. "
                "Track in dex/core/src/orchestration/README.md C.5 follow-up.",
            )

        duration_ms = max(1, _now_ms() - start_ms)
        return ParseResult(
            elements=elements[:max_elements],
            image_path=captured_path,
            model_version=self._version,
            duration_ms=duration_ms,
            cached_weights=self._weights_were_cached,
        )

    # ---- weights handling ---------------------------------------------------

    def _ensure_weights(self) -> None:
        if self._weights_path is not None:
            return
        target = self._weights_dir / DEFAULT_WEIGHTS_FILENAME
        if target.exists() and target.stat().st_size > 0:
            self._weights_path = target
            self._weights_were_cached = True
            LOG.info("omniparser: weights cached at %s", target)
            return
        LOG.info("omniparser: downloading weights from %s", DEFAULT_WEIGHTS_URL)
        self._weights_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=self._weights_dir,
            delete=False,
            prefix="model-",
            suffix=".onnx.partial",
        ) as tmp:
            tmp_path = Path(tmp.name)
        try:
            with urllib.request.urlopen(DEFAULT_WEIGHTS_URL) as response, tmp_path.open("wb") as out:
                shutil.copyfileobj(response, out, length=1024 * 1024)
            tmp_path.replace(target)
        except Exception:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
            raise
        self._weights_path = target
        self._weights_were_cached = False
        LOG.info("omniparser: weights downloaded to %s (sha256=%s)",
                 target, _sha256(target)[:12])

    def _ensure_session(self) -> None:
        if self._session is not None:
            return
        try:
            import onnxruntime  # noqa: PLC0415 - lazy heavy import
        except ImportError:
            LOG.warning(
                "omniparser: onnxruntime not installed; running in stub mode. "
                "Install: pip install onnxruntime (or onnxruntime-gpu for CUDA)",
            )
            return
        if self._weights_path is None:
            return
        providers = ["CPUExecutionProvider"]
        try:
            available = onnxruntime.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        except Exception:  # noqa: BLE001 - best-effort provider probe
            pass
        self._session = onnxruntime.InferenceSession(
            str(self._weights_path),
            providers=providers,
        )
        LOG.info("omniparser: ONNX session ready (providers=%s)", providers)

    # ---- screen capture -----------------------------------------------------

    def _capture_or_use(
        self,
        image_path: str | None,
        region: tuple[int, int, int, int] | None,
    ) -> Path:
        if image_path:
            return Path(image_path).expanduser().resolve()
        try:
            import mss  # noqa: PLC0415 - lazy heavy import
        except ImportError as exc:
            raise RuntimeError(
                "omniparser: image_path is None but mss is not installed. "
                "Either install mss (`pip install mss`) so OmniParser can "
                "capture the active screen, or pass an explicit image_path."
            ) from exc
        out = (
            self._weights_dir
            / "captures"
            / f"capture-{int(time.time() * 1000)}.png"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        with mss.mss() as sct:
            if region is not None:
                x, y, w, h = region
                monitor = {"left": x, "top": y, "width": w, "height": h}
                shot = sct.grab(monitor)
            else:
                shot = sct.grab(sct.monitors[1])  # primary monitor
            try:
                from mss.tools import to_png  # noqa: PLC0415

                with out.open("wb") as fh:
                    fh.write(to_png(shot.rgb, shot.size))
            except Exception:
                # to_png import path differs slightly between mss versions; fall back.
                from PIL import Image  # noqa: PLC0415 - only used in the fallback

                Image.frombytes("RGB", shot.size, shot.rgb).save(out)
        return out


def _now_ms() -> int:
    return int(time.perf_counter() * 1000)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
