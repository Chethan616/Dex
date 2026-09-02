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
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from browser_use import BrowserSession

import browser_choice
import session_pool
from site_credentials import host_of, lookup
from walls import detect_wall

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


# Finding the login fields, without being told their names.
#
# Every portal spells these differently — `uname`, `userId`, `regno`, `j_username`
# — so nothing here matches a name Dex was given. What it matches is what the
# field *is*: a password input is `type=password`, and the username is the text
# input that comes before it in the same form, which is true of essentially
# every login form ever written and does not need a per-site rule.
#
# Both scripts set the value through the native setter and then fire input and
# change events. A React or Angular form ignores a plain assignment: the box
# looks filled, and submits empty.
_SET_VALUE_JS = """
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  el.focus();
  setter.call(el, __VALUE__);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
"""

_PASSWORD_JS = """
(() => {
  const el = document.querySelector('input[type=password]:not([disabled])');
  if (!el || el.offsetParent === null) return false;
""" + _SET_VALUE_JS + """
})()
"""

_USERNAME_JS = """
(() => {
  const pw = document.querySelector('input[type=password]:not([disabled])');
  const form = pw ? pw.form : null;
  const scope = form || document;
  const inputs = Array.from(scope.querySelectorAll('input:not([disabled])'))
    .filter(i => {
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'email', 'tel', 'number', ''].includes(t)
        && i.offsetParent !== null;
    });
  // The one immediately before the password box. A portal that puts a CAPTCHA
  // answer box after the password would otherwise be a candidate too, and
  // filling the username into it is exactly the kind of quiet wrongness that
  // looks like the site rejecting the credential.
  let el = null;
  if (pw) {
    const all = Array.from(scope.querySelectorAll('input:not([disabled])'));
    const before = all.slice(0, all.indexOf(pw));
    el = before.reverse().find(i => inputs.includes(i)) || null;
  }
  if (!el) el = inputs[0] || null;
  if (!el) return false;
""" + _SET_VALUE_JS + """
})()
"""


