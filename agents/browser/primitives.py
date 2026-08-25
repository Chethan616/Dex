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
import re
from typing import Any

from browser_use import BrowserSession

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
    """One long-lived browser for deterministic work, started on first use."""

    def __init__(self, headless: bool) -> None:
        self.headless = headless
        self._session: BrowserSession | None = None
        self._lock = asyncio.Lock()

    async def session(self) -> BrowserSession:
        async with self._lock:
            if self._session is None:
                session = BrowserSession(headless=self.headless)
                await session.start()
                self._session = session
            return self._session

    async def close(self) -> None:
        session, self._session = self._session, None
        if session is not None:
            try:
                await session.kill()
            except Exception:  # noqa: BLE001
                pass

    async def navigate(self, url: str) -> dict[str, Any]:
        session = await self.session()
        await session.navigate_to(url)
        return await snapshot(session)

    async def read(self) -> dict[str, Any]:
        return await snapshot(await self.session())

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

    async def verify(self, spec: dict[str, Any]) -> dict[str, Any]:
        return await check_page(await self.session(), spec)


def _clean(text: str) -> str:
    return re.sub(r'\n{3,}', '\n\n', text).strip()
