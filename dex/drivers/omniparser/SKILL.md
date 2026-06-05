---
id: dex-omniparser
title: OmniParser screen-parser (pixel-only UI)
when_to_use: "Use only when UFO² has no UIA tree to read (games, custom-drawn canvases, Java Swing, broken accessibility) AND the surface isn't a webpage that browser-control can drive."
when_not_to_use: "Do not use for native Windows apps with accessible UIA trees (run_desktop_task / UFO² is faster and cheaper). Do not use for browser content (run_browser_task / browser-use is faster and cheaper)."
---

# OmniParser — Dex's vision engine

OmniParser is a [Microsoft research model](https://github.com/microsoft/OmniParser) (MIT) that takes a screenshot and outputs `[(bbox, label, type)]` for every interactive UI element. Dex uses it as a **last-resort engine** when neither the UIA tree (UFO²) nor the browser DOM (browser-use) is available.

## When the orchestrator picks OmniParser

The capability scorer in `dex/core/src/orchestration/capability-scorer.ts` picks OmniParser when **all three** are true:

1. The active foreground process has `appFamily` of `game`, `media`, or `unknown`, OR the UIA probe returns `available: false`.
2. No browser DOM is reachable (`ctx.browser?.domAvailable !== true`).
3. The host is `visionCapable` (a real Windows desktop, not headless CI).

OmniParser's base scores in `BASE_SCORE_TABLE`:

| appFamily | OmniParser base |
|---|---|
| game | 0.92 (highest of any engine) |
| media | 0.70 |
| unknown | 0.60 |
| ide | 0.45 (UFO² usually wins; OmniParser is fallback) |
| office | 0.40 |
| browser | 0.30 (browser-use wins) |
| system | 0.30 (UFO² wins) |

## The single MCP tool

```python
parse_screen(
    image_path: str | None = None,        # auto-captures via mss if None
    region: tuple[int, int, int, int] | None = None,
    max_elements: int = 64,
    timeout_s: int = 30,
) -> {
    "elements": [{"bbox": [x, y, w, h], "label": "...", "type": "...", "confidence": 0.0..1.0}],
    "image_path": "absolute path to the screenshot",
    "model_version": "omniparser-v2",
    "duration_ms": 0,
    "cached_weights": True
}
```

Auxiliary tool for `dex doctor`:

```python
status() -> {ready, weights_dir, weights_bytes, torch_version, onnx_version}
```

## Setup

The Python venv is shared with the other Dex drivers under `dex/drivers/`. First-time installation is large (~2 GB for weights + ~400 MB for ONNX Runtime + CUDA libs if installed).

```powershell
py -3.11 -m venv D:\project1\vendor\omniparser\.venv
D:\project1\vendor\omniparser\.venv\Scripts\python.exe -m pip install -r D:\project1\dex\drivers\omniparser\requirements.txt
```

Weights download lazily on the first `parse_screen()` call into `~/.dex/models/omniparser/`. To preflight the download (e.g. for an offline laptop), set `DEX_OMNIPARSER_STUB=1` and call `parse_screen()` once, then unset and re-run.

## Cost profile

| Hardware | Cold start | Per-frame |
|---|---|---|
| CPU (Ryzen 7 / i7) | 2-4 s session load | 1-3 s inference |
| GPU (RTX 3060+) | 1-2 s session load + ~700 MB VRAM | 200-400 ms inference |

Dex's router will avoid OmniParser when the `RuntimeContext.budget.latencyMs` is tight (< 1 s) — it falls back to OpenClaw's shell or UFO² in those cases.

## Failure modes worth knowing

- **No weights + no network**: server logs `"omniparser: stub mode"` and `parse_screen()` returns an empty `elements` list. The router then falls through to the next engine in the chain.
- **No `onnxruntime`**: same stub behaviour.
- **`mss` missing + `image_path` is `None`**: raises `RuntimeError` — caller must either install `mss` or pass an explicit image path.
- **Region clipping**: invalid `region` tuples are silently clipped to the primary monitor's bounds.

## Privacy

Screenshots stay on the local machine. `~/.dex/models/omniparser/captures/` accumulates them for debugging; clean periodically with `dex doctor --fix` (TODO C.5 follow-up: add the cleanup pass to the doctor).
