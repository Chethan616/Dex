# Changelog

Repo: https://github.com/Chethan616/Dex

## 2026.6.20 (Phase E.3 — canvas detection hook in browser-control)

### Changes

- `dex/drivers/browser-control/canvas_detection.py` ships the
  heuristic canvas-detection layer. Known canvas-heavy domains
  (Figma, Miro, Canva, Lucidchart, Excalidraw, Draw.io, Whimsical,
  Mural, Tableau, Looker Studio, Google Maps, agar.io, krunker.io,
  shellshock.io, skribbl.io) are matched against the `url_hint`
  before browser-use's Agent is constructed.
- When the target URL matches, a hint is prepended to the task:
  *"[Dex canvas hint] The target page is a known canvas-heavy site
  (<host>). Standard DOM selectors will not work for the main
  drawing area. Use vision to read the screenshot and click via
  pixel coordinates via page.mouse.click(x, y). Save a step by
  skipping the initial DOM-selector probe."* The hint reaches
  browser-use's LLM on every step without needing per-step hooks.
- 29 new pytest cases in `test_canvas_detection.py` covering known
  domains, sub-domain match, non-canvas URLs, invalid URLs,
  registry hygiene (no leading www, no trailing slash, all
  lowercase).

### Deferred to Phase E follow-up (when OmniParser MCP is installed)

- Playwright-based DOM scan that confirms canvas dominance on the
  LIVE page (a canvas covering >60% of viewport OR a giant
  no-descendant `<div>`). Today's heuristic catches the known sites;
  this catches custom in-house canvas apps too.
- OmniParser pre-parse of the canvas: when the hint fires, also call
  the omniparser MCP's `parse_screen` tool and inject the structured
  element list (bbox, label, type) into browser-use's prompt. Saves
  the LLM's vision pass and gives it concrete click coordinates.
