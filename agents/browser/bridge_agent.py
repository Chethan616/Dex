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

from bridge import bridge

log = logging.getLogger('BridgeAgent')

# Enough for a real task, few enough that a lost model does not spend an hour.
#
# The run that prompted this took twenty-five steps and seven minutes to not
# change a GitHub status, because it was signed out and kept looking for a way
# in. Signed in, the same task is four or five steps.
MAX_STEPS = 18

# What the model is told it can do. Deliberately the whole list from the
# extension rather than a curated subset: it registered them, it knows what it
# has, and a tool Dex hides is a tool the owner paid for and cannot use.
SYSTEM = """You are operating a web browser that the owner is already signed
in to. You act by choosing ONE tool call at a time and seeing what happens.

How to work:
- Start with page_analyze to see what is actually on the page. Do not guess at
  element ids; they come from the analysis and change between pages.
- Prefer navigating straight to a known URL over clicking through menus.
- After an action that changes the page, analyze again before the next one.
- If element_click appears to work but the page does not change, use
  element_click_trusted — many controls ignore a synthetic click.
- To upload a file, use element_upload_file with the path you were given. Do
  not click the upload button and wait for a dialog; there is no dialog.
- To download, use page_download_to with the directory you were given, passing
  the download control as trigger_element_id. It reports the exact file.
- When the task is done, reply with {"done": true, "answer": "..."}.
- If the page shows you are signed out, stop and say so — do not try to sign
  in, and never type a password.

Answer with ONE JSON object and nothing else:
  {"tool": "<name>", "params": { ... }, "why": "<short reason>"}
or
  {"done": true, "answer": "<what you found or did>"}
"""


async def run(task: str, ask_model, *, on_step=None) -> dict[str, Any]:
    """
    Run `task` in the attached browser.

    `ask_model` takes a prompt and returns the model's text — passed in rather
    than imported so this file has no opinion about which provider is in use,
    and so a test can drive it without a model at all.

    `on_step` is called with each step as it happens, so the owner watches it
    rather than waiting for a verdict.
    """
    if not bridge.attached:
        return {
            'success': False,
            'error': (
                'No browser is attached. Open Chrome with the Dex extension '
                'loaded — that is the only way Dex can act as you, because '
                'Chrome blocks every other route into a signed-in profile.'
            ),
            'retryable': False,
        }

    available = [t.get('name') for t in bridge.tools()]
    history: list[str] = []
    steps: list[dict] = []
    # Files this run produced, so a later Dex step can point at one.
    #
    # Without this the browser could do the work and Dex could not pick it up:
    # run_task returned a sentence and a URL, and `{{step_N.output...}}` had no
    # path to resolve. Compressing a PDF on a website and then moving the result
    # to another drive is two steps that could not be joined.
    downloads: list[dict] = []

    for number in range(1, MAX_STEPS + 1):
        prompt = (
            f'{SYSTEM}\n'
            f'Tools available: {", ".join(sorted(available))}\n\n'
            f'Task: {task}\n\n'
            f'What has happened so far:\n'
            + ('\n'.join(history[-12:]) if history else '  nothing yet')
            + '\n\nYour next single step:'
        )

        raw = await ask_model(prompt)
        choice = _parse(raw)

        if choice is None:
            history.append(f'  [{number}] the model did not answer with a tool call')
            continue

        if choice.get('done'):
            await _detach(available)
            return {
                'success': True,
                'answer': str(choice.get('answer', '')),
                'steps': steps,
                'downloads': downloads,
                'browser': 'the owner browser',
            }

        tool = str(choice.get('tool', ''))
        params = choice.get('params') or {}

        if tool not in available:
            history.append(f'  [{number}] {tool} is not available here')
            continue

        try:
            result = await bridge.call(tool, params)
            summary = _summarise(result)
            history.append(f'  [{number}] {tool} -> {summary}')
            steps.append({
                'step': number,
                'tool': tool,
                # `action` as well as `tool`, because the route recorder in
                # browser_agent.ts reads `action` — so a run that worked here
                # teaches the same remembered route an autonomous run does,
                # with no second code path.
                'action': tool,
                'url': _url_of(result),
                'params': params,
                'result': summary,
            })
            landed = _download_of(result)
            if landed:
                downloads.append(landed)
        except Exception as exc:  # noqa: BLE001 - reported, not raised
            history.append(f'  [{number}] {tool} failed: {exc}')
            steps.append({'step': number, 'tool': tool, 'params': params,
                          'error': str(exc)})

        if on_step:
            on_step(steps[-1] if steps else {'step': number, 'tool': tool})

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
        'retryable': False,
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
                        if isinstance(parsed, dict) and ('tool' in parsed or 'done' in parsed):
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
