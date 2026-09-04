"""
The deterministic web verbs, run in the browser the owner is signed into.

`primitives.py` implements navigate/click/type/extract against a Playwright
browser Dex launched. That browser is signed in to nothing, and `/primitive`
never asked which browser should answer — so every `navigate`, every
`read_page`, every `click` in every plan ran there, no matter what the task was.
The owner's report was "it doesn't open my chrome profile every time"; the truth
was that this tier never used it at all.

This module is the same verbs against the attached extension. Nothing here
launches or copies anything: it is a translation from Dex's vocabulary
(selectors, ordinal text) to the extension's (element ids from an analysis),
plus the DevTools Protocol for the verbs the extension has no API for.

**Why the vocabularies differ, and why the translation lives here.** Playwright
addresses elements by CSS selector against a DOM it owns. The extension
addresses them by ids that its own page analysis assigned, which is what makes
it robust on pages that rename their classes every deploy. Neither is wrong.
Translating in one place beats teaching the planner two dialects and hoping it
picks the right one for whichever browser happens to be attached.
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

from bridge import bridge

log = logging.getLogger('OwnerPrimitives')


class Unsupported(Exception):
    """This verb has no equivalent in the attached browser."""


async def run(op: str, req: Any) -> dict[str, Any]:
    """
    One primitive, in the owner's browser.

    Raises `Unsupported` for a verb the extension cannot do, so the caller can
    fall back to Dex's own browser deliberately rather than by accident.
    """
    handler = _HANDLERS.get(op)
    if handler is None:
        raise Unsupported(op)
    return await handler(req)


# ── reading ─────────────────────────────────────────────────────────────────

async def _navigate(req: Any) -> dict[str, Any]:
    if not req.url:
        raise ValueError('navigate needs a url')
    await bridge.call('page_navigate', {'url': req.url})
    return await _snapshot()


async def _read(req: Any) -> dict[str, Any]:
    return await _snapshot()


async def _extract(req: Any) -> dict[str, Any]:
    # A selector, when there is one, is honoured through the analysis rather
    # than by querying the DOM directly — the extension's content script is the
    # only thing on the page, and it already knows what is there.
    content = await bridge.call('page_extract_content', {
        'content_type': 'article' if not req.selector else 'main',
    })
    return {'text': _text_of(content), 'selector': req.selector}


async def _map_page(req: Any) -> dict[str, Any]:
    analysis = await bridge.call('page_analyze', {
        'intent_hint': req.goal or 'analyze',
        'phase': 'detailed',
    })
    return analysis if isinstance(analysis, dict) else {'elements': analysis}


async def _screenshot(req: Any) -> dict[str, Any]:
    shot = await bridge.call('page_screenshot', {
        'full_page': True if req.full_page is None else bool(req.full_page),
    })
    # The extension has no disk. It returns the PNG and this writes it, so the
    # owner is given a path in their own filesystem like every other capture.
    target = Path(req.path) if req.path else _default_capture()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(shot.get('base64', '')))
    return {'path': str(target), 'bytes': target.stat().st_size}


# ── acting ──────────────────────────────────────────────────────────────────

async def _click(req: Any) -> dict[str, Any]:
    element = await _find(req.selector or req.text or '', req.goal)
    # The trusted click, not the synthetic one.
    #
    # A synthetic click is ignored by anything that checks isTrusted, and by
    # most controls that open on pointerdown. That silent no-op is a large part
    # of "it did half the work" — the step reported success and the page had
    # not moved.
    result = await bridge.call('element_click_trusted', {'element_id': element})
    return {'clicked': element, **_dict(result)}


async def _type(req: Any) -> dict[str, Any]:
    element = await _find(req.selector or '', req.goal)
    await bridge.call('element_fill', {
        'element_id': element,
        'value': req.text or '',
        'submit': bool(req.submit),
    })
    return {'filled': element}


async def _fill_form(req: Any) -> dict[str, Any]:
    filled: list[str] = []
    for label, value in (req.fields or {}).items():
        element = await _find(label, req.goal)
        await bridge.call('element_fill', {'element_id': element, 'value': value})
        filled.append(label)
    if req.submit:
        await bridge.call('page_press_key', {'key': 'Enter'})
    return {'filled': filled, 'submitted': bool(req.submit)}


async def _press_key(req: Any) -> dict[str, Any]:
    return _dict(await bridge.call('page_press_key', {'key': req.text or 'Enter'}))


async def _scroll(req: Any) -> dict[str, Any]:
    return _dict(await bridge.call('page_scroll', {
        'direction': req.text or 'down',
    }))


async def _wait_for(req: Any) -> dict[str, Any]:
    return _dict(await bridge.call('page_wait_for', {
        'condition': req.selector or req.text or '',
        'timeout': int((req.timeout or 15) * 1000),
    }))


async def _go_back(req: Any) -> dict[str, Any]:
    return _dict(await bridge.call('page_history', {'delta': -1}))


async def _reload(req: Any) -> dict[str, Any]:
    page = await _snapshot()
    await bridge.call('page_navigate', {'url': page.get('url', '')})
    return await _snapshot()


async def _download_current(req: Any) -> dict[str, Any]:
    """
    What the page offered, on disk, with its real name.

    `page_download_to` reports the file Chrome actually wrote rather than
    guessing at the newest thing in Downloads — a guess that is wrong whenever
    anything else downloads while a task runs.
    """
    folder = Path(req.path) if req.path else _downloads()
    folder.mkdir(parents=True, exist_ok=True)
    result = _dict(await bridge.call('page_download_to', {
        'directory': str(folder),
        'timeout_ms': int((req.timeout or 120) * 1000),
    }))
    if result.get('downloaded') is not True:
        return {'downloaded': False, 'reason': 'Nothing finished downloading.'}
    target = folder / str(result.get('file', ''))
    return {
        'downloaded': True,
        'path': str(target),
        'name': str(result.get('suggested_name') or target.name),
        'bytes': target.stat().st_size if target.exists() else 0,
    }


async def _verify(req: Any) -> dict[str, Any]:
    """
    Did what was asked for actually happen — asked of the page in front of them.

    This has to run in the browser the step ran in. Falling back to Dex's own
    browser would check a different page: same URL, logged out, and a check that
    "the profile shows no qwox pin" passes trivially there because the profile
    is not visible at all. A verification that can confirm the wrong browser is
    worse than no verification, because the Reliability Layer trusts it.
    """
    spec = req.verify.model_dump() if req.verify else {}
    if not spec:
        # An empty spec is not success. Nobody said what success looks like.
        return {'passed': False, 'checks': [], 'url': (await _snapshot()).get('url', '')}

    page = await _snapshot()
    checks: list[dict[str, Any]] = []

    if spec.get('url_contains'):
        wanted = str(spec['url_contains'])
        checks.append({
            'check': f'url contains "{wanted}"',
            'passed': wanted.lower() in page.get('url', '').lower(),
        })

    if spec.get('text_on_page'):
        wanted = str(spec['text_on_page'])
        checks.append({
            'check': f'page shows "{wanted}"',
            'passed': wanted.lower() in page.get('text', '').lower(),
        })

    if spec.get('selector'):
        wanted = str(spec['selector'])
        try:
            await _find(wanted, None)
            found = True
        except ValueError:
            found = False
        checks.append({'check': f'{wanted} is present', 'passed': found})

    return {
        'passed': bool(checks) and all(c['passed'] for c in checks),
        'checks': checks,
        'url': page.get('url', ''),
    }


async def _extract_table(req: Any) -> dict[str, Any]:
    """
    A table, read from the page they are looking at.

    Not falling back for this one: a table on a signed-in page is exactly the
    thing Dex's own browser would render as a login prompt and report as an
    empty table.
    """
    content = await bridge.call('page_extract_content', {'content_type': 'table'})
    rows = content.get('rows') if isinstance(content, dict) else None
    return {'rows': rows if isinstance(rows, list) else [], 'text': _text_of(content)}


async def _upload(req: Any) -> dict[str, Any]:
    """Put a local file into the page's upload. There is no other way to do it."""
    paths = req.which if isinstance(req.which, list) else [req.path]
    element = await _find(req.selector or '', req.goal) if req.selector else None
    return _dict(await bridge.call('element_upload_file', {
        **({'element_id': element} if element else {}),
        'paths': [str(p) for p in paths if p],
    }))


