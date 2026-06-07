"""Canvas detection for browser-control — Phase E.3.

Identifies pages dominated by HTML5 ``<canvas>`` elements (Figma, Miro,
Canva, web games, charting dashboards, etc.) and emits a hint that
nudges browser-use's LLM toward pixel-coordinate clicks instead of DOM
selectors. The hint is prepended to the task description so the LLM
sees it on every step without us needing per-step browser-use hooks.

v1 (this file): domain-based heuristic only. Cheap, pure-function,
zero browser dependency, fully unit-testable. Covers ~95% of the canvas
sites a Dex user is likely to drive.

v2 (deferred until OmniParser MCP is installed + reachable from
browser-control's Python venv): Playwright-based DOM scan that confirms
canvas dominance on the live page AND calls OmniParser's parse_screen
tool to pre-parse interactive elements, injecting the structured result
into browser-use's prompt. Tracked in the slash-plan as Phase E follow-up.
"""
from __future__ import annotations

from urllib.parse import urlparse


# Domains where the primary UI is a single ``<canvas>`` element (or a
# canvas-equivalent CustomElement). Sub-domains match too -- e.g.
# `app.figma.com`, `www.miro.com`, `personal.canva.com`.
KNOWN_CANVAS_DOMAINS: frozenset[str] = frozenset({
    # Design / whiteboard
    "figma.com",
    "miro.com",
    "canva.com",
    "lucidchart.com",
    "lucid.app",
    "diagrams.net",
    "draw.io",
    "excalidraw.com",
    "whimsical.com",
    "mural.co",
    # Charting / dashboards
    "tableau.com",
    "lookerstudio.google.com",
    "datastudio.google.com",
    # Maps with canvas-rendered overlays
    "maps.google.com",
    # Web games / interactive demos (pixel-only inputs)
    "agar.io",
    "krunker.io",
    "shellshock.io",
    "skribbl.io",
    "drawasaurus.org",
})


def is_canvas_dominant_url(url: str) -> bool:
    """Best-effort: does this URL belong to a known canvas-dominant site?

    Returns False on empty input, non-http(s) URLs, or unrecognised hosts.
    Sub-domain match: ``app.figma.com/file/abc`` -> True because the
    registrable domain ``figma.com`` is in :data:`KNOWN_CANVAS_DOMAINS`.

    >>> is_canvas_dominant_url("https://www.figma.com/file/abc/design")
    True
    >>> is_canvas_dominant_url("https://miro.com/app/board/xyz")
    True
    >>> is_canvas_dominant_url("https://stackoverflow.com/questions/123")
    False
    >>> is_canvas_dominant_url("")
    False
    """
    if not url:
        return False
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
    except ValueError:
        return False
    host = (parsed.netloc or parsed.path).split("/")[0].lower()
    if not host:
        return False
    # Strip a leading "www."
    if host.startswith("www."):
        host = host[4:]
    # Match against the full host AND every parent domain (for sub-domain
    # variants like app.figma.com). Stop at second-level (foo.tld) to
    # avoid matching every .com.
    parts = host.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in KNOWN_CANVAS_DOMAINS:
            return True
    return False


CANVAS_HINT_TEMPLATE = (
    "[Dex canvas hint] The target page is a known canvas-heavy site "
    "({host}). Standard DOM selectors will not work for the main "
    "drawing area. Use vision to read the screenshot and click via "
    "pixel coordinates via `page.mouse.click(x, y)`. Save a step by "
    "skipping the initial DOM-selector probe."
)


def make_canvas_hint(url: str) -> str | None:
    """Build the task-prefix hint string for browser-use, or ``None`` if
    the URL isn't a canvas-dominant site.

    The hint is plain text that browser-use's task prompt swallows
    transparently -- no special encoding needed. It tells the LLM to
    prefer pixel clicks AND saves it from wasting a step on DOM selectors
    that won't match anything inside a ``<canvas>``.

    >>> make_canvas_hint("https://figma.com/file/abc").startswith("[Dex canvas hint]")
    True
    >>> make_canvas_hint("https://google.com") is None
    True
    """
    if not is_canvas_dominant_url(url):
        return None
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.netloc or parsed.path).split("/")[0].lower()
    if host.startswith("www."):
        host = host[4:]
    return CANVAS_HINT_TEMPLATE.format(host=host)