# Reading the page the way devtools would, without opening devtools.
#
# The problem this solves: a portal where nothing is labelled. `read_page`
# returns rendered text, and rendered text is exactly what is missing — the
# curriculum link lives inside a menu that is collapsed, so it is in the
# document and not on the screen. Asking a model to reason about text it cannot
# see is asking it to guess.
#
# So this queries the DOM directly, the way a person would with the element
# inspector open, and returns every interactive thing with what it is really
# called. Three sources of a name, in order of how deliberate they are:
# aria-label (someone wrote it for a screen reader), title, then visible text.
#
# **Hidden things are included and marked**, which is the whole point. A
# collapsed nav is the normal state of a portal menu, and an element that is
# not visible right now is often exactly the one to click after opening its
# parent. Excluding them would reproduce the failure.
#
# Nothing is visible to the owner while this runs: it is one Runtime.evaluate
# over the existing CDP connection, the same call `read_page` already makes. No
# devtools window opens, nothing is highlighted, and the page is not touched.
_MAP_PAGE_JS = """
(() => {
  const seen = new Set();
  const out = [];

  const text = (el) => {
    for (const value of [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.innerText,
      el.value,
      el.getAttribute('placeholder'),
      el.getAttribute('alt'),
    ]) {
      const clean = (value || '').replace(/\\s+/g, ' ').trim();
      if (clean) return clean.slice(0, 120);
    }
    return '';
  };

  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.parentElement) {
        const kin = Array.from(node.parentElement.children)
          .filter(c => c.tagName === node.tagName);
        if (kin.length > 1) part += ':nth-of-type(' + (kin.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  // Where in the page it sits, named the way a person would say it. A portal's
  // left menu and its main body look identical in a flat list.
  const regionOf = (el) => {
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 12; depth++) {
      const tag = node.tagName.toLowerCase();
      const role = (node.getAttribute('role') || '').toLowerCase();
      const id = (node.id || '').toLowerCase();
      const cls = (node.className && node.className.baseVal !== undefined
        ? node.className.baseVal : String(node.className || '')).toLowerCase();
      const hint = id + ' ' + cls;
      if (tag === 'nav' || role === 'navigation' || /(^|[^a-z])(nav|menu|sidebar)/.test(hint)) return 'nav';
      if (tag === 'header' || role === 'banner') return 'header';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      if (tag === 'form') return 'form';
      if (tag === 'table' || role === 'grid') return 'table';
      if (tag === 'main' || role === 'main') return 'main';
      node = node.parentElement;
    }
    return 'body';
  };

  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none'
      && parseFloat(style.opacity || '1') > 0.05;
  };

  const SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role=link]', '[role=button]', '[role=menuitem]', '[role=tab]',
    '[role=option]', '[role=treeitem]', '[onclick]', '[data-href]',
  ].join(',');

  for (const el of document.querySelectorAll(SELECTOR)) {
    const label = text(el);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    // A control with no name is one nothing can ask for by name. Inputs are
    // the exception: an unnamed box is still a box that can be filled.
    if (!label && !['input', 'select', 'textarea'].includes(tag)) continue;

    const key = tag + '|' + label + '|' + (el.getAttribute('href') || '');
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = {
      text: label,
      tag: tag,
      selector: selectorFor(el),
      region: regionOf(el),
      visible: visible(el),
    };

    const href = el.getAttribute('href');
    if (href && !href.startsWith('javascript:')) {
      try { entry.href = new URL(href, location.href).href; } catch (_) {}
    }
    const role = el.getAttribute('role');
    if (role) entry.role = role;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      entry.field = type || tag;
      // Never the value of a password box, whatever else is reported.
      if (type !== 'password' && el.value) entry.value = String(el.value).slice(0, 80);
    }

    out.push(entry);
    if (out.length >= 400) break;
  }

  return JSON.stringify({
    url: location.href,
    title: document.title,
    elements: out,
  });
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


async def _safe_state(session: BrowserSession) -> str:
    """The DOM as text, or empty. A page that will not serialise is still a page."""
    try:
        return await session.get_state_as_text()
    except Exception:  # noqa: BLE001
        return ''


def has_spec(spec: dict[str, Any] | None) -> bool:
    return bool(spec) and any(
        spec.get(k) for k in ('url_contains', 'text_on_page', 'selector')
    )


# -- the deterministic backend ------------------------------------------------


class PrimitiveBrowser:
    """
    Deterministic browsing, against whatever browser the pool is holding.

    This used to keep its own dictionary of sessions. It cannot any more: the
    autonomous backend opens browsers too, and since both were pointed at Dex's
    one persistent profile directory, two owners meant two Chromium processes
    reaching for a lock only one of them can have. See session_pool.
    """

    def __init__(self, headless: bool) -> None:
        self.headless = headless
        # Downloads older than this were not produced by anything Dex did. See
        # download_current: "the newest file in Downloads" is only the right
        # answer if it is also newer than this process.
        self._started_at = time.time()

    async def session(self, browser: str | None = None) -> BrowserSession:
        return await session_pool.POOL.acquire(browser, self.headless)

    async def close(self) -> None:
        await session_pool.POOL.close_all()

    async def navigate(self, url: str, browser: str | None = None) -> dict[str, Any]:
        session = await self.session(browser)
        await session.navigate_to(url)
        return await snapshot(session)

    async def read(self, browser: str | None = None) -> dict[str, Any]:
        return await snapshot(await self.session(browser))

    async def click(self, selector: str, browser: str | None = None) -> dict[str, Any]:
        session = await self.session(browser)
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

    async def type_text(self, selector: str, text: str, browser: str | None = None) -> dict[str, Any]:
        session = await self.session(browser)
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

    async def extract(
        self, selector: str | None = None, browser: str | None = None,
    ) -> dict[str, Any]:
        session = await self.session(browser)
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

    async def download_current(
        self, name: str | None = None, browser: str | None = None,
    ) -> dict[str, Any]:
        """
        Whatever the signed-in browser just downloaded, on disk.

        `download_file` cannot do this. It is a bare HTTPS GET with no cookies,
        so pointed at a portal it fetches the login page and saves it as a PDF —
        a file that exists, has plausible bytes, and is worthless. Anything
        behind a session has to come down through the session.

        The browser is configured with a downloads directory when the pool
        creates it, so a click that triggers a download has already written the
        file by the time this is called. This finds it and says where it went.
        """
        session = await self.session(browser)
        folder = Path(session_pool.downloads_dir())

        before = await session.get_current_page_url() or ''

        # Give a download that is still arriving a moment to finish. Chromium
        # writes `.crdownload` while in flight, so the wait is on that clearing
        # rather than on a fixed sleep that is either too short or wasteful.
        deadline = asyncio.get_event_loop().time() + 30
        newest: Path | None = None
        while asyncio.get_event_loop().time() < deadline:
            candidates = [
                f for f in folder.glob('*')
                if f.is_file() and not f.name.endswith(('.crdownload', '.tmp'))
            ]
            if candidates:
                newest = max(candidates, key=lambda f: f.stat().st_mtime)
                # Only count something written since this browser started; an
                # old file in Downloads is not what the page just offered.
                if newest.stat().st_mtime >= self._started_at:
                    break
            newest = None
            await asyncio.sleep(0.5)

        if newest is None:
            return {
                'downloaded': False,
                'url': before,
                'reason': (
                    'Nothing arrived in the downloads folder. The page may not '
                    'have started a download, or it opened the file in a viewer '
                    'instead — try the link that says download rather than view.'
                ),
            }

        target = newest
        if name:
            wanted = folder / _safe_name(str(name), newest.suffix)
            try:
                newest.replace(wanted)
                target = wanted
            except OSError:
                # A name collision or a locked file is not worth failing over;
                # the file is downloaded either way and the real path is what
                # the caller needs.
                target = newest

        return {
            'downloaded': True,
            'path': str(target),
            'name': target.name,
            'bytes': target.stat().st_size,
            'url': before,
        }

    async def map_page(
        self,
        query: str | None = None,
        browser: str | None = None,
        include_hidden: bool = True,
    ) -> dict[str, Any]:
        """
        Every interactive thing on the page, and what it is really called.

        The answer to a portal whose sections are not labelled. `read_page`
        gives rendered text; this gives the document — including the menu items
        that are in the DOM but collapsed, which on a portal is most of them.

        `query` filters and ranks rather than excluding: a search for
        "curriculum" puts anything matching first and still returns the rest,
        because the whole reason this exists is that the thing being looked for
        is probably called something else.
        """
        session = await self.session(browser)
        raw = await evaluate(session, _MAP_PAGE_JS)

        try:
            data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except (TypeError, json.JSONDecodeError):
            return {'url': '', 'elements': [], 'error': 'the page could not be read'}

        elements = data.get('elements', [])
        if not include_hidden:
            elements = [e for e in elements if e.get('visible')]

        matched = 0
        if query:
            wanted = [w for w in re.split(r'[^a-z0-9]+', str(query).lower()) if len(w) > 2]
            if wanted:
                scored = [(_score(e, wanted), e) for e in elements]
                matched = sum(1 for score, _ in scored if score > 0)
                # Ranked, not filtered. The thing being looked for is probably
                # named something the query does not contain — that is why the
                # page needed mapping in the first place — so nothing is thrown
                # away, it is only put in a useful order.
                scored.sort(key=lambda pair: pair[0], reverse=True)
                elements = [e for _, e in scored]

        return {
            'url': data.get('url', ''),
            'title': data.get('title', ''),
            'total': len(elements),
            'matched': matched,
            'elements': elements[:120],
        }

    async def session_status(
        self, url: str, browser: str | None = None,
    ) -> dict[str, Any]:
        """
        Is this site still signed in?

        Cheap, and it changes where a failure happens. Without it, an expired
        portal session is discovered nine steps into a task, as an autonomous
        agent wandering a login page it cannot pass — which is a confusing thing
        to watch and an expensive thing to pay for. With it, the answer is the
        first thing the plan learns.

        "Signed in" is decided the only way it can be from outside: navigate and
        see whether the site sent us to a login page. There is no general way to
        ask a site about a session, so this asks the site the same question a
        person would.
        """
        session = await self.session(browser)
        await session.navigate_to(url)
        await asyncio.sleep(0.8)

        snap = await snapshot(session)
        landed = snap['url'] or ''
        dom = await _safe_state(session)

        wall = detect_wall(landed, snap['title'], dom, task='')
        state, why = await self._session_state(browser, wall, landed, url)

        return {
            'url': landed,
            # Three-valued on purpose. See _session_state.
            'state': state,
            'signed_in': state == 'signed_in',
            'reason': why,
            'wall': None if wall is None else wall.kind,
            'has_credential': lookup(landed) is not None,
            'login_url': self._login_hint(landed, url),
        }

    async def _session_state(
        self, browser: str | None, wall, landed: str, asked: str,
    ) -> tuple:
        """
        Signed in, signed out, or genuinely unknown.

        This used to be `wall is None and same host`, which is not evidence of a
        session — it is the absence of evidence against one. Asked about
        vtop.vit.ac.in it landed on the marketing page, found no password field
        and no /login in the URL, and reported the owner was signed in. They
        were not; the portal had simply not been asked to show a login form yet.

        So decide from what the page actually contains, using map_page — which
        reads the document rather than the rendered text, and therefore sees a
        sign-out link inside a collapsed profile menu:

            a password field, or a Login control      -> signed out
            a Logout / Sign out control, or a profile -> signed in
            neither                                   -> unknown

        Unknown is a real answer and is returned as one. A landing page tells
        you nothing about your session, and saying so lets a plan navigate to
        the login page and look properly instead of proceeding on a guess.
        """
        if wall is not None and wall.kind in ('password', 'login', 'captcha'):
            return 'signed_out', wall.reason

        if host_of(landed) != host_of(asked):
            return 'signed_out', f'{host_of(asked)} redirected to {host_of(landed)}'

        page = await self.map_page(browser=browser)
        elements = page.get('elements', [])

        for element in elements:
            if str(element.get('field', '')).lower() == 'password':
                return 'signed_out', 'the page is showing a password field'

        labels = [str(e.get('text', '')).strip().lower() for e in elements]
        hrefs = [str(e.get('href', '')).lower() for e in elements]

        if any(_matches(text, _SIGNED_IN_WORDS) for text in labels) or any(
            any(word in href for word in ('logout', 'signout', 'sign-out'))
            for href in hrefs
        ):
            return 'signed_in', 'the page offers a way to sign out'

        if any(_matches(text, _SIGNED_OUT_WORDS) for text in labels):
            return 'signed_out', 'the page is offering a way to sign in'

        return 'unknown', (
            'this page shows neither a way in nor a way out, so it says nothing '
            'about the session — try the login page for this site'
        )

    @staticmethod
    def _login_hint(landed: str, asked: str) -> str:
        """
        Where the login form probably is.

        A bare host is rarely the login page — vtop.vit.ac.in serves marketing
        and keeps its form at /vtop/login. If the page redirected somewhere with
        "login" in it, that redirect is the site telling us where; otherwise the
        landed URL is the best guess available and the agent will look.
        """
        if any(word in landed.lower() for word in ('login', 'signin', 'sign-in', 'auth')):
            return landed
        return landed or asked

    async def sign_in(
        self, url: str, browser: str | None = None,
    ) -> dict[str, Any]:
        """
        Fill a stored username and password, then stop.

        The one place in Dex where a password is typed, and it is deliberately
        not general: it fills a credential the owner stored by hand, for this
        exact host, on a page their own task navigated to. `type_text` still
        refuses every password field it is pointed at, so nothing a model
        decides can reach this path — only a plan step named `sign_in`.

        It does not submit the form. Whatever comes after the password is
        usually a CAPTCHA, and that belongs to the owner: it is a control the
        site put there to keep automation out, and solving it is not Dex's to
        do. What Dex does is everything up to it, so the owner's part is a
        glance and a few characters rather than a login.

        The secret never leaves this function. It is read from DPAPI here, typed
        into the page here, and never returned, logged or reported — the result
        below says whether a password was filled, not what it was.
        """
        session = await self.session(browser)
        await session.navigate_to(url)
        await asyncio.sleep(0.8)

        # After redirects, not before. The page about to receive keystrokes is
        # the one that decides which credential applies — a login flow that
        # bounced somewhere else gets nothing.
        landed = await session.get_current_page_url() or ''
        credential = lookup(landed)

        if credential is None:
            stored = host_of(url)
            return {
                'url': landed,
                'filled': [],
                'needs_owner': True,
                'reason': (
                    f'No credential stored for {host_of(landed) or "this page"}. '
                    + (
                        f'One is stored for {stored}, but the page ended up '
                        f'somewhere else — Dex will not type it here.'
                        if lookup(url) is not None
                        else 'Add one in Settings, or sign in yourself in the '
                             'open window and Dex will keep the session.'
                    )
                ),
            }

        filled: list[str] = []
        if credential['username']:
            if await self._fill(session, _USERNAME_JS, credential['username']):
                filled.append('username')
        if credential['password']:
            if await self._fill(session, _PASSWORD_JS, credential['password']):
                filled.append('password')

        snap = await snapshot(session)
        dom = await _safe_state(session)
        wall = detect_wall(snap['url'], snap['title'], dom, task='sign in')

        return {
            'url': snap['url'],
            'title': snap['title'],
            'host': credential['host'],
            # Names of fields, never values. This dictionary goes into the event
            # stream and the telemetry database.
            'filled': filled,
            'needs_owner': True,
            'reason': (
                f'Signed {", ".join(filled) or "nothing"} in on {credential["host"]}. '
                'Finish the CAPTCHA and submit in the open window, then choose '
                '"Done, continue" — the session is kept, so this is once, not '
                'once per task.'
            ),
            'wall': None if wall is None else wall.kind,
        }

    async def _fill(self, session: BrowserSession, finder: str, value: str) -> bool:
        """
        Put a value into the field that script finds.

        Set through the native value setter and followed by input and change
        events, because a framework-controlled form ignores a plain assignment —
        the field looks filled and submits empty, which is the most confusing
        possible way for a login to fail.
        """
        return bool(await evaluate(
            session,
            finder.replace('__VALUE__', json.dumps(value)),
        ))


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


def _safe_name(raw: str, fallback_suffix: str) -> str:
    """
    A filename from something the owner or a model said.

    Path separators and traversal are stripped rather than escaped: the caller
    is naming a file, not choosing a directory, and the only reason a name would
    contain a slash is that something is trying to write somewhere else.
    """
    stem = re.sub(r'[^A-Za-z0-9._ -]', '_', raw).strip(' .') or 'download'
    stem = stem[:120]
    if not Path(stem).suffix and fallback_suffix:
        stem += fallback_suffix
    return stem


def _score(element: dict, wanted: list[str]) -> int:
    """
    How likely this element is to be the thing being looked for.

    Text is worth most because it is what a person reads. The href and the
    selector are worth something because a link called "Course Page" often
    points at /curriculum, and a generated id often still contains the word —
    which is exactly the case where the visible label is useless and the markup
    underneath is not.
    """
    label = str(element.get('text', '')).lower()
    href = str(element.get('href', '')).lower()
    selector = str(element.get('selector', '')).lower()

    score = 0
    for word in wanted:
        if word in label:
            score += 10
            # An exact label is a much stronger signal than a substring: on a
            # page full of "Course Page" and "Course Details", "course" matching
            # both is not information.
            if label.strip() == word:
                score += 8
        if word in href:
            score += 4
        if word in selector:
            score += 2

    # A visible control in the navigation is more likely to be the way onward
    # than a hidden one in the footer. A tiebreaker, not a filter.
    if score > 0:
        if element.get('region') == 'nav':
            score += 3
        if element.get('visible'):
            score += 1
    return score


# Words that mean a session exists, and words that mean it does not.
#
# Matched as whole words against a control's visible label, so "Login" matches
# and "Blogin" does not, and neither does the "log in" inside a sentence of
# marketing copy on a landing page.
_SIGNED_IN_WORDS = ('logout', 'log out', 'sign out', 'signout', 'my account',
                    'my profile', 'dashboard')
_SIGNED_OUT_WORDS = ('login', 'log in', 'sign in', 'signin', 'sign up')


def _matches(text: str, words: tuple) -> bool:
    stripped = text.strip().lower().rstrip(':>').strip()
    # Equality rather than containment. A page of prose that happens to contain
    # "sign in" is not a page offering a sign-in control, and the difference is
    # the whole reason this check exists.
    return stripped in words
