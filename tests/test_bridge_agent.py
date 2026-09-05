"""
The loop that drives the owner's browser.

Two things it used to get wrong, both about memory:

  it forgot how it started   The prompt carried history[-12:] and nothing else.
                             A task longer than twelve turns lost its own
                             beginning, and a loop that cannot remember what it
                             already tried tries it again. That is what "going
                             in circles" looked like from the outside.
  it said nothing about
  what it changed            The result was a sentence, so a verification had
                             nothing to test and graded every un-hinted run
                             UNVERIFIABLE.

No browser and no model: the bridge and the model are both replaced, so what is
asserted is the loop's own behaviour.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agents' / 'browser'))

import bridge_agent  # noqa: E402

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


class FakeBridge:
    attached = True
    ready = True

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def tools(self):
        return [{'name': n} for n in (
            'page_analyze', 'page_navigate', 'element_click_trusted',
            'element_fill', 'debugger_detach',
        )]

    async def call(self, method, params):
        self.calls.append((method, params))
        if method == 'page_analyze':
            return {'url': 'https://github.com/me', 'title': 'me'}
        return {'ok': True}


class Model:
    """Answers with a scripted sequence, and records every prompt it saw."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.prompts: list[str] = []

    async def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if not self.answers:
            return json.dumps({'done': True, 'answer': 'finished'})
        return self.answers.pop(0)


def click(n):
    return json.dumps({'tool': 'element_click_trusted',
                       'params': {'element_id': f'el_{n}'}, 'why': 'x'})


async def main() -> None:
    bridge_agent.bridge = FakeBridge()

    print()
    print('what it reports')

    model = Model([click(1), json.dumps({'done': True, 'answer': 'status changed'})])
    result = await bridge_agent.run('change my github status', model)

    check('it finishes', result['success'] is True, str(result))
    check('and says what it changed, so a verification has something to test',
          result['changed'] and 'element_click_trusted' in result['changed'][0],
          str(result.get('changed')))
    check('and where it went',
          result['visited'] == [] or isinstance(result['visited'], list),
          str(result.get('visited')))

    print()
    print('what it knows before it starts')

    model = Model([json.dumps({'done': True, 'answer': 'ok'})])
    await bridge_agent.run(
        'change my github status', model,
        route={'origin': 'github.com', 'goal': 'change status',
               'steps': [{'text': 'open the profile menu'}]},
        profile='Chethankrishna',
    )
    first = model.prompts[0]
    check('the task is in the prompt', 'change my github status' in first)
    check('so is whose browser it is', 'Chethankrishna' in first, first[:200])
    check('and what a previous run found out here',
          'open the profile menu' in first, first[:400])

    print()
    print('a long run remembers how it began')

    # Twenty clicks, then done. Longer than the old twelve-line window.
    model = Model([click(n) for n in range(20)])
    result = await bridge_agent.run('a long task', model)

    last = model.prompts[-1]
    check('it ran to the step limit', len(model.prompts) >= bridge_agent.MAX_STEPS - 1,
          str(len(model.prompts)))
    check('the goal is still in the last prompt', 'a long task' in last)
    check('the older turns were summarised rather than dropped',
          'Earlier, in short' in last, last[-600:])
    check('and the prompt stayed bounded',
          len(last) < 6000, str(len(last)))

    print()
    print('compaction that cannot happen')

    async def refuses(_prompt):
        raise RuntimeError('no model today')

    recap = await bridge_agent._compact(['  [1] did a thing'], 'the story so far', refuses)
    check('keeps the previous summary rather than failing the run',
          recap == 'the story so far', recap)

    long_lines = ['  [1] x']
    async def rambles(_prompt):
        return 'a summary very much longer than the thing it claims to summarise ' * 5
    recap = await bridge_agent._compact(long_lines, '', rambles)
    check('and refuses a summary longer than its input', recap == '', repr(recap))

    print()
    print(f'{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  the loop knows where it is and remembers how it got there.')


if __name__ == '__main__':
    asyncio.run(main())
