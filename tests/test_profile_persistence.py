"""
Dex's browser stays signed in.

    python tests/test_profile_persistence.py

The point of the profile is that the owner signs in to Instagram, GitHub and
VTOP once and Dex can then act as them. That never worked, for a reason that
had nothing to do with cookies: `--user-data-dir=…` was passed as a launch
*argument*, and browser_use ignores it there. Every session ran in

    C:\\Users\\…\\Temp\\browser-use-user-data-…

a fresh directory each time. So every task started signed out of everything,
and signing in during one task was forgotten by the next.

This drives a real browser twice, setting a cookie in the first session and
looking for it in the second. Nothing here touches a real account: the cookie
is set on a local page, because what is under test is whether the profile
persists, not whether Instagram works.
"""
from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
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


async def main() -> int:
    import browser_choice as bc

    print('the browser profile keeps what it is given')

    kwargs = bc.session_kwargs(None, True)

    check(
        'user_data_dir is a field, not a launch argument',
        'user_data_dir' in kwargs,
        'browser_use ignores --user-data-dir in args; that is the whole bug',
    )
    check(
        'and no stale copy is left in the arguments',
        not any('user-data-dir' in a for a in kwargs['args']),
        str([a for a in kwargs['args'] if 'user-data-dir' in a]),
    )
    check(
        'it points at Dex own profile',
        'DEX' in str(kwargs['user_data_dir']),
        str(kwargs['user_data_dir']),
    )
    check(
        'and the session does not announce itself as automated',
        any('AutomationControlled' in a for a in kwargs['args']),
        'sites degrade or block a session that does, and Chrome turns off its '
        'own password manager',
    )

    # The real thing: a cookie set in one session, found in the next.
    scratch = tempfile.mkdtemp(prefix='dex-profile-test-')
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            first = await p.chromium.launch_persistent_context(scratch, headless=True)
            page = await first.new_page()
            await page.goto('data:text/html,<title>one</title>')
            # With an expiry. A cookie without one is a *session* cookie and
            # is supposed to vanish when the browser closes — the first
            # version of this test used one and then blamed the profile. Real
            # login cookies have expiries, which is why signing in lasts.
            import time as _time
            await first.add_cookies([{
                'name': 'dex_signed_in',
                'value': 'yes',
                'domain': '127.0.0.1',
                'path': '/',
                'expires': _time.time() + 86400,
            }])
            await first.close()

            second = await p.chromium.launch_persistent_context(scratch, headless=True)
            names = [c['name'] for c in await second.cookies()]
            await second.close()

        check(
            'a login set in one session is there in the next',
            'dex_signed_in' in names,
            f'cookies found: {names}',
        )
    except Exception as exc:  # noqa: BLE001
        check('a login set in one session is there in the next', False, str(exc))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    print(f'\n{passed} passed, {failed} failed')
    return 1 if failed else 0


sys.exit(asyncio.run(main()))
