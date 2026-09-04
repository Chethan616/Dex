"""
The deterministic web verbs, translated into the owner's browser.

The defect this covers: `/primitive` went straight to Dex's own Playwright
browser every time and never asked which browser should answer. `/run-task`
consulted the routing rule; this tier did not. So every navigate, click and
read_page in every plan ran in a browser signed in to nothing and read the
logged-out version of the page with complete confidence.

Two things are checked here and they are the two that matter:

  coverage    every verb the planner can ask for has an owner-browser
              equivalent, or is absent for a stated reason. A verb that quietly
              falls through is the original bug wearing a different hat.
  verify      a verification never falls back. Checking "the pin is gone"
              against a different browser passes trivially, because the profile
              is not visible there at all — and the Reliability Layer trusts
              what it is told.

No browser is launched. The bridge is replaced with a recorder, so what is
asserted is the translation itself rather than whether a page happened to load.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agents' / 'browser'))
sys.path.insert(0, str(ROOT / 'agents'))

import owner_primitives  # noqa: E402

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


class Recorder:
    """Stands in for the extension. Records what was asked and answers plainly."""

    def __init__(self, answers: dict | None = None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.answers = answers or {}
        self.attached = True

    async def call(self, method: str, params: dict) -> object:
        self.calls.append((method, params))
        if method in self.answers:
            return self.answers[method]
        return {}

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


def req(**kwargs):
    """A PrimitiveRequest, as far as this module is concerned."""
    base = dict(
        url=None, selector=None, text=None, path=None, full_page=None,
        verify=None, browser=None, goal=None, fields=None, submit=None,
        timeout=None, idle=None, which=None,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


ANALYSIS = {
    'elements': [
        {'id': 'el_1', 'text': 'Compress PDF', 'selector': 'button.compress'},
        {'id': 'el_7', 'text': 'Select PDF file', 'selector': 'input.file'},
        {'id': 'el_9', 'text': 'Download compressed PDF'},
    ],
}
TABS = {'tabs': [{'active': True, 'url': 'https://example.com/p', 'title': 'A page'}]}
CONTENT = {'content': 'the text of the page, and the word qwox in it'}


async def main() -> None:
    print('\ncoverage')

    # Every verb /primitive dispatches, from its own docstring.
    verbs = [
        'navigate', 'read', 'click', 'type', 'extract', 'screenshot', 'verify',
        'sign_in', 'download_current', 'map_page', 'page_model', 'fill_form',
        'click_text', 'wait_for', 'extract_table', 'scroll', 'press_key',
        'go_back', 'reload',
    ]
    absent = [v for v in verbs if v not in owner_primitives._HANDLERS]
    check(
        'only sign_in has no owner-browser equivalent',
        absent == ['sign_in'],
        f'also missing: {absent}',
    )
    check(
        'and an unknown verb raises rather than silently using the wrong browser',
        isinstance(
            await _raises(owner_primitives.run('nonsense', req())),
            owner_primitives.Unsupported,
        ),
    )

    print('\nreading')

    bridge = Recorder({'tab_list': TABS, 'page_extract_content': CONTENT})
    owner_primitives.bridge = bridge
    page = await owner_primitives.run('navigate', req(url='https://example.com/p'))
    check('navigate goes through the extension', 'page_navigate' in bridge.names())
    check('and answers with the page it landed on',
          page['url'] == 'https://example.com/p' and 'qwox' in page['text'],
          str(page))

    print('\nacting')

    bridge = Recorder({'page_analyze': ANALYSIS})
    owner_primitives.bridge = bridge
    clicked = await owner_primitives.run('click', req(selector='Compress PDF'))
    check('a click is resolved through the page analysis',
          'page_analyze' in bridge.names(), str(bridge.names()))
    check('and uses the trusted click, not the synthetic one',
          'element_click_trusted' in bridge.names(), str(bridge.names()))
    check('on the element whose text matched',
          clicked['clicked'] == 'el_1', str(clicked))

    bridge = Recorder({'page_analyze': ANALYSIS})
    owner_primitives.bridge = bridge
    missed = await _raises(owner_primitives.run('click', req(selector='Delete everything')))
    check('something that is not on the page is an error, not a wrong click',
          isinstance(missed, ValueError), repr(missed))
    check('and the error says what the page does offer',
          'Compress PDF' in str(missed), str(missed))

    print('\nverification stays in the browser the step ran in')

    bridge = Recorder({'tab_list': TABS, 'page_extract_content': CONTENT})
    owner_primitives.bridge = bridge
    spec = SimpleNamespace(model_dump=lambda: {'text_on_page': 'qwox'})
    result = await owner_primitives.run('verify', req(verify=spec))
    check('a check that holds passes', result['passed'] is True, str(result))

    spec = SimpleNamespace(model_dump=lambda: {'text_on_page': 'not on this page'})
    result = await owner_primitives.run('verify', req(verify=spec))
    check('a check that does not hold fails', result['passed'] is False, str(result))

    result = await owner_primitives.run('verify', req(verify=None))
    check('an empty spec is not success - nobody said what success looks like',
          result['passed'] is False, str(result))

    print('\ndownloads')

    bridge = Recorder({'page_download_to': {
        'downloaded': True, 'directory': str(ROOT), 'file': 'x.pdf',
        'suggested_name': 'aadhar_compressed.pdf',
    }})
    owner_primitives.bridge = bridge
    got = await owner_primitives.run('download_current', req(path=str(ROOT)))
    check('a download reports the file Chrome actually wrote',
          got['downloaded'] is True and got['name'] == 'aadhar_compressed.pdf',
          str(got))
    check('and a path a later step can point at',
          got['path'].endswith('x.pdf'), got['path'])

    print(f'\n{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  the web verbs run in the browser the owner is signed into.')


async def _raises(coro):
    try:
        await coro
    except Exception as exc:  # noqa: BLE001 - the exception is the assertion
        return exc
    return None


if __name__ == '__main__':
    asyncio.run(main())