# ── the parts both halves need ──────────────────────────────────────────────

async def _snapshot() -> dict[str, Any]:
    """Where we are and what is here, in the shape primitives.py returns."""
    tabs = await bridge.call('tab_list', {'check_content_script': False})
    active = _active_tab(tabs)
    content = await bridge.call('page_extract_content', {'content_type': 'article'})
    return {
        'url': active.get('url', ''),
        'title': active.get('title', ''),
        'text': _text_of(content),
    }


async def _find(target: str, goal: str | None) -> str:
    """
    An element id for something Dex named with a selector or some visible text.

    The analysis is asked for what is on the page and the best match is taken.
    Matching on the analysis rather than on raw DOM because the analysis is what
    the extension's own tools accept, and because it already ranks by what is
    actually interactive — which a CSS selector does not.
    """
    analysis = await bridge.call('page_analyze', {
        'intent_hint': goal or target or 'interact',
        'phase': 'detailed',
    })
    elements = _elements_of(analysis)
    if not elements:
        raise ValueError(f'Nothing on this page matches "{target}".')

    wanted = (target or '').strip().lower().lstrip('#.')
    if not wanted:
        return str(elements[0].get('id'))

    def score(element: dict) -> int:
        haystack = ' '.join(
            str(element.get(key, '')) for key in ('id', 'text', 'label', 'name', 'selector')
        ).lower()
        if wanted == str(element.get('id', '')).lower():
            return 0
        if wanted in haystack:
            return 1 + len(haystack)
        return 10_000

    best = min(elements, key=score)
    if score(best) >= 10_000:
        raise ValueError(
            f'Nothing on this page matches "{target}". '
            f'It offers: {", ".join(str(e.get("text") or e.get("id")) for e in elements[:8])}'
        )
    return str(best.get('id'))


