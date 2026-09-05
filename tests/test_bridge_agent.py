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
    print()
    print('the contract')

    def act(tools, **rest):
        return json.dumps({
            'evaluation_previous_goal': rest.pop('looked_back', 'ok'),
            'memory': rest.pop('memory', 'on the page'),
            'next_goal': 'do the thing',
            'action': [{'tool': t, 'params': p} for t, p in tools],
            **rest,
        })

    # Several actions in one turn. This is the difference between eighteen
    # model calls and five, and at ~5.5s a call it is the two minutes the owner
    # spends watching a task.
    bridge_agent.bridge = FakeBridge()
    model = Model([
        act([('page_analyze', {}), ('element_click_trusted', {'element_id': 'el_1'})]),
        json.dumps({'done': True, 'success': True, 'answer': 'unpinned',
                    'verified_by': 'the profile now shows 5 pins'}),
    ])
    result = await bridge_agent.run('unpin qwix', model)
    check('a turn can run several actions',
          len(result['steps']) == 2, str(len(result['steps'])))
    check('in two model calls, not four',
          len(model.prompts) == 2, str(len(model.prompts)))
    check('and success carries the evidence for it',
          result['success'] is True and 'pins' in result['verified_by'],
          str(result.get('verified_by')))

    # A run that could not do it says so. This is the one that matters: the old
    # loop returned success because the model stopped talking.
    bridge_agent.bridge = FakeBridge()
    model = Model([json.dumps({
        'done': True, 'success': False,
        'answer': 'Qwix is not among the pinned repositories.',
        'verified_by': '',
    })])
    result = await bridge_agent.run('unpin qwix', model)
    check('a run that failed reports failure, not success',
          result['success'] is False, str(result))
    check('and says what it found instead',
          'not among' in result.get('error', ''), str(result.get('error')))

    # Going round in circles. Three identical attempts and it is told to stop
    # repeating - while it still has turns left to try something else.
    bridge_agent.bridge = FakeBridge()
    same = act([('element_click_trusted', {'element_id': 'el_5'})])
    model = Model([same] * 6)
    result = await bridge_agent.run('click the thing', model)
    clicks = [s for s in result['steps'] if s['tool'] == 'element_click_trusted']
    check('the same action is not run more than twice over',
          len(clicks) <= 3, f'{len(clicks)} identical clicks')
    told = [p for p in model.prompts if 'three times' in p]
    check('and the loop is told it is repeating itself', bool(told))

    # A failing action stops the rest of the batch: the queue was planned
    # against a page that did not turn out the way the turn expected.
    class Breaks(FakeBridge):
        async def call(self, method, params):
            self.calls.append((method, params))
            if method == 'element_fill':
                raise RuntimeError('no such element')
            return {'url': 'https://x/'}

    bridge_agent.bridge = Breaks()
    model = Model([
        act([('element_fill', {'element_id': 'gone'}),
             ('element_click_trusted', {'element_id': 'el_2'})]),
        json.dumps({'done': True, 'success': False, 'answer': 'could not fill'}),
    ])
    result = await bridge_agent.run('fill it in', model)
    check('the rest of a batch is abandoned after a failure',
          not any(s.get('tool') == 'element_click_trusted' for s in result['steps']),
          str(result['steps']))


    print()
    print('only tools Dex has classified')

    class Extra(FakeBridge):
        def tools(self):
            return super().tools() + [{'name': 'post_a_tweet'}]

    bridge_agent.bridge = Extra()
    model = Model([json.dumps({'done': True, 'success': True, 'answer': 'ok',
                               'verified_by': 'the page'})])
    await bridge_agent.run(
        'do a thing', model,
        tool_tiers={'page_analyze': 4, 'page_navigate': 3,
                    'element_click_trusted': 2, 'element_fill': 2,
                    'debugger_detach': 4},
    )
    offered = model.prompts[0]
    check('a classified tool is offered', 'element_click_trusted' in offered)
    check('a tool Dex has never classified is not',
          'post_a_tweet' not in offered, offered[:300])

    # No table at all is the older shape, and refusing everything would be a
    # worse answer than the previous behaviour.
    bridge_agent.bridge = Extra()
    model = Model([json.dumps({'done': True, 'success': True, 'answer': 'ok',
                               'verified_by': 'the page'})])
    await bridge_agent.run('do a thing', model)
    check('with no table sent, everything the extension offers is used',
          'post_a_tweet' in model.prompts[0])

    print(f'{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  the loop knows where it is and remembers how it got there.')


if __name__ == '__main__':
    asyncio.run(main())
