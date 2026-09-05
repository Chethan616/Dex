"""
One browser per task, not one per step.

The defect, from the owner: "when i say open github and change my status it
opens github.com which is good but for the next plan it opens new chrome window
and fails."

Traced in `%LOCALAPPDATA%\\DEX\\browser.log`:

    12:33:56  bridge: browser attached with 26 tools
    12:34:26  bridge: the browser disconnected          <- exactly 30s later
    12:36:11  [step_2] opened Chethankrishna, waiting for the extension

Chrome terminates an idle MV3 service worker at thirty seconds. The extension
had keepalive and reconnect both switched off on Chrome, so the bridge died and
never came back. Step two saw nothing attached and launched `chrome.exe
--profile-directory=...` with **no URL** — which, against a running Chrome, is
the command for a new empty window. Then it waited fifteen seconds for an
extension that could not possibly arrive, and failed.

The extension side is fixed in `background.js`. This covers the other half: the
session that decides whether a browser needs opening at all.

Nothing here launches Chrome. The process list and the bridge are both replaced,
so what is asserted is the decision, not the browser.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agents' / 'browser'))
sys.path.insert(0, str(ROOT / 'agents'))

import owner_session  # noqa: E402

passed = 0
failed = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok   {name}')
    else:
        failed += 1
        print(f'  FAIL {name}' + (f' -- {detail}' if detail else ''))


PROFILE = {
    'directory': 'Profile 1',
    'name': 'Chethankrishna',
    'email': 'owner@example.com',
    'user_data_dir': r'C:\Users\x\AppData\Local\Google\Chrome\User Data',
    'last_used': True,
}


class FakeBridge:
    def __init__(self, attached: bool = False) -> None:
        self.attached = attached


class Launches:
    """Records what would have been launched, and launches nothing."""

    def __init__(self, attaches: bool = True) -> None:
        self.calls: list[tuple[str | None, str]] = []
        self.attaches = attaches
        self.bridge: FakeBridge | None = None

    def __call__(self, profile_match, url):
        self.calls.append((profile_match, url))
        if self.attaches and self.bridge is not None:
            # The extension dials in, as it would after a cold start.
            self.bridge.attached = True
        return {
            'ok': True,
            'profile': PROFILE['name'],
            'email': PROFILE['email'],
            'directory': PROFILE['directory'],
            'detail': f'Opened Chrome as {PROFILE["name"]}.',
        }


def wire(*, running: bool, attaches: bool, attached_now: bool = False):
    """A fresh session with the world in a stated state."""
    session = owner_session.OwnerSession()
    bridge = FakeBridge(attached_now)
    launches = Launches(attaches)
    launches.bridge = bridge

    owner_session.bridge = bridge
    owner_session.browser_choice.open_owner_browser = launches
    owner_session.browser_choice.owner_profile = lambda match='': PROFILE
    owner_session._chrome_command_lines = lambda: (
        ['chrome.exe --profile-directory=Profile 1 --flag'] if running else []
    )
    # No real waiting in a test; the decision is what is under test.
    owner_session.ATTACH_POLL_S = 0.001
    return session, bridge, launches


async def main() -> None:
    print('\nnothing running')

    session, bridge, launches = wire(running=False, attaches=True)
    answer = await session.ensure('https://github.com')
    check('Dex opens a browser', len(launches.calls) == 1, str(launches.calls))
    check('on the page the task is about, not a blank tab',
          launches.calls[0][1] == 'https://github.com',
          repr(launches.calls[0][1]))
    check('and reports it attached', answer['attached'] is True, str(answer))

    print('\nChrome already running for that profile')

    session, bridge, launches = wire(running=True, attaches=False)
    bridge.attached = True  # the extension is alive in the window that is open
    answer = await session.ensure('https://github.com')
    check('nothing is launched', launches.calls == [], str(launches.calls))
    check('and the browser that is there is used', answer['attached'] is True, str(answer))

    print('\nthe second window, which is the bug')

    # Chrome running, extension not attached: exactly the state step 2 was in.
    session, bridge, launches = wire(running=True, attaches=False)
    session._wait_for_extension = _never
    answer = await session.ensure('')
    check('Dex does NOT launch another Chrome over a running one',
          launches.calls == [], str(launches.calls))
    check('and says what is actually wrong',
          'extension' in answer['detail'].lower(), answer['detail'])

    print('\nasking again in the same task')

    before = len(launches.calls)
    second = await session.ensure('')
    third = await session.ensure('')
    check('a failure is remembered, not re-discovered every step',
          len(launches.calls) == before, str(launches.calls))
    check('and every step gets the same answer',
          second['detail'] == third['detail'] == answer['detail'])

    print('\na new task')

    session.note_task_start()
    session._wait_for_extension = _always
    fresh = await session.ensure('')
    check('what the last task learned stops applying',
          fresh['attached'] is True, str(fresh))

    print('\nalready attached')

    session, bridge, launches = wire(running=False, attaches=True, attached_now=True)
    answer = await session.ensure('https://github.com')
    check('nothing is opened when a browser is already attached',
          launches.calls == [], str(launches.calls))
    check('and it says so', answer['attached'] is True, str(answer))

    print('\nreading the process list')

    owner_session._chrome_command_lines = lambda: ['chrome.exe --profile-directory=Profile 7']
    check('a different profile does not count as this one',
          owner_session.OwnerSession.running_profile() is None)
    owner_session._chrome_command_lines = lambda: ['chrome.exe --profile-directory=Profile 1']
    check('the right profile does',
          (owner_session.OwnerSession.running_profile() or {}).get('directory') == 'Profile 1')

    print(f'\n{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  one browser per task, opened once, on the right page.')


async def _never(_tries: int) -> bool:
    return False


async def _always(_tries: int) -> bool:
    return True


if __name__ == '__main__':
    asyncio.run(main())
