"""Unit tests for Phase E.3 canvas detection.

Pure-function tests; no Playwright / browser-use dependency required.

Run with:
    cd D:/project1
    .\\vendor\\UFO\\.venv\\Scripts\\python.exe -m pytest dex/drivers/browser-control/test_canvas_detection.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make this driver directory importable when pytest runs from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest

from canvas_detection import (  # noqa: E402
    CANVAS_HINT_TEMPLATE,
    KNOWN_CANVAS_DOMAINS,
    is_canvas_dominant_url,
    make_canvas_hint,
)


class TestIsCanvasDominantUrl:
    @pytest.mark.parametrize(
        "url",
        [
            "https://figma.com/file/abc/design",
            "https://www.figma.com/file/abc",
            "https://app.figma.com/recents",
            "https://miro.com/app/board/xyz",
            "https://canva.com/design/new",
            "https://excalidraw.com",
            "https://draw.io/?lightbox=1",
            "https://app.diagrams.net/",
            "https://lucid.app/lucidchart/abc/edit",
            "https://shellshock.io/",
            # Bare host without scheme should still work
            "figma.com/file/abc",
        ],
    )
    def test_known_canvas_domains_match(self, url: str) -> None:
        assert is_canvas_dominant_url(url) is True

    @pytest.mark.parametrize(
        "url",
        [
            "https://stackoverflow.com/questions/123",
            "https://github.com/Chethan616/Dex",
            "https://news.ycombinator.com",
            "https://en.wikipedia.org/wiki/Canvas",
            "https://docs.google.com/spreadsheets/d/abc",
            # Empty / nonsense
            "",
            "not-a-url",
            "file:///C:/Users/cheth/Desktop/note.txt",
            "javascript:void(0)",
        ],
    )
    def test_non_canvas_urls_dont_match(self, url: str) -> None:
        assert is_canvas_dominant_url(url) is False

    def test_subdomain_match_walks_up_to_registrable_domain_only(self) -> None:
        # Should match: registrable domain is figma.com
        assert is_canvas_dominant_url("https://anything.figma.com/x") is True
        # Should NOT match: "com" alone isn't a known canvas domain (and we
        # stop at second-level to avoid matching every .com).
        assert is_canvas_dominant_url("https://unknown-host.com") is False

    def test_invalid_url_returns_false_without_raising(self) -> None:
        # urlparse is permissive; we just need to verify no exception leaks.
        assert is_canvas_dominant_url("ht!tp://??##") is False


class TestMakeCanvasHint:
    def test_known_domain_returns_hint_string(self) -> None:
        hint = make_canvas_hint("https://figma.com/file/abc")
        assert hint is not None
        assert "Dex canvas hint" in hint
        assert "figma.com" in hint
        assert "pixel coordinates" in hint
        assert "page.mouse.click" in hint

    def test_unknown_domain_returns_none(self) -> None:
        assert make_canvas_hint("https://google.com") is None
        assert make_canvas_hint("") is None

    def test_subdomain_canonicalises_to_registrable_host(self) -> None:
        # Hint should mention the actual host the user sees, not the
        # registrable root. (Saves a confusing "site (figma.com)" when the
        # user typed app.figma.com.)
        hint = make_canvas_hint("https://app.figma.com/recents")
        assert hint is not None
        assert "app.figma.com" in hint

    def test_hint_template_constant_well_formed(self) -> None:
        # Sanity: the template uses the {host} placeholder once.
        assert CANVAS_HINT_TEMPLATE.count("{host}") == 1


class TestKnownCanvasDomainsRegistry:
    def test_no_leading_www(self) -> None:
        for d in KNOWN_CANVAS_DOMAINS:
            assert not d.startswith("www."), f"{d}: registry should NOT include www. prefix"

    def test_no_trailing_slash_or_scheme(self) -> None:
        for d in KNOWN_CANVAS_DOMAINS:
            assert "/" not in d, f"{d}: registry entries are bare hosts"
            assert "://" not in d, f"{d}: registry entries are bare hosts"

    def test_all_lowercase(self) -> None:
        for d in KNOWN_CANVAS_DOMAINS:
            assert d == d.lower(), f"{d}: registry entries are lowercased"
