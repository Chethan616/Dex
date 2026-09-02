"""
Watching the owner find something once, so Dex never has to guess again.

A portal with no headings is not a reasoning problem, it is a knowledge problem.
Nothing on VTOP says "curriculum"; the link that leads there is called something
else, inside a menu called something else again. A model can find it, sometimes,
by reading every page and guessing — expensively, and differently each run. A
person who has been shown once never thinks about it again.

So Dex is shown once. The owner drives; this records what they clicked, in
order, as the page itself labelled it.

**What is recorded is the visible text, not a selector.** Selectors on portals
of this vintage are generated — `#ctl00_ContentPlaceHolder1_lnk3` — and change
between deployments. The words on the link are what a person navigates by and
what survives a redesign, so they are the primary key and the selector is only a
tiebreaker. The URL each click produced is kept as well, but for recognising a
wrong turn rather than for jumping straight there: see site_routes.ts on why
deep links do not work here.

The recording listens rather than intercepts. Clicks go through untouched — the
owner is simply using their browser, and Dex is taking notes.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

log = logging.getLogger('RouteRecorder')

# Injected into every page, including ones reached by navigating.
#
# Capture phase, so it sees the click before the page's own handler can stop it
# from propagating — portals cancel and re-dispatch clicks constantly, and a
# bubble-phase listener misses most of them.
#
# It walks up from the click target to find something that reads like a control,
# because the actual event target is usually an icon or a span inside the link.
_RECORDER_JS = r"""
(() => {
  if (window.__dexRoute) return true;
  window.__dexRoute = [];

  const label = (el) => {
    for (const source of [
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.innerText,
      el.value,
      el.getAttribute && el.getAttribute('alt'),
    ]) {
      const text = (source || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 120) return text;
    }
    return '';
  };

  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.parentElement) {
        const siblings = Array.from(node.parentElement.children)
          .filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  document.addEventListener('click', (event) => {
    // Up from the icon or span that was actually hit, to the thing a person
    // would say they clicked.
    let el = event.target;
    for (let depth = 0; el && el.nodeType === 1 && depth < 6; depth++) {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const clickable = tag === 'a' || tag === 'button'
        || (tag === 'input' && ['submit', 'button'].includes((el.type || '').toLowerCase()))
        || ['link', 'button', 'menuitem', 'tab'].includes(role)
        || el.onclick;
      if (clickable) break;
      el = el.parentElement;
    }
    if (!el || el.nodeType !== 1) return;

    const text = label(el);
    if (!text) return;

    window.__dexRoute.push({
      text: text,
      selector: selectorFor(el),
      from: location.href,
      at: Date.now(),
    });
  }, true);

  return true;
})()
"""

_DRAIN_JS = """
(() => {
  const steps = window.__dexRoute || [];
  window.__dexRoute = [];
  return JSON.stringify(steps);
})()
"""


class RouteRecorder:
    """
    One recording in progress.

    Kept as an object rather than a function because recording spans several
    requests: it starts, the owner navigates for a minute or two, and then a
    separate call ends it. Nothing here holds the browser — it polls, so a page
    that navigates away and takes the listener with it is re-armed rather than
    lost.
    """

    def __init__(self, session, origin: str, goal: str) -> None:
        self.session = session
        self.origin = origin
        self.goal = goal
        self.steps: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        await self._arm()
        self._task = asyncio.create_task(self._poll())

    async def stop(self) -> list[dict[str, Any]]:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        await self._drain()
        return self._clean()

    async def _poll(self) -> None:
        """
        Collect clicks, and put the listener back after every navigation.

        A page load wipes the listener with the rest of the document, so this
        re-injects on a short interval rather than trying to hook navigation
        events — which vary by how the portal navigates and would need to be
        right for all of them.
        """
        from primitives import evaluate

        while not self._stop.is_set():
            try:
                await self._drain()
                await evaluate(self.session, _RECORDER_JS)
            except Exception:  # noqa: BLE001 - a page mid-navigation is normal
                log.debug('recorder poll skipped a beat', exc_info=True)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=0.7)
            except asyncio.TimeoutError:
                pass

    async def _arm(self) -> None:
        from primitives import evaluate
        await evaluate(self.session, _RECORDER_JS)

    async def _drain(self) -> None:
        from primitives import evaluate
        try:
            raw = await evaluate(self.session, _DRAIN_JS)
        except Exception:  # noqa: BLE001
            return
        if not raw:
            return
        try:
            self.steps.extend(json.loads(raw))
        except (TypeError, json.JSONDecodeError):
            return

    def _clean(self) -> list[dict[str, Any]]:
        """
        The recording, tidied into a route worth replaying.

        Two things are removed, and both are the difference between a route that
        works and one that looks right:

          * **Repeats of the same control.** A portal that does not respond
            immediately gets clicked twice, and a route that says "click Academics,
            then click Academics" fails on the second step every time.

          * **Anything clicked on the login page.** The owner signing in is not
            part of the way to the curriculum, and replaying it would have Dex
            clicking a login button on an already-signed-in session.
        """
        cleaned: list[dict[str, Any]] = []
        for step in self.steps:
            text = str(step.get('text', '')).strip()
            if not text:
                continue
            if _is_login_noise(text, str(step.get('from', ''))):
                continue
            if cleaned and cleaned[-1]['text'].lower() == text.lower():
                continue
            cleaned.append({
                'text': text,
                'selector': step.get('selector') or None,
                'url': step.get('from') or None,
            })
        return cleaned


_LOGIN_WORDS = ('sign in', 'signin', 'log in', 'login', 'submit', 'captcha')


def _is_login_noise(text: str, from_url: str) -> bool:
    lowered = text.lower()
    on_login_page = any(w in (from_url or '').lower() for w in ('login', 'signin', 'sign-in'))
    return on_login_page and any(word in lowered for word in _LOGIN_WORDS)
