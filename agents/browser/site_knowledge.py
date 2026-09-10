"""
SiteKnowledge: declarative per-site facts the generic browser loop uses to
identify page types, extract entities, and verify exact targets.

Before this, `agent_runner.py`'s task-completion check branched on
`is_ig_task`/`is_yt_task` and called two different, hand-written verification
methods (`verify_instagram_post` and a `verify_youtube_video` that did not
actually exist on `ActionVerifier` — any YouTube task reaching that branch
crashed). This module holds the facts that made each of those branches
different, so `ActionVerifier.verify_site` in verification.py can do the same
job once, generically, driven by a `site_id` lookup instead of an if/elif
chain.

Entity extraction stays a callable per site rather than a second, parallel
regex list here: `extract_instagram_account` in adapters/instagram_adapter.py
is the tuned, already-tested cascade for Instagram, and duplicating its
patterns into a declarative list here would just be a second copy that can
drift from the first. What's declarative is which extractor a site uses, the
page-type URL/id patterns, and what "verified" requires for that page type —
the parts that were actually hardcoded per site in verification.py before.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class PageTypeRule:
    """How to recognise a page type (e.g. "post", "video") from the URL or an open dialog."""
    url_contains: list[str] = field(default_factory=list)
    id_regex: str | None = None
    dialog_container_selector: str | None = None
    dialog_link_selector: str | None = None
    # Words in the task text that mean "this task wants a specific item of
    # this page type" (vs. e.g. just "open instagram", which shouldn't
    # trigger strict target verification at all).
    keywords: list[str] = field(default_factory=list)


@dataclass
class VerificationSpec:
    """What "verified" requires once a page type is confirmed open."""
    container_selector: str = "main"
    author_selector_template: str | None = None  # "{entity}" is substituted in
    media_selectors: list[str] = field(default_factory=list)
    min_media_w: int = 100
    min_media_h: int = 100
    login_wall_url_contains: list[str] = field(default_factory=list)
    player_selector: str | None = None  # presence-only check (e.g. a video player)


@dataclass
class LoginCheckSpec:
    auth_phrases: list[str] = field(default_factory=list)
    close_selectors: list[str] = field(default_factory=list)


@dataclass
class SiteKnowledge:
    site_id: str
    domains: list[str]
    keyword_triggers: list[str]
    entity_extractor: Callable[[str, "str | None"], "str | None"] | None = None
    page_types: dict[str, PageTypeRule] = field(default_factory=dict)
    verification_rules: dict[str, VerificationSpec] = field(default_factory=dict)
    login_check: LoginCheckSpec | None = None


def _extract_instagram_entity(task: str, expected_entity: str | None = None) -> str | None:
    # Imported lazily to avoid a circular import: instagram_adapter imports
    # verification.py, and verification.py imports this module.
    from adapters.instagram_adapter import extract_instagram_account
    return extract_instagram_account(task, expected_entity)


def _extract_youtube_channel(task: str, expected_entity: str | None = None) -> str | None:
    """Same cascade as YouTubeAdapter._extract_channel, usable from the generic loop."""
    if expected_entity:
        return expected_entity
    import re
    patterns = [
        r"official\s+([a-zA-Z0-9\s._-]+?)\s+(?:account|channel|page)",
        r"([a-zA-Z0-9\s._-]+?)\s+(?:official\s+)?(?:account|channel|page)",
        r"([a-zA-Z0-9\s._-]+?)'s\s+(?:latest|channel|video)",
        r"(?:from|of)\s+([a-zA-Z0-9\s._-]+?)(?:\s+on|\s+in|\s*$)",
    ]
    for pat in patterns:
        m = re.search(pat, task, re.IGNORECASE)
        if m:
            name = m.group(1).strip().rstrip("'s").strip()
            if name.lower() not in {"the", "a", "an", "my", "their", "his", "her", "find", "open", "youtube"}:
                return name
    return None


# Migrated verbatim from ActionVerifier.detect_auth_or_signup_modal in
# verification.py, which previously hardcoded these as Instagram-only.
_INSTAGRAM_AUTH_PHRASES = [
    "see photos, videos and more",
    "see photos and videos from",
    "log in to see photos",
    "log in to instagram",
    "sign up to see photos",
    "don't have an account? sign up",
    "create an account",
    "join instagram",
    "log in or sign up",
    "log in to continue",
    "sign up to continue",
    "never miss a post",
    "stay in the loop",
    "sign up for instagram to stay in the loop",
    "sign up to see photos and videos",
]

_INSTAGRAM_CLOSE_SELECTORS = [
    '[aria-label="Close"]',
    'svg[aria-label="Close"]',
    'button [aria-label="Close"]',
    'button[aria-label="Close"]',
    '[title="Close"]',
    'button:has-text("✕")',
    'button:has-text("Close")',
    'button svg[aria-label="Close"]',
]


SITE_KNOWLEDGE: dict[str, SiteKnowledge] = {
    "instagram": SiteKnowledge(
        site_id="instagram",
        domains=["instagram.com"],
        keyword_triggers=["instagram", "insta"],
        entity_extractor=_extract_instagram_entity,
        page_types={
            "post": PageTypeRule(
                url_contains=["/p/", "/reel/"],
                id_regex=r"/(?:p|reel)/([a-zA-Z0-9_-]+)",
                dialog_container_selector='div[role="dialog"]:has(article), div[aria-modal="true"]:has(article)',
                dialog_link_selector='a[href*="/p/"], a[href*="/reel/"]',
                keywords=["post", "reel", "video", "latest", "photo"],
            ),
        },
        verification_rules={
            "post": VerificationSpec(
                container_selector='div[role="dialog"] article, main article, article',
                author_selector_template=(
                    'header a[href*="/{entity}/"], a[href*="/{entity}/"], '
                    'header :has-text("{entity}"), span:has-text("{entity}")'
                ),
                media_selectors=[
                    'div[role="dialog"] article img',
                    'main article img',
                    'article img[style*="object-fit"]',
                    'article img',
                    'main img',
                    'div[role="dialog"] video',
                    'main video',
                    'article video',
                    'video',
                    'img[srcset*="cdninstagram"]',
                    'img[src*="cdninstagram"]',
                ],
                login_wall_url_contains=["accounts/login"],
            ),
        },
        login_check=LoginCheckSpec(
            auth_phrases=_INSTAGRAM_AUTH_PHRASES,
            close_selectors=_INSTAGRAM_CLOSE_SELECTORS,
        ),
    ),
    "youtube": SiteKnowledge(
        site_id="youtube",
        domains=["youtube.com"],
        keyword_triggers=["youtube"],
        entity_extractor=_extract_youtube_channel,
        page_types={
            "video": PageTypeRule(
                url_contains=["/watch"],
                id_regex=r"[?&]v=([a-zA-Z0-9_-]{11})",
                keywords=["video", "latest", "watch", "play"],
            ),
        },
        verification_rules={
            "video": VerificationSpec(
                container_selector="ytd-watch-flexy, #below, body",
                author_selector_template=(
                    'ytd-channel-name:has-text("{entity}"), #channel-name:has-text("{entity}"), '
                    'a[href*="/@{entity}"], a[href*="/{entity}"]'
                ),
                media_selectors=[],  # presence checked via player_selector, not an <img>/<video> size
                player_selector="ytd-watch-flexy, video.html5-main-video, #movie_player",
            ),
        },
        login_check=None,
    ),
    "gmail": SiteKnowledge(
        site_id="gmail", domains=["mail.google.com", "gmail.com"], keyword_triggers=["gmail", "mail.google"],
    ),
    "linkedin": SiteKnowledge(
        site_id="linkedin", domains=["linkedin.com"], keyword_triggers=["linkedin"],
    ),
    "whatsapp": SiteKnowledge(
        site_id="whatsapp", domains=["web.whatsapp.com"], keyword_triggers=["whatsapp"],
    ),
}


def detect_site(task: str, target_site_hint: str | None = None) -> SiteKnowledge | None:
    """The SiteKnowledge for a task, by explicit target_site hint first, then by keyword."""
    hint = (target_site_hint or "").lower()
    if hint:
        for site in SITE_KNOWLEDGE.values():
            if any(domain in hint for domain in site.domains):
                return site
    t = task.lower()
    for site in SITE_KNOWLEDGE.values():
        if any(keyword in t for keyword in site.keyword_triggers):
            return site
    return None