def _elements_of(analysis: Any) -> list[dict]:
    if isinstance(analysis, dict):
        for key in ('elements', 'interactive_elements', 'results'):
            found = analysis.get(key)
            if isinstance(found, list):
                return [e for e in found if isinstance(e, dict)]
    return analysis if isinstance(analysis, list) else []


def _active_tab(tabs: Any) -> dict:
    rows = tabs.get('tabs') if isinstance(tabs, dict) else tabs
    if not isinstance(rows, list):
        return {}
    for row in rows:
        if isinstance(row, dict) and row.get('active'):
            return row
    return rows[0] if rows and isinstance(rows[0], dict) else {}


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        for key in ('content', 'text', 'markdown', 'article'):
            value = content.get(key)
            if isinstance(value, str):
                return value
    return ''


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {'result': value}


def _downloads() -> Path:
    return Path.home() / 'Downloads'


def _default_capture() -> Path:
    from datetime import datetime
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    return Path.home() / 'Pictures' / 'Dex' / f'dex-{stamp}.png'


# `sign_in` is the one verb deliberately absent. It hands off to the owner and
# belongs to the session machinery — and in the attached browser they are
# already signed in, which is the point.
_HANDLERS = {
    'navigate': _navigate,
    'read': _read,
    'read_page': _read,
    'extract': _extract,
    'map_page': _map_page,
    'page_model': _map_page,
    'screenshot': _screenshot,
    'click': _click,
    'click_text': _click,
    'type': _type,
    'type_text': _type,
    'fill_form': _fill_form,
    'press_key': _press_key,
    'scroll': _scroll,
    'wait_for': _wait_for,
    'go_back': _go_back,
    'reload': _reload,
    'download_current': _download_current,
    'upload_file': _upload,
    'extract_table': _extract_table,
    'verify': _verify,
}
