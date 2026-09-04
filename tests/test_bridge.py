"""
The owner's browser, attached to Dex.

    python tests/test_bridge.py

What this replaces: `opendia-mcp`, a Node process whose only job was bridging
the extension to an MCP client. Dropping it removes a port and a protocol, but
the reason is that tools arriving over MCP are opaque — called and returned,
with nothing to classify them, assign a confirmation tier, or verify
afterwards. "Post a tweet" would simply happen.

A fake extension stands in for the real one. What is under test is the bridge:
that a browser has to actually be there before Dex claims it is, that a call
reaches the far end and comes back, and that every way it can go wrong produces
an error a person can act on rather than a hang.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agents' / 'browser'))

from bridge import BrowserBridge, routing  # noqa: E402

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


class FakeExtension:
    """
    A browser that registers two tools and answers what it is asked.

    `script` maps a method to what it should do: a value to return, or an
    Exception to report as an error, or None to say nothing at all — which is
    how a wedged page behaves and is the case a timeout exists for.
    """

    def __init__(self, script: dict, tools: list[str] | None = None) -> None:
        self.script = script
        self.tools = tools or ['page_navigate', 'element_click']
        self.sent: list[dict] = []
        self._incoming: asyncio.Queue = asyncio.Queue()
        self._closed = False

    async def receive_text(self) -> str:
        if self._closed:
            raise RuntimeError('closed')
        return await self._incoming.get()

    async def send_text(self, raw: str) -> None:
        """Dex asking for something. Answer it the way the script says."""
        message = json.loads(raw)
        self.sent.append(message)
        action = self.script.get(message['method'], 'ok')

        if action is None:
            return  # deliberately silent
        if isinstance(action, Exception):
            await self._incoming.put(json.dumps(
                {'id': message['id'], 'error': str(action)},
            ))
            return
        await self._incoming.put(json.dumps(
            {'id': message['id'], 'result': action},
        ))

    async def register(self) -> None:
        await self._incoming.put(json.dumps({
            'type': 'register',
            'browser': 'Vivaldi',
            'tools': [{'name': name} for name in self.tools],
        }))

    def close(self) -> None:
        self._closed = True


async def attached(bridge: BrowserBridge, extension: FakeExtension):
    """Attach in the background, and wait until registration has landed."""
    task = asyncio.create_task(bridge.attach(extension))
    await extension.register()
    for _ in range(100):
        if bridge.attached and bridge.tools():
            break
        await asyncio.sleep(0.01)
    return task


async def main() -> None:
    print('the bridge to the owner browser')

    # ── nothing attached ────────────────────────────────────────────────────
    bridge = BrowserBridge()
    check('with no browser, it does not claim to have one', not bridge.attached)
    status = bridge.status()
    check('and says what to do about it',
          'extension' in status['reason'], status['reason'])

    try:
        await bridge.call('page_navigate', {'url': 'https://example.com'})
        check('calling with no browser fails', False, 'it returned')
    except RuntimeError as exc:
        check('calling with no browser fails, saying so',
              'No browser is attached' in str(exc), str(exc))

    # ── attached ────────────────────────────────────────────────────────────
    extension = FakeExtension({'page_navigate': {'url': 'https://example.com'}})
    task = await attached(bridge, extension)

    check('a registered browser is attached', bridge.attached)
    check('and its tools are known', 'page_navigate' in [t['name'] for t in bridge.tools()])
    check('and it says which browser', bridge.status()['browser'] == 'Vivaldi')

    result = await bridge.call('page_navigate', {'url': 'https://example.com'})
    check('a call reaches the browser and comes back',
          result == {'url': 'https://example.com'}, str(result))
    check('carrying the parameters it was given',
          extension.sent[-1]['params'] == {'url': 'https://example.com'},
          str(extension.sent[-1]))

    # ── the ways it goes wrong ──────────────────────────────────────────────
    try:
        await bridge.call('post_a_tweet', {})
        check('an unknown tool is refused', False, 'it ran')
    except RuntimeError as exc:
        check('an unknown tool is refused, listing what there is',
              'does not offer' in str(exc) and 'page_navigate' in str(exc), str(exc))

    extension.script['element_click'] = RuntimeError('element not found')
    try:
        await bridge.call('element_click', {'selector': '#gone'})
        check("the browser's own error is surfaced", False, 'it succeeded')
    except RuntimeError as exc:
        check("the browser's own error is surfaced",
              'element not found' in str(exc), str(exc))

    # A page that never answers. The timeout is what stops a task hanging on
    # the owner's browser waiting for something that is not coming.
    import bridge as bridge_module
    original = bridge_module.CALL_TIMEOUT_S
    bridge_module.CALL_TIMEOUT_S = 0.2
    extension.script['page_navigate'] = None
    try:
        await bridge.call('page_navigate', {'url': 'https://slow'})
        check('a silent browser times out', False, 'it returned')
    except RuntimeError as exc:
        check('a silent browser times out rather than hanging',
              'did not answer' in str(exc), str(exc))
    finally:
        bridge_module.CALL_TIMEOUT_S = original

    # ── the browser goes away mid-call ──────────────────────────────────────
    extension.script['page_navigate'] = None
    pending = asyncio.create_task(bridge.call('page_navigate', {'url': 'https://x'}))
    await asyncio.sleep(0.05)
    await bridge.detach('the browser was closed')
    try:
        await pending
        check('a call in flight when the browser closes fails', False, 'it returned')
    except RuntimeError as exc:
        check('a call in flight when the browser closes fails at once',
              'went away' in str(exc), str(exc))
    check('and it is no longer attached', not bridge.attached)

    task.cancel()

    # ── which browser answers ───────────────────────────────────────────────
    print('\nrouting')

    fresh = BrowserBridge()

    # With nothing attached, the answer is to open one — not to guess from the
    # words in the goal, and not to refuse. The old router read the task for
    # 'my ' and a list of site names, which meant any task phrased outside that
    # list quietly ran in a browser signed in to nothing.
    check('with nothing attached, Dex opens the owner browser',
          routing('read the docs on example.com') == 'open',
          routing('read the docs on example.com'))
    check('and it does not matter how the task is worded',
          routing('what is in my inbox') == 'open',
          routing('what is in my inbox'))
    check('background work still goes to Dex own browser',
          routing('scrape example.com', background=True) == 'dex',
          routing('scrape example.com', background=True))

    # Attach the module-level bridge the router actually consults.
    extension2 = FakeExtension({})
    task2 = await attached(bridge_module.bridge, extension2)

    check('attached, a signed-in task goes to the owner browser',
          routing('open my vtop and get my attendance') == 'owner',
          routing('open my vtop and get my attendance'))
    check('attached, a public scrape goes there too - it is their session',
          routing('get the price from example.com') == 'owner',
          routing('get the price from example.com'))
    check('background work is the one thing that still goes elsewhere',
          routing('scrape example.com', background=True) == 'dex',
          routing('scrape example.com', background=True))
    check('a task that needs their session overrides background',
          routing('post this', needs_session=True, background=True) == 'owner',
          routing('post this', needs_session=True, background=True))

    await bridge_module.bridge.detach('done')
    task2.cancel()
    _ = fresh

    print(f'\n{passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)


asyncio.run(main())
