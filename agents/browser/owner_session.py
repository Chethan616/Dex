"""
The browser this task is using.

There was no such thing, and that absence is the bug the owner reported: "when
i say open github and change my status it opens github.com which is good but
for the next plan it opens new chrome window and fails."

Phase 6 gave every browser step the ability to open the owner's Chrome. It did
not give them a way to share one. So a two-step web plan asked twice, and the
second ask launched `chrome.exe --profile-directory=...` again — which, against
a Chrome that is already running, is the command for "give me a new empty
window". Then it waited fifteen seconds for an extension that was already
either attached or not, and failed. Every later browser step repeated it.

**Create or reuse, never respawn.** This is the shape Codex's `unified_exec`
uses for interactive processes: the model gets a handle to a live process and
writes to it again, rather than spawning a new one per call. A browser is the
same kind of thing — expensive to start, stateful, and the owner is looking at
it.

So one object owns the answer to "is there a browser, and can Dex reach it",
and everything that used to launch Chrome asks this instead. It is a session in
the sense that matters here: scoped to the task, remembering what was already
tried, and never doing the expensive thing twice.

**It never closes the browser.** It is theirs, with their tabs in it. Dex opens
one when there is none and leaves it alone afterwards.
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import time
from typing import Any

import browser_choice
from bridge import bridge

log = logging.getLogger('OwnerSession')

# How long to wait for the extension after opening Chrome.
#
# Cold-starting Chrome plus an MV3 service worker connecting is a few seconds
# here. Fifteen is generous without being a hang the owner watches.
ATTACH_POLL_S = 0.75
ATTACH_TRIES = 20

# A shorter wait when Chrome was already running: the service worker is either
# up or it is not, and there is no browser start to wait through.
ATTACH_TRIES_WARM = 6

# How long a "the extension never attached" answer stays believed.
#
# Long enough that the steps of one task do not each spend the full wait
# rediscovering it, short enough that loading the extension and asking again
# works without restarting Dex.
GAVE_UP_FOR_S = 90.0


class OwnerSession:
    """The owner's browser, as one thing that can be asked for repeatedly."""

    def __init__(self) -> None:
        self._profile: dict | None = None
        self._opened_at: float = 0.0
        self._gave_up_at: float = 0.0
        self._reason: str = ''
        # One caller at a time. Two browser steps arriving together would
        # otherwise both see "not attached" and both launch a window, which is
        # the original bug with extra steps.
        self._lock = asyncio.Lock()

    # ── the one question anything should ask ────────────────────────────────

    async def ensure(self, url: str = '', *, profile_match: str = '') -> dict[str, Any]:
        """
        Make sure there is a browser Dex can act in, and say what happened.

        Returns `{ok, attached, profile, detail, opened}`. `ok` means there is a
        browser; `attached` means the extension is in it and Dex can drive it.
        Those are different questions and conflating them is how a task ends up
        reporting success into a window it cannot touch.
        """
        async with self._lock:
            if bridge.attached:
                return self._answer(True, 'A browser is already attached.', opened=False)

            if self._gave_up_recently():
                # Said once per task, not once per step. The fifteen-second
                # wait and the extra window came from asking again.
                return self._answer(
                    False,
                    self._reason or 'The Dex extension has not attached to your browser.',
                    opened=False,
                )

            running = self.running_profile(profile_match)

            if running is not None:
                # Chrome is already up on this profile. Launching again is
                # exactly what opened the second window — Chromium hands the
                # request to the live instance and it opens a new one.
                log.info('Chrome is already running as %s; not launching another',
                         running.get('name'))
                self._profile = running
                if await self._wait_for_extension(ATTACH_TRIES_WARM):
                    return self._answer(True, f'Using the Chrome you have open as {running["name"]}.',
                                        opened=False)
                return self._give_up(
                    f'Chrome is open as {running["name"]}, but the Dex extension is not '
                    'loaded in it. Load it once from chrome://extensions -> Load unpacked.'
                )

            # Nothing running: open one, on the page the task is about.
            #
            # With no URL, `chrome --profile-directory=X` opens a blank window.
            # Passing the start URL means the browser arrives where the work is
            # rather than needing a navigate step to follow it.
            result = browser_choice.open_owner_browser(profile_match or None, url)
            if not result.get('ok'):
                return self._give_up(str(result.get('error', 'could not open your browser')))

            self._profile = {
                'name': result.get('profile', ''),
                'email': result.get('email', ''),
                'directory': result.get('directory', ''),
            }
            self._opened_at = time.time()
            log.info('opened Chrome as %s, waiting for the extension', result.get('profile'))

            if await self._wait_for_extension(ATTACH_TRIES):
                return self._answer(True, str(result.get('detail', 'Opened your browser.')),
                                    opened=True)

            return self._give_up(
                f'Dex opened Chrome as {result.get("profile")}, but the Dex extension did '
                'not attach. Load it once from chrome://extensions -> Load unpacked.',
                opened=True,
            )

    def note_task_start(self) -> None:
        """
        A new task. Anything learned about the last one stops applying.

        Without this, loading the extension after a failed task would not take
        effect until the give-up window expired, and the owner would reasonably
        conclude it had not worked.
        """
        self._gave_up_at = 0.0
        self._reason = ''

    def status(self) -> dict[str, Any]:
        return {
            'attached': bridge.attached,
            'profile': (self._profile or {}).get('name', ''),
            'opened_by_dex': self._opened_at > 0,
            'gave_up': self._gave_up_recently(),
            'reason': self._reason,
        }

    # ── asking the OS rather than assuming ──────────────────────────────────

    @staticmethod
    def running_profile(profile_match: str = '') -> dict | None:
        """
        The owner's Chrome, if it is already running on the profile Dex wants.

        Asked of the process list rather than inferred: whether a browser is
        open is a fact about the machine, and the previous code simply assumed
        it was not. Matched on `--profile-directory`, because Chrome runs one
        process per profile directory and several profiles can be open at once.
        """
        wanted = browser_choice.owner_profile(profile_match or '')
        if wanted is None:
            return None

        directory = wanted['directory']
        for command in _chrome_command_lines():
            if f'--profile-directory={directory}' in command:
                return wanted
            # Chrome omits the flag for the profile it considers default, so a
            # bare chrome.exe with no profile flag is that one.
            if directory == 'Default' and '--profile-directory=' not in command:
                return wanted
        return None

    # ── internals ───────────────────────────────────────────────────────────

    async def _wait_for_extension(self, tries: int) -> bool:
        for _ in range(tries):
            if bridge.attached:
                return True
            await asyncio.sleep(ATTACH_POLL_S)
        return bridge.attached

    def _gave_up_recently(self) -> bool:
        return self._gave_up_at > 0 and (time.time() - self._gave_up_at) < GAVE_UP_FOR_S

    def _give_up(self, reason: str, opened: bool = False) -> dict[str, Any]:
        self._gave_up_at = time.time()
        self._reason = reason
        return self._answer(False, reason, opened=opened)

    def _answer(self, attached: bool, detail: str, *, opened: bool) -> dict[str, Any]:
        return {
            'ok': attached or opened,
            'attached': attached,
            'opened': opened,
            'profile': (self._profile or {}).get('name', ''),
            'detail': detail,
        }


def _chrome_command_lines() -> list[str]:
    """
    Every running chrome.exe command line.

    WMIC is gone from current Windows, so this uses PowerShell's CIM provider —
    the same thing stop-dex.ps1 relies on. A failure here returns nothing, which
    makes the caller fall through to launching: opening a browser that turns out
    to be redundant is a much smaller error than refusing to open one at all.
    """
    if os.name != 'nt':
        return []

    try:
        finished = subprocess.run(
            [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\")"
                ' | ForEach-Object { $_.CommandLine }',
            ],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log.debug('could not list Chrome processes: %s', exc)
        return []

    return [line for line in (finished.stdout or '').splitlines() if line.strip()]


# One per process, like session_pool.POOL. The browser is a machine-level thing
# and two of these would be two opinions about whether it is open.
SESSION = OwnerSession()
