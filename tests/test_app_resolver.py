"""
Finding an application to launch.

    npm run test:apps

These are checks against the real machine, not against fixtures, because the
bug being fixed was entirely about what this machine actually contains. The
original failure:

    open chrome  ->  [WinError 2] The system cannot find the file specified

Chrome is installed. It is simply not on PATH, because no browser installer
puts itself there. It is in the App Paths registry key, which is what
`start chrome` reads and what Dex never looked at.

A fixture would have passed while the real thing failed, so where a check
depends on software being installed it says so and skips rather than pretending.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from daemon.handlers.app_handler import ANY_BROWSER, KNOWN, _first_installed_browser
from daemon.handlers.app_resolver import (
    AppNotFound,
    app_paths_lookup,
    path_lookup,
    resolve,
    start_menu_index,
)

failures = 0
skipped = 0


def check(label: str, ok: bool, detail: str = '') -> None:
    global failures
    if ok:
        print(f'ok   {label}')
    else:
        failures += 1
        print(f'FAIL {label}' + (f': {detail}' if detail else ''))


def skip(label: str, why: str) -> None:
    global skipped
    skipped += 1
    print(f'skip {label} — {why}')


# ---------------------------------------------------------------------------
# PATH, which is all Dex used to do
# ---------------------------------------------------------------------------

notepad = path_lookup('notepad')
check('PATH finds notepad', notepad is not None and os.path.isfile(notepad), str(notepad))
check('PATH finds it without being told the extension', str(notepad).lower().endswith('.exe'))
check('PATH does not find chrome', path_lookup('chrome') is None,
      'if this fails the machine changed, not the code')

# ---------------------------------------------------------------------------
# App Paths — the step that was missing
# ---------------------------------------------------------------------------

chrome = app_paths_lookup('chrome')
if chrome is None:
    skip('App Paths finds chrome', 'Chrome is not installed')
else:
    check('App Paths finds chrome where PATH cannot', os.path.isfile(chrome), chrome)
    check('and it is the real browser, not a stub',
          chrome.lower().endswith('chrome.exe'), chrome)

edge = app_paths_lookup('msedge')
if edge is None:
    skip('App Paths finds msedge', 'Edge is not installed')
else:
    check('App Paths finds msedge', os.path.isfile(edge), edge)

check('App Paths tolerates a name that already has .exe',
      app_paths_lookup('chrome.exe') == app_paths_lookup('chrome'))
check('App Paths returns None for something absent',
      app_paths_lookup('definitely-not-installed-xyz') is None)

# ---------------------------------------------------------------------------
# Start Menu — how a display name like "Microsoft Edge" is found
# ---------------------------------------------------------------------------

shortcuts = start_menu_index()
check('the Start Menu index is populated', len(shortcuts) > 5, f'{len(shortcuts)} found')

if 'microsoft edge' in shortcuts:
    display, target = shortcuts['microsoft edge']
    check('"Microsoft Edge" is indexed under its display name', display == 'Microsoft Edge')
    check('and points at a shortcut we can hand to the shell',
          target.lower().endswith(('.lnk', '.url')), target)
else:
    skip('Start Menu has Microsoft Edge', 'no such shortcut on this machine')

# ---------------------------------------------------------------------------
# The resolver end to end
# ---------------------------------------------------------------------------

result = resolve('notepad', KNOWN)
check('resolves notepad', os.path.isfile(result.target), result.target)

if chrome:
    result = resolve('chrome', KNOWN)
    check('resolves chrome — the original failure', os.path.isfile(result.target), result.target)
    check('and says how it found it', result.method in ('known', 'app_paths'), result.method)

    result = resolve('Google Chrome', KNOWN)
    check('resolves the display name "Google Chrome"', result.target != '', result.method)

if edge:
    # The exact string the planner chose when it failed.
    result = resolve('Microsoft Edge', KNOWN)
    check('resolves "Microsoft Edge" — the second original failure',
          result.target != '', f'{result.method}: {result.target}')

result = resolve('settings', KNOWN)
check('a shell protocol passes through untouched', result.target == 'ms-settings:')
check('and is marked as needing the shell', result.is_shell)

# ---------------------------------------------------------------------------
# Failure has to be readable — this is half the point of the change
# ---------------------------------------------------------------------------

try:
    resolve('definitely-not-an-app-xyz', KNOWN)
    check('an unknown app raises', False, 'it did not raise')
except AppNotFound as err:
    message = str(err)
    check('an unknown app raises AppNotFound', True)
    check('the message names App Paths', 'App Paths' in message, message)
    check('the message names PATH', 'PATH' in message, message)
    check('the message names the Start Menu', 'Start Menu' in message, message)
    check('the message is not a bare errno',
          'WinError' not in message and 'Errno' not in message, message)

try:
    resolve('chrom', KNOWN)
    skip('a near-miss suggests the real name', 'it resolved instead of failing')
except AppNotFound as err:
    # Not asserted as a hard requirement: whether "chrom" is close enough
    # depends on what is installed. Reported so a regression is visible.
    if err.suggestions:
        check('a near-miss suggests the real name', True)
        print(f'       suggested: {", ".join(err.suggestions)}')
    else:
        skip('a near-miss suggests the real name', 'nothing similar installed')

# ---------------------------------------------------------------------------
# "any browser" — the request that should never fail on this machine
# ---------------------------------------------------------------------------

check('"any browser" phrasings are recognised',
      {'browser', 'any browser', 'web browser'} <= ANY_BROWSER)

try:
    result = _first_installed_browser()
    check('"open any browser" finds one that is actually installed',
          result.target != '', f'{result.method}: {result.target}')
except AppNotFound:
    skip('"open any browser" finds one', 'no browser installed at all')

# ---------------------------------------------------------------------------
# Ambiguity must not be guessed
# ---------------------------------------------------------------------------

from daemon.handlers.app_resolver import _fuzzy_hit  # noqa: E402

ambiguous = {
    'microsoft word': ('Microsoft Word', 'word.lnk'),
    'microsoft wordpad': ('Microsoft WordPad', 'wordpad.lnk'),
}
check('two candidates are refused rather than guessed between',
      _fuzzy_hit('microsoft w', ambiguous) is None,
      'opening the wrong application looks like success')
check('one candidate is accepted',
      _fuzzy_hit('microsoft word', ambiguous) is not None)

print()
if failures:
    print(f'{failures} check(s) failed.')
    sys.exit(1)
print(f'PASSED  application resolution works ({skipped} skipped).')
