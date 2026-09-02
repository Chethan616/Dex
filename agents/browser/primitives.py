"""
Deterministic browser primitives -- the control-mode counterpart to the
autonomous backend.

Two jobs:

  * Verification. The Reliability Layer must be able to ask the live page a
    question the agent that just acted has no say in answering. "The agent said
    it booked the flight" is a claim; "the URL contains /confirmation and the
    text 'Booking reference' is on the page" is evidence. `check_page` runs
    against a BrowserSession directly, so the autonomous backend can call it on
    its own live page before that page is torn down.

  * A fallback when the autonomous loop is the wrong tool -- a known page and a
    known selector, where reasoning adds nothing but a failure mode.

Everything here is exact: a selector or a URL, no model in the path. Page text
returned from these calls is untrusted data and is never fed back as
instruction.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from browser_use import BrowserSession

import browser_choice

# Refuses to type into these, whatever the selector says. SAFETY.md: DEX never
# fills a password, and a "type" primitive is exactly how that rule gets
# quietly broken.
_SECRET_FIELD_JS = """
(() => {
  const el = document.querySelector(__SELECTOR__);
  if (!el) return {found: false};
  const type = (el.getAttribute('type') || '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const name = (el.getAttribute('name') || '').toLowerCase();
  const secret = type === 'password'
    || ac.includes('password')
    || ac === 'one-time-code'
    || /pass(word|wd)|otp|mfa|2fa/.test(name);
  return {found: true, secret: secret};
})()
"""


# -- session-level helpers ----------------------------------------------------


async def evaluate(session: BrowserSession, expression: str) -> Any:
    """Run JS in the focused page and return it by value."""
    cdp = await session.get_or_create_cdp_session()
    response = await cdp.cdp_client.send.Runtime.evaluate(
        params={
            'expression': expression,
            'returnByValue': True,
            'awaitPromise': True,
        },
        session_id=cdp.session_id,
    )
    if response.get('exceptionDetails'):
        detail = response['exceptionDetails']
        text = detail.get('exception', {}).get('description') or detail.get('text')
        raise RuntimeError(f'Page script error: {text}')
    return response.get('result', {}).get('value')


async def snapshot(session: BrowserSession, max_chars: int = 20_000) -> dict[str, Any]:
    url = await session.get_current_page_url()
    title = await session.get_current_page_title()
    try:
        text = await evaluate(session, 'document.body ? document.body.innerText : ""')
    except Exception:  # noqa: BLE001 -- a page that refuses to be read is still a page
        text = ''
    return {
        'url': url or '',
        'title': title or '',
        'text': _clean(str(text or ''))[:max_chars],
    }


async def check_page(session: BrowserSession, spec: dict[str, Any]) -> dict[str, Any]:
    """
    Answer only what the caller asked, and return what answered it.

    An empty spec returns passed=False on purpose: "nobody said what success
    looks like" is not the same as success, and the Reliability Layer needs to
    be able to tell those apart.
    """
    url_contains = spec.get('url_contains')
    text_on_page = spec.get('text_on_page')
    selector = spec.get('selector')

    snap = await snapshot(session)
    checks: list[dict[str, Any]] = []

    if url_contains:
        checks.append({
            'check': f'url contains "{url_contains}"',
            'passed': str(url_contains).lower() in snap['url'].lower(),
        })

    if text_on_page:
        checks.append({
            'check': f'page shows "{text_on_page}"',
            'passed': str(text_on_page).lower() in snap['text'].lower(),
        })

    if selector:
        try:
            present = await evaluate(
                session, f'!!document.querySelector({json.dumps(str(selector))})'
            )
        except Exception:  # noqa: BLE001
            present = False
        checks.append({'check': f'element {selector} exists', 'passed': bool(present)})

    return {
        'checks': checks,
        'passed': bool(checks) and all(c['passed'] for c in checks),
        'url': snap['url'],
        'title': snap['title'],
        # A short excerpt goes into the evidence file so a failed verification
        # can be read back later without re-running anything.
        'excerpt': snap['text'][:600],
    }


def has_spec(spec: dict[str, Any] | None) -> bool:
    return bool(spec) and any(
        spec.get(k) for k in ('url_contains', 'text_on_page', 'selector')
    )


# -- the deterministic backend ------------------------------------------------


class PrimitiveBrowser:
    """
    Long-lived browsers for deterministic work, started on first use.

    One per browser rather than one overall. A task that asks for Vivaldi and a
    task that asks for the default cannot share a session — they are different
    processes — and keeping the first one that happened to start would mean the
    second request quietly ran somewhere else and reported success.

    Every one of them uses Dex's own persistent profile, so a site signed into
    once stays signed in. See browser_choice.
    """

    def __init__(self, headless: bool) -> None:
        self.headless = headless
        self._sessions: dict[str, BrowserSession] = {}
        self._lock = asyncio.Lock()

    async def session(self, browser: str | None = None) -> BrowserSession:
        key = (browser or '').strip().lower()
        async with self._lock:
            existing = self._sessions.get(key)
            if existing is None:
                # Raises for a browser that is not installed or cannot be
                # driven, before anything is launched — a clear failure beats
                # silently using a different browser than the one asked for.
                kwargs = browser_choice.session_kwargs(browser, self.headless)
                session = BrowserSession(**kwargs)
                await session.start()
                self._sessions[key] = session
                existing = session
            return existing

    async def close(self) -> None:
        sessions, self._sessions = list(self._sessions.values()), {}
        for session in sessions:
            try:
                await session.kill()
            except Exception:  # noqa: BLE001
                pass

    async def navigate(self, url: str, browser: str | None = None) -> dict[str, Any]:
        session = await self.session(browser)
        await session.navigate_to(url)
        return await snapshot(session)

    async def read(self, browser: str | None = None) -> dict[str, Any]:
        return await snapshot(await self.session(browser))

    async def click(self, selector: str) -> dict[str, Any]:
        session = await self.session()
        found = await evaluate(
            session,
            f"""
            (() => {{
              const el = document.querySelector({json.dumps(selector)});
              if (!el) return false;
              el.scrollIntoView({{block: 'center'}});
              el.click();
              return true;
            }})()
            """,
        )
        if not found:
            raise LookupError(f'No element matches {selector}')
        # Let a navigation or re-render settle before anyone reads the page.
        await asyncio.sleep(0.6)
        return await snapshot(session)

    async def type_text(self, selector: str, text: str) -> dict[str, Any]:
        session = await self.session()
        probe = await evaluate(
            session, _SECRET_FIELD_JS.replace('__SELECTOR__', json.dumps(selector))
        )
        if not probe or not probe.get('found'):
            raise LookupError(f'No element matches {selector}')
        if probe.get('secret'):
            raise PermissionError(
                f'{selector} is a password or one-time-code field. DEX does not type '
                'secrets -- this needs a hand-off to the owner.'
            )

        ok = await evaluate(
            session,
            f"""
            (() => {{
              const el = document.querySelector({json.dumps(selector)});
              if (!el) return false;
              el.focus();
              const proto = el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value');
              if (setter && setter.set) setter.set.call(el, {json.dumps(text)});
              else el.value = {json.dumps(text)};
              el.dispatchEvent(new Event('input', {{bubbles: true}}));
              el.dispatchEvent(new Event('change', {{bubbles: true}}));
              return true;
            }})()
            """,
        )
        if not ok:
            raise LookupError(f'No element matches {selector}')
        return await snapshot(session)

    async def extract(self, selector: str | None = None) -> dict[str, Any]:
        session = await self.session()
        if not selector:
            return await snapshot(session)
        values = await evaluate(
            session,
            f"""
            Array.from(document.querySelectorAll({json.dumps(selector)}))
              .map(el => el.innerText)
              .filter(Boolean)
            """,
        )
        return {
            'url': await session.get_current_page_url(),
            'matches': [_clean(str(v)) for v in (values or [])],
        }

    async def screenshot(
        self,
        path: str | None = None,
        full_page: bool = True,
    ) -> dict[str, Any]:
        """
        Save what the page looks like, and say where it went.

        Full-page by default. A viewport-only capture of a long page is almost
        never what someone means by "screenshot that site", and cropping is
        something they can do afterwards while un-cropping is not.

        The file lands in the owner's Pictures folder unless they name a path,
        and the path is checked the same way every other file write is — a
        screenshot is a file write, and it does not get its own weaker rule
        because it came from the browser.
        """
        session = await self.session()

        target = _screenshot_path(path)
        target.parent.mkdir(parents=True, exist_ok=True)

        page = await session.get_current_page()
        await page.screenshot(path=str(target), full_page=bool(full_page))

        return {
            'path': str(target),
            'url': await session.get_current_page_url(),
            'title': await session.get_current_page_title(),
            'full_page': bool(full_page),
            'bytes': target.stat().st_size if target.exists() else 0,
        }

    async def verify(self, spec: dict[str, Any]) -> dict[str, Any]:
        return await check_page(await self.session(), spec)


def _screenshot_path(raw: str | None) -> Path:
    """
    Where a screenshot may be written.

    Inside the user profile, like every other file Dex writes. A browser
    primitive that could write anywhere would be a way around the file
    boundary, reached by asking for a screenshot instead of a file.
    """
    home = Path.home().resolve()

    if raw:
        candidate = Path(os.path.expandvars(str(raw))).expanduser()
        if not candidate.is_absolute():
            candidate = home / 'Pictures' / candidate
        candidate = candidate.resolve()
        try:
            candidate.relative_to(home)
        except ValueError:
            raise PermissionError(
                f'Refused: {candidate} is outside your user profile. '
                'Screenshots go in folders you own.'
            ) from None
        return candidate

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    pictures = home / 'OneDrive' / 'Pictures'
    if not pictures.exists():
        pictures = home / 'Pictures'
    return pictures / 'Dex' / f'screenshot-{stamp}.png'


def _clean(text: str) -> str:
    return re.sub(r'\n{3,}', '\n\n', text).strip()
