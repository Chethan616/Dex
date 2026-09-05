"""
Doing a task in the owner's own browser.

Everything else in this folder drives a browser Dex launched. This drives the
one the owner already has open, through the extension, and it exists because
every other route to their signed-in session is closed on purpose:

    copy the profile      Chrome 127's App-Bound Encryption ties cookie
                          decryption to the browser's own identity, so a copy
                          arrives signed out. Measured: pointed at the owner's
                          profile, github.com/settings/profile redirected to
                          the login page.
    attach over CDP       Chrome 136 refuses --remote-debugging-port on a
                          default profile. Measured: connection refused.
    load the extension    Chrome 152 removed --load-extension and its feature
                          flag. Measured: zero extensions registered.

All three are anti-infostealer measures and all three are right. What is left
is an extension the owner installed themselves, running inside their browser —
which is the only door Google left open, and the reason Phase 6 forked one.

**Why this is not browser_use.** browser_use owns a browser: it launches it,
holds the CDP connection, and reads the DOM directly. Here Dex has neither —
the page is behind a WebSocket, reachable only through the eighteen tools the
extension registered. So this is a small loop of its own: look at the page, ask
the model for one tool call, make it, look again.

**Every call still goes through the tiers.** `browser_tools.ts` assigns each
tool a tier by what it can do to the owner, and a click on a signed-in site is
Tier 2. This runs the loop; it does not decide what is allowed.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import world_state
from bridge import bridge

log = logging.getLogger('BridgeAgent')

# Enough for a real task, few enough that a lost model does not spend an hour.
#
# The run that prompted this took twenty-five steps and seven minutes to not
# change a GitHub status, because it was signed out and kept looking for a way
# in. Signed in, the same task is four or five steps.
MAX_STEPS = 18

# How many turns stay verbatim, and when the rest gets summarised.
#
# Verbatim is what the next decision needs: the exact element id that failed,
# the exact text that came back. Older than that, what matters is the shape —
# "signed in, reached the profile page, the status control was not where the
# route said" — which is a sentence, not eight lines of tool output.
RECENT_TURNS = 8
COMPACT_AFTER = 6

# How many actions one turn may queue.
#
# A turn is a model call, measured at about 5.5s, so eighteen turns is the two
# minutes the owner spends watching a task. Batching analyse-then-click into
# one turn is most of that time back. Capped because a long queue is a plan
# made against a page the model has not seen yet — the further down the list,
# the more it is guessing.
MAX_ACTIONS_PER_TURN = 4

# Tools that change the page rather than read it. What a run altered is what a
# verification should check, and it is the run's own claim about itself.
CHANGES_THE_PAGE = frozenset({
    'element_click', 'element_click_trusted', 'element_fill',
    'element_upload_file', 'page_download_to', 'page_press_key',
    'add_bookmark', 'page_style',
})

# What the model is told it can do. Deliberately the whole list from the
# extension rather than a curated subset: it registered them, it knows what it
# has, and a tool Dex hides is a tool the owner paid for and cannot use.
# What the model is told, and what it must say back.
#
# This asked for "ONE tool call at a time" and a {"done": true} when finished.
# It never asked whether the *last* action had worked, so a click that changed
# nothing was indistinguishable from one that worked, and the loop moved on. It
# had no success flag, so "done" meant "the model stopped", which is how a run
# that did half the job reported that it had done all of it.
#
# The contract below is browser-use's, which is already installed here and
# already drives the browser Dex launches. Every turn it requires an explicit
# verdict on the previous action, a memory line, and a list of actions rather
# than one; before claiming success it requires evidence. Its own system prompt
# puts the rule better than a paraphrase would: "Partial results with
# success=false are more valuable than overclaiming success."
SYSTEM = """You are driving a web browser the owner is already signed in to.
It is their real browser, with their accounts, on their machine.

