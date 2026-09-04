"""
The browser survives the owner signing in.

    python tests/test_browser_session.py

The failure this pins, from browser.log, in order:

    wall: password at https://vtop.vit.ac.in/vtop/login
    Agent run failed with exception: password
    on_BrowserStopEvent - Calling reset() (force=True, keep_alive=None)
    [SessionManager] Cleared all owned data (targets, sessions, mappings)
    owner cleared the wall - resuming
    Result failed 1/3: Expected at least one handler to return a non-None result
    Result failed 2/3: ...
    Stopping due to 2 consecutive failures

Dex stops the agent at a password so the owner can type it themselves — it
never types one. Stopping ends the agent run, and browser_use then resets the
session, which throws away every target it owns. The owner types the password,
Dex resumes on the same session, and there is nothing there: three empty
browser-state requests and the run gives up.

From the outside it looked like Dex closed the browser the moment you finished
signing in, which is the one moment it must not.

`keep_alive` on the browser profile is what browser_use checks before closing
(agent/service.py: `if not self.browser_session.browser_profile.keep_alive`),
so setting it is the difference between a session that outlives one agent run
and one that does not. Dex's is pooled and reused by design, so it must.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agents' / 'browser'))

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = '') -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f'  ok    {name}')
    else:
        failed += 1
        print(f'  FAIL  {name}' + (f' -- {detail}' if detail else ''))


print('the browser session outlives one agent run')

import browser_choice  # noqa: E402
import session_pool  # noqa: E402
from browser_use import BrowserSession  # noqa: E402

# What the pool would build, without launching anything.
kwargs = browser_choice.session_kwargs(None, True)
kwargs['accept_downloads'] = True
kwargs['downloads_path'] = session_pool.downloads_dir()
kwargs['keep_alive'] = True

session = BrowserSession(**kwargs)

check(
    'keep_alive reaches the browser profile',
    getattr(session.browser_profile, 'keep_alive', None) is True,
    str(getattr(session.browser_profile, 'keep_alive', 'MISSING')),
)

# It lives on the profile, not the session. Passing it and assuming it stuck
# on the object it was passed to is how this would silently stop working.
check(
    'and it is the profile, not the session, that carries it',
    getattr(session, 'keep_alive', None) is None,
)

untouched = BrowserSession()
check(
    'the default really is off, so this is not a no-op',
    getattr(untouched.browser_profile, 'keep_alive', None) is None,
)

# The pool has to actually set it. A test that only proves the library accepts
# the flag would pass with the line deleted from session_pool.py.
source = (Path(__file__).resolve().parents[1]
          / 'agents' / 'browser' / 'session_pool.py').read_text(encoding='utf-8')
check(
    "the pool sets it when it builds a session",
    "kwargs['keep_alive'] = True" in source,
)
check(
    'and says why, because a bare flag here reads like a tuning knob',
    'reset' in source and 'wall' in source,
)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
