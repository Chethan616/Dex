"""
Which browser to drive, and where its profile lives.

Two things the browser agent could not do, and they turn out to be the same
change.

**Use a named browser.** `BrowserSession(headless=...)` and nothing else meant
Playwright's own bundled Chromium, always. Asked to "open Vivaldi and go to
instagram", Dex had no way to honour the first half. The installed
`browser_use` accepts `executable_path`, so the fix is to resolve the name to a
path — and the resolver for that already exists in the daemon, doing exactly
the five-step search Windows itself does. Nothing here hardcodes a browser: a
name that is not installed fails saying so, and a new Chromium browser works on
the day it is installed.

**Stay signed in.** Playwright's default is a fresh profile every launch, so
every task started logged out of everything. That is why "message myself on
Instagram" could not work: there was no session, and Dex will not type a
password to make one. A persistent profile directory fixes it — sign in once,
by hand, in Dex's window, and it is still signed in tomorrow.

The profile is **Dex's own**, deliberately not the owner's real browser
profile. Pointing at their live Vivaldi would mean Dex driving a browser
already logged into their bank and their email, where a page it reads could try
to steer it. Its own profile contains only what was signed into for Dex to use,
which is a blast radius the owner chooses one site at a time.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

log = logging.getLogger('BrowserChoice')

# Chromium-family only. Playwright drives these through CDP; Firefox and Safari
# speak different protocols and would fail in a confusing way partway through a
# task rather than at the start.
CHROMIUM_FAMILY = {
    'chrome', 'chromium', 'msedge', 'edge', 'brave', 'vivaldi', 'opera',
    'operagx', 'arc', 'thorium', 'ungoogled-chromium',
}

NOT_CHROMIUM = {
    'firefox': 'Firefox',
    'librewolf': 'LibreWolf',
    'safari': 'Safari',
    'waterfox': 'Waterfox',
    'zen': 'Zen',
}


def profile_dir(browser: str | None = None) -> str:
    """
    Dex's own browser profile, one per browser.

    Beside the logs and the settings, in %LOCALAPPDATA%\\DEX, so everything Dex
    keeps about itself is in one place the owner can inspect or delete.

    **One directory per browser, not one overall.** Chromium allows a single
    process per profile directory, so a Chromium session holding this path made
    a later Vivaldi launch sit on the lock until it timed out — the "open
    vivaldi and go to instagram" failure, which took a minute and forty seconds
    to say nothing useful.

    Separate directories also mean Dex's Vivaldi and the owner's Vivaldi are
    different processes with different profiles, so both run at once and Dex is
    signed in only to what the owner signed *Dex* into.
    """
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('USERPROFILE') or '.'
    path = Path(base) / 'DEX' / 'browser-profile' / _profile_leaf(browser)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _profile_leaf(browser: str | None) -> str:
    """
    A directory name from a browser name.

    `default` for Playwright's own Chromium. Anything else is reduced to safe
    characters, because the name reaches here from a plan and could be a path.
    """
    name = (browser or '').strip().lower()
    if not name:
        return 'default'
    if os.path.sep in name or name.endswith('.exe'):
        name = Path(name).stem
    safe = ''.join(c if c.isalnum() else '-' for c in name).strip('-')
    return safe or 'default'


def resolve(name: str | None) -> str | None:
    """
    A browser name to an executable path, or None for Playwright's own.

    Accepts a path directly, so an unusual install can be named exactly. Raises
    for a browser that exists but cannot be driven, because "Firefox is not
    something Dex can drive" is a better answer than silently using Chromium
    and reporting success.
    """
    if not name:
        return None

    wanted = str(name).strip()
    if not wanted:
        return None

    # An explicit path wins, and is checked rather than trusted.
    if os.path.sep in wanted or wanted.lower().endswith('.exe'):
        if os.path.exists(wanted):
            return wanted
        raise ValueError(f'No browser at {wanted}')

    key = wanted.lower().replace(' ', '').replace('-', '')
    if key in NOT_CHROMIUM:
        raise ValueError(
            f'Dex drives Chromium-based browsers. {NOT_CHROMIUM[key]} uses a '
            'different automation protocol. Chrome, Edge, Vivaldi, Brave and '
            'Opera all work.'
        )

    path = _find(wanted)
    if path is None:
        raise ValueError(
            f'{wanted} does not appear to be installed. Dex looked in the App '
            'Paths registry, on PATH, and in the Start Menu.'
        )

    if key not in CHROMIUM_FAMILY:
        # Found, but unknown. Say so and use it: the family list is a
        # convenience, not a permission, and refusing something the owner
        # installed on the grounds that it is not on a list is unhelpful.
        log.info('%s is not a browser Dex knows; trying it as Chromium.', wanted)

    return path


def _find(name: str) -> str | None:
    """
    The daemon's resolver, reused.

    Imported lazily and by path because this process is an agent, not the
    daemon, and the two are separate services that happen to live in one tree.
    A duplicate copy of the App Paths search here would be a second answer to
    "where is Vivaldi", and this project has been bitten by second answers.
    """
    daemon = Path(__file__).resolve().parents[2] / 'daemon'
    if str(daemon) not in sys.path:
        sys.path.insert(0, str(daemon))

    try:
        from handlers import app_resolver  # type: ignore
    except Exception as exc:  # noqa: BLE001
        log.debug('resolver unavailable: %s', exc)
        return None

    try:
        found = app_resolver.resolve(name)
    except Exception:  # noqa: BLE001 - AppNotFound, and anything else
        return None

    # A Store app or a shell protocol has no executable Playwright can launch.
    if found.is_shell or not os.path.exists(found.target):
        return None
    return found.target


def session_kwargs(browser: str | None, headless: bool) -> dict:
    """
    What to hand `BrowserSession`, for a named browser with a kept profile.

    `--user-data-dir` rather than a Playwright persistent context: Dex launches
    a real browser binary, and that flag is how a real Chromium is told where
    its profile lives. The two remaining flags are not optional —
    `--no-first-run` suppresses the welcome tab that would otherwise be the
    page every task starts on, and `--no-default-browser-check` suppresses the
    modal that sits on top of it.
    """
    kwargs: dict = {
        'headless': headless,
        'args': [
            f'--user-data-dir={profile_dir(browser)}',
            '--no-first-run',
            '--no-default-browser-check',
        ],
    }

    executable = resolve(browser)
    if executable:
        kwargs['executable_path'] = executable

    return kwargs