Every turn, you say what happened and what to do next:

  evaluation_previous_goal  Did your last actions do what you intended? Look at
                            the page, not at your intent. "Clicked Unpin but
                            the dialog is still open. Verdict: Failure" is a
                            useful turn. Never assume an action worked because
                            it did not error.
  memory                    What the next turn needs to know. Where you are,
                            what you have already tried, what you learned about
                            where things live on this site.
  next_goal                 The one thing you are about to achieve.
  plan_update               Your plan for the rest, revised as you learn. Keep
                            it short.
  action                    One or more tool calls to run now, in order.

How to work:
- Start with page_analyze. Element ids come from it and change between pages;
  never guess one.
- Put several actions in one turn when you already know they follow — analyze
  then click, or fill then press Enter. Each turn is a model call and the owner
  is waiting. But do not queue actions past a point where the page will change
  in a way you have not seen.
- Prefer navigating straight to a known URL over clicking through menus.
- If element_click seemed to work but nothing changed, use
  element_click_trusted. Many controls ignore a synthetic click.
- To upload, use element_upload_file with the path you were given. There is no
  file dialog to click through.
- To download, use page_download_to with the directory you were given.
- You are signed in. Do not look for a login, do not type a password, and if a
  page does show you signed out, stop and say so.
- If two turns in a row change nothing, stop repeating and try a different
  route. If there is no other route, finish with success false and say why.

When you are finished, you must have checked. Before saying success is true,
look at the page and find the thing that shows it: the pin gone, the message
sent, the file downloaded. Name it in verified_by. If you cannot find it, or
any part of the request is unmet, success is false — a partial answer with
success false is worth more than a confident wrong one.

Answer with ONE JSON object and nothing else. To act:
  {"evaluation_previous_goal": "...", "memory": "...", "next_goal": "...",
   "plan_update": ["...", "..."],
   "action": [{"tool": "<name>", "params": { ... }}]}
To finish:
  {"done": true, "success": true, "answer": "<what you did or found>",
   "verified_by": "<what on the page proves it>"}
