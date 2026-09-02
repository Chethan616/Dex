"""
Autonomous web browsing, with a stop button for walls only a human can clear.

browser-use drives its own reason-act loop, which is what makes it good at the
web and dangerous on a CAPTCHA: left alone it will burn every step it has
retrying something it fundamentally cannot do. So every step end is inspected,
and the first sign of a human-only wall stops the agent, parks the session, and
hands the browser back to the owner. The window is deliberately NOT headless --
a hand-off is meaningless if there is nothing for the owner to click.

The session survives the hand-off. When the owner says they are done, the same
agent resumes against the same live page, keeping its history.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Any

from browser_use import Agent, BrowserSession

import browser_choice
import session_pool

from primitives import check_page, has_spec
from walls import Wall, detect_wall

log = logging.getLogger('BrowserBackend')

# Two is judgement, not a magic number: one wall is normal (a CAPTCHA on entry),
# two is a site that keeps challenging. A third means the task is not going to
# work today and the owner should hear that instead of being asked again.
MAX_HANDOFFS = 2

DEFAULT_MAX_STEPS = 25


@dataclass
class BrowserRun:
    """One browsing task, alive across hand-offs."""

    session_id: str
    task: str
    session: BrowserSession
    agent: Agent
    max_steps: int
    steps_used: int = 0
    handoffs: int = 0
    wall: Wall | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    # What the Brain said success looks like, checked against the live page
    # before the browser is closed.
    verify: dict[str, Any] = field(default_factory=dict)


class WallHit(Exception):
    """Raised inside the step hook to unwind out of the agent loop at once."""


class BrowserBackend:
    def __init__(self, provider: str, api_key: str, model: str, headless: bool) -> None:
        self.provider = provider
        self.api_key = api_key
        self.model = model
        self.headless = headless
        self.runs: dict[str, BrowserRun] = {}

    def _llm(self):
        """
        The model driving the browsing loop.

        Groq is the default because it is the free tier most people will have,
        and because measurement says it works: against browser-use's real 17 KB
        output schema, qwen3.8-27b picked the correct element 3/3 with zero
        reasoning tokens, while qwen3.6-27b failed Groq's own schema validation
        and the gpt-oss models spent ~158 of 203 output tokens thinking.
        """
        if self.provider == 'groq':
            from browser_use import ChatGroq
            return ChatGroq(model=self.model, api_key=self.api_key)

        from browser_use import ChatAnthropic
        return ChatAnthropic(model=self.model, api_key=self.api_key)

    @property
    def _thrifty(self) -> bool:
        """
        Whether to run in the low-token configuration.

        Not a preference on Groq — a requirement. Its free tier allows 8,000
        tokens per minute, and browser-use's default system prompt is 5,273
        tokens *per step*, so the budget is gone before the second step. Flash
        mode swaps that prompt for a 516-token one.
        """
        return self.provider == 'groq' 

    # -- lifecycle -----------------------------------------------------------

    async def start_task(
        self,
        task: str,
        start_url: str | None = None,
        max_steps: int = DEFAULT_MAX_STEPS,
        verify: dict[str, Any] | None = None,
        browser: str | None = None,
    ) -> dict[str, Any]:
        session_id = uuid.uuid4().hex[:12]
        # From the pool, not built here.
        #
        # Dex's persistent profile is what keeps a signed-in site signed in
        # between tasks, and Chromium allows one process per profile — so this
        # cannot own a browser of its own without racing PrimitiveBrowser for
        # the lock. The pool owns it; this borrows it. See session_pool.
        session = await session_pool.POOL.acquire(browser, self.headless)

        if start_url:
            await session.navigate_to(start_url)

        agent = Agent(
            task=task,
            llm=self._llm(),
            browser_session=session,
            # DEX runs its own retry and loop policy in the Orchestrator; a
            # second, invisible one underneath it makes failures unreadable.
            max_failures=2,
            # The bar shows every step, so the owner is the one watching for
            # nonsense. Keep steps small and legible.
            max_actions_per_step=3,
            enable_signal_handler=False,
            # See _thrifty: on Groq these are what make a 25-step task fit
            # inside 8,000 tokens per minute at all.
            flash_mode=self._thrifty,
            use_vision=not self._thrifty,
            max_clickable_elements_length=15_000 if self._thrifty else 40_000,
            max_history_items=8 if self._thrifty else None,
        )

        run = BrowserRun(
            session_id=session_id,
            task=task,
            session=session,
            agent=agent,
            max_steps=max_steps,
            verify=verify or {},
        )
        self.runs[session_id] = run
        return await self._drive(run)

    async def resume(self, session_id: str) -> dict[str, Any]:
        run = self.runs.get(session_id)
        if run is None:
            return {
                'success': False,
                'error': f'No browser session {session_id}',
                'retryable': False,
            }
        if run.wall is None:
            return {
                'success': False,
                'error': 'That session is not waiting on anything',
                'retryable': False,
            }

        cleared = run.wall
        run.wall = None
        run.handoffs += 1

        # The agent's history still ends at the wall. Tell it plainly what
        # changed -- as an instruction from DEX, never as text lifted off the
        # page, which stays untrusted data.
        run.agent.add_new_task(
            f'The owner has cleared the {cleared.kind} that was blocking you. '
            f'The page should now be past it. Continue the original task: {run.task}'
        )
        return await self._drive(run)

    async def abandon(self, session_id: str) -> bool:
        run = self.runs.pop(session_id, None)
        if run is None:
            return False
        await self._teardown(run)
        return True

    async def close_all(self) -> None:
        for session_id in list(self.runs):
            await self.abandon(session_id)

    # -- the loop ------------------------------------------------------------

    async def _drive(self, run: BrowserRun) -> dict[str, Any]:
        remaining = max(1, run.max_steps - run.steps_used)
        before = len(run.steps)

        async def on_step_end(agent: Agent) -> None:
            run.steps_used += 1
            # Keep the pool from reaping this browser out from under a long
            # task. The idle clock is only read when something else acquires,
            # but a twenty-minute browsing job is exactly when that happens.
            session_pool.POOL.touch(run.session)
            url = await _safe(run.session.get_current_page_url(), '')
            run.steps.append(
                {'step': run.steps_used, 'url': url, 'action': _last_action(agent)}
            )

            title = await _safe(run.session.get_current_page_title(), '')
            dom = await _safe(run.session.get_state_as_text(), '')

            wall = detect_wall(url, title, dom, run.task)
            if wall is not None:
                run.wall = wall
                log.info('[%s] wall: %s at %s', run.session_id, wall.kind, url)
                # stop() asks the loop to wind down at the next boundary; the
                # exception guarantees we leave now, before another action
                # fires against a page the owner is about to touch.
                agent.stop()
                raise WallHit(wall.kind)

        try:
            history = await run.agent.run(max_steps=remaining, on_step_end=on_step_end)
        except WallHit:
            history = None
        except Exception as err:  # noqa: BLE001 -- surfaced to the owner verbatim
            log.exception('[%s] agent error', run.session_id)
            await self._discard(run)
            return {
                'success': False,
                'session_id': run.session_id,
                'steps': run.steps[before:],
                'error': f'{type(err).__name__}: {err}',
                'retryable': True,
            }

        url = await _safe(run.session.get_current_page_url(), '')

        if run.wall is not None:
            if run.handoffs >= MAX_HANDOFFS:
                reason = run.wall.reason
                handoffs = run.handoffs
                await self._discard(run)
                return {
                    'success': False,
                    'session_id': run.session_id,
                    'steps': run.steps[before:],
                    'url': url,
                    'error': (
                        f'Gave up after {handoffs} hand-offs -- {reason} keeps coming '
                        'back. This site is not going to let DEX through today.'
                    ),
                    'retryable': False,
                }
            return {
                'success': False,
                'session_id': run.session_id,
                'steps': run.steps[before:],
                'url': url,
                'needs_handoff': {
                    'kind': run.wall.kind,
                    'reason': run.wall.reason,
                    'instruction': run.wall.instruction,
                },
                'retryable': False,
            }

        result = _final_result(history)

        if _is_done(history):
            steps = run.steps[before:]
            # Ask the page itself, while it is still open. The agent claiming
            # success is not evidence; this is the only moment the real DOM can
            # be read, so it happens before teardown, not after.
            verification = None
            if has_spec(run.verify):
                try:
                    verification = await check_page(run.session, run.verify)
                except Exception as err:  # noqa: BLE001
                    verification = {'passed': False, 'error': str(err), 'checks': []}
            await self._discard(run)
            return {
                'success': True,
                'session_id': run.session_id,
                'steps': steps,
                'url': url,
                'result': result,
                'verification': verification,
            }

        # Out of steps without finishing. Retryable, but the session goes away --
        # resuming a confused agent tends to compound the confusion.
        steps = run.steps[before:]
        max_steps = run.max_steps
        await self._discard(run)
        return {
            'success': False,
            'session_id': run.session_id,
            'steps': steps,
            'url': url,
            'error': f'Ran out of steps ({max_steps}) without finishing the task',
            'result': result,
            'retryable': True,
        }

    async def _discard(self, run: BrowserRun) -> None:
        self.runs.pop(run.session_id, None)
        await self._teardown(run)

    async def _teardown(self, run: BrowserRun) -> None:
        """
        Close the agent. Deliberately NOT the browser.

        The browser belongs to the pool now, and it outliving the task is the
        point: it is what carries a signed-in session from `sign_in` to the work
        that follows, and from one request to the next. The pool closes it when
        it has been idle long enough — see session_pool.IDLE_TIMEOUT.
        """
        try:
            await run.agent.close()
        except Exception:  # noqa: BLE001
            pass


# -- helpers ------------------------------------------------------------------


async def _safe(coro, default):
    """Observation must never be the thing that kills a task."""
    try:
        return await asyncio.wait_for(coro, timeout=15)
    except Exception:  # noqa: BLE001
        return default


def _last_action(agent: Agent) -> str:
    try:
        names = agent.history.action_names()
        return names[-1] if names else ''
    except Exception:  # noqa: BLE001
        return ''


def _final_result(history) -> str | None:
    if history is None:
        return None
    try:
        return history.final_result()
    except Exception:  # noqa: BLE001
        return None


def _is_done(history) -> bool:
    if history is None:
        return False
    try:
        # is_successful() is None while undecided; is_done() only says the agent
        # called done, not that it went well.
        successful = history.is_successful()
        if successful is not None:
            return bool(successful)
        return bool(history.is_done())
    except Exception:  # noqa: BLE001
        return False


def env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')
