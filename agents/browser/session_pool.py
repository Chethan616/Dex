"""
One browser per profile, shared by everything that needs it.

This exists to fix a bug that was shipped and would have failed in front of an
audience. Both browser backends were given Dex's persistent profile directory on
the same day, and Chromium allows exactly one process per profile:

    PrimitiveBrowser   kept its sessions alive indefinitely
    BrowserUseBackend  built its own in start_task and killed it in _teardown

So a plan that navigated somewhere and then handed the page to the autonomous
agent — which is the shape of every "sign in, then do something" task — had two
Chromium processes reaching for one locked profile. The second either fails to
start or silently attaches to the first and loses its CDP connection.

The fix is not to give them separate profiles. Separate profiles mean separate
cookie jars, and the whole point of the persistent profile is that signing in
once is enough for everything afterwards. They have to share the browser, so
something has to own it. This is that something.

Two consequences worth stating:

  * **A session outlives the task that created it.** That is deliberate: it is
    what keeps a signed-in portal signed in between one request and the next,
    and what lets `sign_in` be a separate step from the work that follows it.

  * **A forgotten window would hold the profile lock forever**, so an idle
    session is closed after IDLE_TIMEOUT. The next request starts a fresh one
    against the same profile, still signed in, because the cookies are on disk
    rather than in the process.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

from browser_use import BrowserSession

import browser_choice

log = logging.getLogger('SessionPool')

# How long a browser may sit unused before it is closed.
#
# Long enough that a person reading a page, thinking, and asking a follow-up
# does not lose their session; short enough that a window forgotten before lunch
# is not still holding the profile lock after it.
IDLE_TIMEOUT = 15 * 60


def downloads_dir() -> str:
    """
    Where a download from the browser lands.

    The owner's real Downloads folder, not a Dex-private one: a file fetched
    from a portal is theirs, and the first thing anyone does after "download my
    curriculum" is go and look for it where downloads go.
    """
    home = os.environ.get('USERPROFILE') or os.path.expanduser('~')
    path = Path(home) / 'Downloads'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return str(Path(home))
    return str(path)


class _Entry:
    __slots__ = ('session', 'last_used')

    def __init__(self, session: BrowserSession) -> None:
        self.session = session
        self.last_used = time.monotonic()


class SessionPool:
    """Hands out live browsers, keyed by which browser and whether it is headless."""

    def __init__(self) -> None:
        self._entries: dict[tuple[str, bool], _Entry] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, browser: str | None, headless: bool) -> BrowserSession:
        key = ((browser or '').strip().lower(), bool(headless))

        async with self._lock:
            await self._reap()

            entry = self._entries.get(key)
            if entry is not None and _alive(entry.session):
                entry.last_used = time.monotonic()
                return entry.session

            # A session that died on its own — the owner closed the window, or
            # Chromium crashed — is not an error worth reporting. Replace it.
            if entry is not None:
                log.info('replacing a browser session that is no longer alive')
                self._entries.pop(key, None)

            # Raises for a browser that is not installed or cannot be driven,
            # before anything launches. A clear failure beats silently using a
            # different browser than the one that was asked for.
            kwargs = browser_choice.session_kwargs(browser, headless)
            kwargs['accept_downloads'] = True
            kwargs['downloads_path'] = downloads_dir()

            session = BrowserSession(**kwargs)
            await session.start()
            self._entries[key] = _Entry(session)
            return session

    def touch(self, session: BrowserSession) -> None:
        """
        Mark a session as still in use.

        Called while a long autonomous task is running, so a twenty-minute
        browsing job does not have its own browser reaped out from under it.
        """
        for entry in self._entries.values():
            if entry.session is session:
                entry.last_used = time.monotonic()
                return

    async def release(self, browser: str | None = None, headless: bool = False) -> bool:
        """Close one browser now. Used by an explicit "close the browser"."""
        key = ((browser or '').strip().lower(), bool(headless))
        async with self._lock:
            entry = self._entries.pop(key, None)
        if entry is None:
            return False
        await _kill(entry.session)
        return True

    async def close_all(self) -> None:
        async with self._lock:
            entries, self._entries = list(self._entries.values()), {}
        for entry in entries:
            await _kill(entry.session)

    async def _reap(self) -> None:
        """Close anything idle. Called on acquire, so it needs no timer."""
        now = time.monotonic()
        stale = [
            key for key, entry in self._entries.items()
            if now - entry.last_used > IDLE_TIMEOUT
        ]
        for key in stale:
            entry = self._entries.pop(key)
            log.info('closing an idle browser (%ds)', int(now - entry.last_used))
            await _kill(entry.session)


def _alive(session: BrowserSession) -> bool:
    """
    Whether this session is still usable.

    Asked of the object rather than assumed, because the owner can close the
    window at any moment and a pool that hands out a dead session turns one
    closed window into every subsequent task failing.
    """
    for attribute in ('is_running', 'initialized', '_started'):
        value = getattr(session, attribute, None)
        if isinstance(value, bool):
            return value
    return True


async def _kill(session: BrowserSession) -> None:
    try:
        await session.kill()
    except Exception:  # noqa: BLE001 - a browser that will not close is not fatal
        log.debug('a browser session did not close cleanly', exc_info=True)


# One per agent-server process. The profile lock is per machine, and this
# process is the only thing in Dex that opens browsers.
POOL = SessionPool()
