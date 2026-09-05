"""
The owner's real browser, attached to Dex.

This is what `opendia-mcp` used to be, and it is here rather than in a separate
process for a reason that is about safety rather than tidiness.

**MCP tools bypass the confirmation ladder.** An MCP tool is opaque: something
calls it and it returns. Nothing classifies it, nothing assigns it a
confirmation tier, and nothing verifies afterwards that it did what it claimed.
On that path "post a tweet" is a function call that simply happens. Hosted here,
the same capability is an ordinary `can_browse_web` action and goes through what
every other action goes through — a card before anything consequential, and
verification against the live page after.

Dropping the bridge process also removes a port and a protocol, which is worth
something, but it is the second reason.

**Why this browser and not the one Dex drives.** Dex already has a Playwright
browser with its own profile, and it is the right tool for anything that does
not need the owner's identity. What it cannot do is be *signed in as them*:
VTOP, a bank, a work Google account, anything behind a login with two-factor on
a phone. The extension runs inside the browser they already use, so those pages
are simply open. See `routing` at the bottom of this file for which is picked
when.

**The connection is inbound and local.** The extension dials this server; this
server never dials out, and it binds to loopback only. A browser extension that
accepts connections from anywhere would be a remote control for the owner's
logged-in sessions.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

log = logging.getLogger('Bridge')

# How long to wait for the browser to answer one call.
#
# Generous, because the far end is a real page: a click can trigger navigation,
# and `page_wait_for` is a tool whose whole job is to take time. Short enough
# that a wedged extension surfaces as an error rather than a hang.
CALL_TIMEOUT_S = 60.0

# A registration that has said nothing for this long is a browser that was
# closed. The socket usually closes properly; usually is not always, and a
# stale attachment reported as live is the kind of status this project keeps
# finding and removing.
STALE_AFTER_S = 90.0


class BrowserBridge:
    """
    One attached browser, and the calls in flight to it.

    Deliberately not a pool. The extension is installed in *the* browser the
    owner uses; two attachments would mean choosing between them on every call,
    with no basis for the choice and no way for the owner to tell which one
    acted. The most recent registration wins and the previous one is closed.
    """

    def __init__(self) -> None:
        self._socket: Any | None = None
        self._tools: list[dict] = []
        self._pending: dict[str, asyncio.Future] = {}
        self._next_id = 0
        self._registered_at: float = 0.0
        self._last_seen: float = 0.0
        self._browser: str = ''

    # ── the extension's side ────────────────────────────────────────────────

    async def attach(self, socket: Any) -> None:
        """
        Take over from any previous attachment and serve this one until it goes.

        Runs for the life of the connection: everything the extension sends
        arrives here, and there are only three kinds of message — a
        registration, a reply to something we asked, and a heartbeat.
        """
        if self._socket is not None:
            await self.detach('replaced by a newer connection')

        self._socket = socket
        self._last_seen = time.time()

        try:
            while True:
                raw = await socket.receive_text()
                self._last_seen = time.time()

                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    log.warning('bridge: ignoring a frame that is not JSON')
                    continue

                kind = message.get('type')

                if kind == 'register':
                    self._tools = [t for t in message.get('tools', []) if t.get('name')]
                    self._registered_at = time.time()
                    self._browser = str(message.get('browser', '') or '')
                    log.info(
                        'bridge: browser attached with %d tools', len(self._tools),
                    )
                    continue

                if kind in ('ping', 'pong', 'heartbeat'):
                    continue

                # Everything else is an answer to a call. Matched by the id we
                # sent; an id we do not recognise is a reply to a call that
                # already timed out, and dropping it is correct.
                call_id = str(message.get('id', ''))
                waiting = self._pending.pop(call_id, None)
                if waiting is None:
                    continue
                if not waiting.done():
                    waiting.set_result(message)
        finally:
            if self._socket is socket:
                await self.detach('the browser disconnected')

    async def detach(self, reason: str) -> None:
        log.info('bridge: %s', reason)
        self._socket = None
        self._tools = []
        self._registered_at = 0.0

        # Nothing is going to answer these now. Failing them with the reason
        # beats leaving a task waiting out a sixty-second timeout for a browser
        # that has already closed.
        for future in self._pending.values():
            if not future.done():
                future.set_exception(RuntimeError(f'The browser went away: {reason}'))
        self._pending.clear()

    # ── Dex's side ──────────────────────────────────────────────────────────

    @property
    def attached(self) -> bool:
        if self._socket is None:
            return False
        return (time.time() - self._last_seen) < STALE_AFTER_S

    @property
    def ready(self) -> bool:
        """
        Attached *and* able to do anything.

        These are two different facts and treating them as one produced a run
        that reported success having done nothing: the socket opened, Dex
        started the task, and the extension's `register` message — the one
        carrying the tools — had not arrived yet. The model was asked to drive
        a browser with an empty tool list and correctly answered that it could
        not, and that was recorded as a completed task.
        """
        return self.attached and len(self._tools) > 0

    def status(self) -> dict:
        """What Settings shows. Facts, not a claim that it is connected."""
        return {
            'attached': self.attached,
            'browser': self._browser or None,
            'tools': [t.get('name') for t in self._tools],
            'tool_count': len(self._tools),
            'silent_for': (
                round(time.time() - self._last_seen, 1) if self._last_seen else None
            ),
            'reason': (
                '' if self.attached
                else 'no browser is attached — load the Dex extension and open a page'
            ),
        }

    def tools(self) -> list[dict]:
        """The tool declarations the extension registered, verbatim."""
        return list(self._tools)

    async def call(self, method: str, params: dict | None = None) -> Any:
        """
        Run one tool in the attached browser.

        Raises rather than returning an error shape, so a failure travels the
        same way every other agent's failure does and the Orchestrator's retry
        and repair paths see it.
        """
        if not self.attached:
            raise RuntimeError(
                'No browser is attached. Load the Dex extension and open a tab.',
            )
        if not any(t.get('name') == method for t in self._tools):
            known = ', '.join(sorted(t.get('name', '') for t in self._tools))
            raise RuntimeError(f'The browser does not offer "{method}". It offers: {known}')

        self._next_id += 1
        call_id = str(self._next_id)
        waiting: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[call_id] = waiting

        await self._socket.send_text(json.dumps({
            'id': call_id,
            'method': method,
            'params': params or {},
        }))

        try:
            reply = await asyncio.wait_for(waiting, timeout=CALL_TIMEOUT_S)
        except asyncio.TimeoutError:
            self._pending.pop(call_id, None)
            raise RuntimeError(
                f'The browser did not answer "{method}" within '
                f'{int(CALL_TIMEOUT_S)}s. The page may be waiting on something.',
            ) from None

        if isinstance(reply, dict) and reply.get('error'):
            raise RuntimeError(str(reply['error']))
        return reply.get('result') if isinstance(reply, dict) else reply


# One per process. The browser agent owns exactly one attached browser, so a
# module-level instance is the honest shape rather than something threaded
# through every call site.
bridge = BrowserBridge()


# ── which browser answers ──────────────────────────────────────────────────

# Tools that only the owner's own browser can usefully run.
#
# Not a capability list — the Playwright browser can click and type perfectly
# well. It is a list of the things whose *value* is the owner's identity: their
# bookmarks, their history, the tab they already have open. Asking Playwright
# for those returns an empty, correct, useless answer.
OWNER_ONLY = frozenset({
    'get_bookmarks',
    'get_history',
    'tab_list',
    'tab_switch',
    'get_selected_text',
})

def routing(goal: str, needs_session: bool = False, *, background: bool = False) -> str:
    """
    Which browser should run this.

    This used to guess from a list of words — `'my '`, `'post '`, `'pin '` — and
    a list of site names, and default to Dex's own browser when none of them
    matched. That was wrong twice over. It is a hardcoded set of cases, so any
    task phrased outside it went to the wrong browser; and the default was
    backwards, because Dex's own browser is signed in to nothing and answering
    from a logged-out page looks exactly like answering correctly.

    The rule is now a fact rather than a guess:

      the owner's browser   whenever one is attached. It is their real session,
                            their extensions, the tab in front of them. There is
                            no task it does worse.
      Dex's own browser     when the caller asked for background work, or when
                            nothing is attached. It is isolated and can run
                            headless while the owner works, which is the only
                            thing it is better at.

    `needs_session` is kept for callers that already know the answer — a
    sign-in, a bookmark — and forces the owner's browser or an honest refusal
    rather than a silent substitution.
    """
    if background and not needs_session:
        # Explicitly asked to run out of the way. Driving the owner's browser
        # would steal the window they are working in.
        return 'dex'

    if bridge.ready:
        return 'owner'

    # Nothing attached, and Dex can fix that.
    #
    # The old answer here was a refusal telling the owner to open Chrome —
    # something Dex can do itself, and the reason a GitHub task ended with the
    # planner improvising a window action and stopping on two identically
    # named windows. `open` means: open their browser, wait for the extension,
    # then run there.
    return 'open'