"""


async def run(
    task: str,
    ask_model,
    *,
    on_step=None,
    route: dict | None = None,
    profile: str = '',
    tool_tiers: dict[str, int] | None = None,
) -> dict[str, Any]:
    """
    Run `task` in the attached browser.

    `ask_model` takes a prompt and returns the model's text — passed in rather
    than imported so this file has no opinion about which provider is in use,
    and so a test can drive it without a model at all.

    `on_step` is called with each step as it happens, so the owner watches it
    rather than waiting for a verdict.
    """
    if not bridge.ready:
        return {
            'success': False,
            'error': (
                'No browser is attached. Open Chrome with the Dex extension '
                'loaded — that is the only way Dex can act as you, because '
                'Chrome blocks every other route into a signed-in profile.'
            ),
            'retryable': False,
        }

    offered = [str(t.get('name')) for t in bridge.tools() if t.get('name')]

    # Only tools Dex has classified.
    #
    # Every tool carries a confirmation tier saying what it may do to the owner
    # — and nothing in production read those tiers, so an extension could offer
    # a tool Dex had never heard of and this loop would drive it. That is the
    # thing Phase 6 forked the extension to avoid, and it had quietly come back.
    #
    # A tool Dex cannot classify is not offered. It is not a security boundary
    # against a hostile extension — the owner installed it — but it is the
    # difference between a capability that was reasoned about and one that
    # arrived.
    if tool_tiers:
        available = [name for name in offered if name in tool_tiers]
        unclassified = [name for name in offered if name not in tool_tiers]
        if unclassified:
            log.info('not offering unclassified tools: %s', ', '.join(unclassified))
    else:
        # No table sent (an older caller, or a direct test). Offering what the
        # extension has is the previous behaviour and is better than refusing.
        available = offered
        unclassified = []

    # A browser with no tools is not a browser Dex can use.
    #
    # This ran once with an empty list: the socket had opened but the
    # extension's tool registration had not arrived. The model was asked to
    # drive a page with nothing to drive it with, answered honestly that it
    # could not, and the run was recorded as a success with zero steps. A task
    # that did nothing must not report that it did something.
    if not available:
        return {
            'success': False,
            'error': (
                'The browser is connected but has not said what it can do yet. '
                'Nothing was attempted. Try again in a moment.'
            ),
            'retryable': True,
        }
    history: list[str] = []
    steps: list[dict] = []
    # Files this run produced, so a later Dex step can point at one.
    #
    # Without this the browser could do the work and Dex could not pick it up:
    # run_task returned a sentence and a URL, and `{{step_N.output...}}` had no
    # path to resolve. Compressing a PDF on a website and then moving the result
    # to another drive is two steps that could not be joined.
    downloads: list[dict] = []
    # What the run changed, so a verification can check the claim instead of
    # grading the whole thing UNVERIFIABLE for want of anything to test.
    changed: list[str] = []

    # What the loop already knows, so it stops rediscovering it. See world_state.
    world = world_state.WorldState()
    world.set('goal', task)
    world.browser(len(available), profile)
    world.known(route)

    # Everything older than the recent turns, as a sentence rather than dropped.
    recap = ''
    compacted_turns = 0
    # What has been attempted, to notice going round in circles. See the check
    # in the action loop.
    tried: list[str] = []

    for number in range(1, MAX_STEPS + 1):
        recent = history[-RECENT_TURNS:]
        older = history[:-RECENT_TURNS]

        # Compaction, not truncation.
        #
        # This was history[-12:] and nothing else, so a long task forgot how it
        # began — which is how a run starts going in circles: it no longer
        # remembers that it already tried the thing it is about to try again.
        # Summarising costs one cheap call, and only once there is enough
        # history to be worth summarising.
        if len(older) >= COMPACT_AFTER and len(older) > compacted_turns:
            recap = await _compact(older, recap, ask_model)
            compacted_turns = len(older)
            # Everything has to be said again: the turns that carried it are
            # no longer in the prompt.
            world.forget_what_was_shown()

        state = world.render(full=(number == 1))

        prompt = (
            f'{SYSTEM}\n'
            f'Tools available: {", ".join(sorted(available))}\n\n'
            f'Task: {task}\n\n'
            + (f'{state}\n\n' if state else '')
            + (f'Earlier, in short:\n  {recap}\n\n' if recap else '')
            + f'What has happened so far:\n'
            + ('\n'.join(recent) if recent else '  nothing yet')
            + '\n\nYour next single step:'
        )

        raw = await ask_model(prompt)
        turn = _parse(raw)

        if turn is None:
            history.append(f'  [{number}] the model did not answer with an action')
            continue

        # What it says about the turn before this one.
        #
        # Recorded whether or not it is flattering. A loop that never writes
        # down "that click did nothing" is a loop that will click it again.
        verdict = str(turn.get('evaluation_previous_goal', '')).strip()
        if verdict:
            history.append(f'  [{number}] looking back: {verdict}')
        if turn.get('memory'):
            world.set('memory', str(turn['memory'])[:400])
        if turn.get('plan_update'):
            plan = [str(item) for item in turn['plan_update'] if item][:8]
            world.set('plan', '\n'.join(f'- {item}' for item in plan))

        if turn.get('done'):
            await _detach(available)
            return _finished(turn, steps, downloads, changed, world)

        # One or more actions. `action` is a list because a turn is a model call
        # and the owner is waiting: analyse-then-click is one turn, not two.
        # A single {"tool": ...} is still accepted, because a model that answers
        # in the older shape should work rather than stall.
        batch = turn.get('action')
        if isinstance(batch, dict):
            batch = [batch]
        if not isinstance(batch, list) or not batch:
            if turn.get('tool'):
                batch = [{'tool': turn['tool'], 'params': turn.get('params') or {}}]
            else:
                history.append(f'  [{number}] the model asked for no action')
                continue

        for call in batch[:MAX_ACTIONS_PER_TURN]:
            if not isinstance(call, dict):
                continue
            tool = str(call.get('tool', ''))
            params = call.get('params') or {}

            if tool not in available:
                history.append(f'  [{number}] {tool} is not available here')
                break

            # Going round in circles.
            #
            # The same tool on the same element twice running has already had
            # its chance; doing it a third time spends the budget on the answer
            # that did not work. Told rather than silently stopped, so the model
            # can choose another route while it still has turns left.
            fingerprint = f'{tool}:{params.get("element_id") or params.get("url") or ""}'
            tried.append(fingerprint)
            if len(tried) >= 3 and len(set(tried[-3:])) == 1:
                history.append(
                    f'  [{number}] {tool} has now been tried three times with the '
                    'same target and changed nothing. Take a different route, or '
                    'finish with success false.'
                )
                break

            try:
                result = await bridge.call(tool, params)
                summary = _summarise(result)
                history.append(f'  [{number}] {tool} -> {summary}')
                steps.append({
                    'step': number,
                    'tool': tool,
                    # `action` as well as `tool`, because the route recorder in
                    # browser_agent.ts reads `action` — so a run that worked
                    # here teaches the same remembered route an autonomous run
                    # does, with no second code path.
                    'action': tool,
                    'url': _url_of(result),
                    'params': params,
                    'result': summary,
                })
                landed = _download_of(result)
                if landed:
                    downloads.append(landed)
                    changed.append(f'downloaded {landed["name"]}')

                url, title = world_state.page_of(result)
                world.page(url, title)
                if tool in CHANGES_THE_PAGE:
                    what = str(params.get('element_id') or params.get('value') or tool)
                    world.did(f'{tool} {what}'[:90])
                    changed.append(f'{tool} {what}'[:90])
            except Exception as exc:  # noqa: BLE001 - reported, not raised
                history.append(f'  [{number}] {tool} failed: {exc}')
                steps.append({'step': number, 'tool': tool, 'params': params,
                              'error': str(exc)})
                # The rest of the batch was planned against a page that did not
                # turn out the way this turn expected. Stop and look.
                break

            if on_step:
                on_step(steps[-1])

    await _detach(available)
    return {
        'success': False,
        'error': (
            f'Ran out of steps ({MAX_STEPS}) without finishing. What it did '
            'is above — if it was going in circles, the page probably needed '
            'something the task did not say.'
        ),
        'steps': steps,
        'downloads': downloads,
        'changed': changed,
        'visited': _visited(steps),
        'retryable': False,
    }


def _finished(turn: dict, steps: list, downloads: list, changed: list, world) -> dict:
    """
    The run's own verdict on itself.

    `success` used to be implied — the loop returned success because the model
    had stopped, which is not the same thing and is how a run that did half the
    job reported that it had done all of it.

    Now the model says so, and has to say what on the page shows it. A claim of
    success with nothing to point at is downgraded here rather than believed:
    the verification layer will treat it as unverified, which is the honest
    reading of "it says it worked and cannot say why".
    """
    claimed = turn.get('success')
    answer = str(turn.get('answer', '')).strip()
    evidence = str(turn.get('verified_by', '')).strip()

    # Absent means an older-shaped answer; those are taken at their word,
    # because the alternative is failing runs that did work.
    success = True if claimed is None else bool(claimed)

    return {
        'success': success,
        'answer': answer,
        'verified_by': evidence,
        'steps': steps,
        'downloads': downloads,
        'changed': changed,
        'visited': _visited(steps),
        'url': (world.snapshot().get('page', '') or '').split('  ·  ')[0],
        'browser': 'the owner browser',
        **({} if success else {
            'error': answer or 'The run could not finish what it was asked to do.',
            'retryable': False,
        }),
    }


async def _detach(available: list) -> None:
    """
    Stop debugging, so Chrome's debugging banner goes away.

    Attaching is what makes file upload and a trusted click possible, and the
    banner is Chrome telling the owner that happened — which is correct. Leaving
    it up after the task ends is not: it would sit there for the rest of the
    session implying Dex is still in the page.
    """
    if 'debugger_detach' not in available:
        return
    try:
        await bridge.call('debugger_detach', {})
    except Exception as exc:  # noqa: BLE001 - a banner is not worth failing over
        log.debug('could not detach the debugger: %s', exc)


async def _compact(older: list[str], summary: str, ask_model) -> str:
    """
    Everything before the recent turns, as one paragraph.

    The alternative was dropping it, which is what happened before: a task
    longer than twelve turns lost its own beginning, and a loop that cannot
    remember what it already tried tries it again. Codex compacts for the same
    reason and it is the right trade — one cheap call buys a run that still
    knows what it is doing at turn thirty.

    A failure here returns the previous summary rather than raising. A vaguer
    memory is a worse run; no run at all is a broken one.
    """
    prompt = (
        'Summarise what a browser automation has done so far, in at most four '
        'sentences. Keep: what worked, what failed and why, and anything '
        'learned about where things are on this site. Drop pleasantries and '
        'exact element ids.\n\n'
        + (f'Summary so far:\n{summary}\n\n' if summary else '')
        + 'Turns since then:\n' + '\n'.join(older[-40:])
    )
    try:
        answer = (await ask_model(prompt) or '').strip()
    except Exception as exc:  # noqa: BLE001 - a vaguer memory, not a failure
        log.debug('could not compact the history: %s', exc)
        return summary

    # A "summary" longer than what it summarised is not one.
    if not answer or len(answer) > sum(len(line) for line in older):
        return summary
    return answer.replace('\n', ' ')[:1200]


def _visited(steps: list[dict]) -> list[str]:
    """The pages this run touched, in order, without repeats."""
    seen: list[str] = []
    for step in steps:
        url = str(step.get('url', ''))
        if url and url not in seen:
            seen.append(url)
    return seen


def _download_of(result: Any) -> dict | None:
    """A completed download in a tool result, as a path Dex can point at."""
    if not isinstance(result, dict) or result.get('downloaded') is not True:
        return None
    directory = str(result.get('directory', ''))
    name = str(result.get('file', ''))
    if not directory or not name:
        return None
    return {
        'path': str(Path(directory) / name),
        'name': str(result.get('suggested_name') or name),
        'bytes': result.get('bytes'),
    }


def _url_of(result: Any) -> str:
    """Whatever page this happened on, for the remembered route."""
    if isinstance(result, dict):
        for key in ('url', 'href', 'page_url'):
            value = result.get(key)
            if isinstance(value, str):
                return value
    return ''


def _parse(raw: str) -> dict | None:
    """
    The model's choice, out of whatever it wrapped it in.

    Models fence JSON in markdown and add a sentence before it. Failing on that
    would make the loop depend on formatting rather than on the decision, so
    the first well-formed object wins.
    """
    text = (raw or '').strip()
    start = text.find('{')
    while start != -1:
        depth = 0
        for index in range(start, len(text)):
            if text[index] == '{':
                depth += 1
            elif text[index] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[start:index + 1])
                        # A turn now answers with `action`, a list. `tool`
                        # is still accepted so a model replying in the older
                        # single-call shape works rather than stalling.
                        if isinstance(parsed, dict) and any(
                            key in parsed for key in ('action', 'tool', 'done')
                        ):
                            return parsed
                    except ValueError:
                        pass
                    break
        start = text.find('{', start + 1)
    return None


def _summarise(result: Any) -> str:
    """
    One line about what came back.

    The whole result would be most of a page, and the loop feeds this back to
    the model on every turn — so an unsummarised history is a prompt that grows
    until it stops fitting.
    """
    if result is None:
        return 'ok'
    if isinstance(result, str):
        return result[:400]
    if isinstance(result, dict):
        for key in ('url', 'title', 'text', 'content', 'message', 'status'):
            if key in result and isinstance(result[key], (str, int)):
                return f'{key}={str(result[key])[:300]}'
        return json.dumps(result, default=str)[:400]
    return str(result)[:400]
