"""
What the browser loop is told it already knows.

The owner's words: "its lacking the knowledge like where the buttons will be for
example status bar on github will not be in settings -> profile it will just be
in profile like those things dont hardcode or tell it it should gain the
knowledge make it plan correctly."

Nothing was hardcoded. What was missing is that Dex already *had* the knowledge
— `SiteRouteStore` learns a route from any run that worked, scores it, and
forgets it after two failures — and the extension loop was never given it. So
every run rediscovered the same site from scratch.

Two things are checked here:

  the knowledge arrives   a learned route is stated to the loop, as a hint with
                          the instruction to check it still holds.
  it is not restated      a section that has not changed renders as nothing.
                          This is the part borrowed from Codex's world state,
                          and it is what keeps a twenty-turn run affordable.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agents' / 'browser'))

import world_state  # noqa: E402

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


def main() -> None:
    print('\nwhat is true')

    world = world_state.WorldState()
    world.set('goal', 'change my github status')
    world.browser(26, 'Chethankrishna')
    world.page('https://github.com/me', 'me (Owner)')

    first = world.render(full=True)
    check('the goal is stated', 'change my github status' in first, first)
    check('the browser is stated, with whose it is',
          'Chethankrishna' in first and '26 tools' in first, first)
    check('and the page it is on, so the loop need not ask',
          'https://github.com/me' in first, first)

    print('\nonly what changed')

    again = world.render()
    check('nothing changed, so nothing is said', again == '', repr(again))

    world.page('https://github.com/settings/profile', 'Your profile')
    moved = world.render()
    check('a new page is reported', 'settings/profile' in moved, moved)
    check('and the browser is not restated with it',
          'Chethankrishna' not in moved, moved)

    print('\nafter a compaction')

    world.forget_what_was_shown()
    everything = world.render()
    check('everything is said again, because the turns carrying it are gone',
          'Chethankrishna' in everything and 'settings/profile' in everything,
          everything)

    print('\nknowledge from a run that worked')

    world = world_state.WorldState()
    world.known({
        'origin': 'github.com',
        'goal': 'change status',
        'steps': [
            {'text': 'open the profile menu'},
            {'text': 'click "Set status"'},
        ],
    })
    told = world.render(full=True)
    check('a learned route is handed to the loop',
          'Set status' in told, told)
    check('as a hint, not a certainty',
          'still exists' in told.lower(), told)

    world = world_state.WorldState()
    world.known(None)
    world.known({'steps': []})
    check('and nothing is invented when there is no route',
          world.render(full=True) == '', repr(world.render(full=True)))

    print('\nwhat has been done')

    world = world_state.WorldState()
    for n in range(12):
        world.did(f'action {n}')
    done = world.snapshot()['done']
    check('the recent actions are kept, not all of them',
          done.count('·') == 8, done)
    check('and it is the recent ones', 'action 11' in done and 'action 0' not in done, done)

    print('\nreading a page out of a tool result')

    url, title = world_state.page_of({'url': 'https://x.com/home', 'title': 'Home'})
    check('a direct url is found', url == 'https://x.com/home' and title == 'Home')

    url, _ = world_state.page_of({'tabs': [
        {'active': False, 'url': 'https://other.com'},
        {'active': True, 'url': 'https://github.com'},
    ]})
    check('and the active tab when the result is a tab list',
          url == 'https://github.com', url)

    check('a result that says nothing yields nothing',
          world_state.page_of('some text') == ('', ''))

    print(f'\n{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  the loop is told what it knows, and told it once.')


if __name__ == '__main__':
    main()
