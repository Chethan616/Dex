"""
Claude Code, driving the browser, with eyes.

The browsing loop ran on Groq `qwen3.8-27b` with vision switched off, the
element list truncated to 15 KB and history clipped to eight items. That
configuration was chosen to fit a free tier, and it is most of why the browser
agent "just opened links": a small model shown a truncated text dump of a page
cannot do much else.

The owner asked for the composer's own three modes instead — Fast, Smart, Think
deeper — which is the subscription they already pay for. Before writing this I
checked whether the CLI can actually see a screenshot, because the whole design
turns on it:

    haiku    9.5s   {"buttons":["Sign In","Register"],"fields":["Username"]}
    sonnet   8.9s   {"buttons":["Sign In","Register"],"fields":["Username:"]}

It can. `--input-format stream-json` takes Anthropic message blocks, so an
image goes in as base64 and comes back correctly read. Sonnet is not slower
than Haiku — the CLI's own start-up dominates, which is the same thing measured
for planning.

**The honest cost is latency.** About nine seconds per step, so a fifteen-step
browse takes two and a half minutes. An API key would cut that to a few seconds
because there is no process to start. That is the trade this makes: the owner's
existing subscription, and a browse you watch rather than one that finishes
before you look up.

**DOM and vision together**, not vision alone. The structured page model is the
primary signal — it is exact, it is cheap, and it contains things a screenshot
cannot show, such as a form field's name or a link's href. The screenshot is
attached alongside so the model can see what the DOM misrepresents: layout,
overlap, what is actually on screen, and controls that look disabled. Either
one alone is worse than both.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import shutil
from typing import Any

log = logging.getLogger('ClaudeCodeLLM')

# The composer's three modes, as the CLI names them.
#
# The same mapping the planner uses, so "Fast" means one thing across Dex
# rather than one thing per component.
MODE_MODELS = {
    'fast': 'haiku',
    'smart': 'sonnet',
    'deeper': 'opus',
    'deep': 'opus',
}

DEFAULT_MODE = 'smart'

# Generous, because the CLI starts cold. Measured at ~9s for a real vision
# call; a page with a large DOM and a slow start can take several times that,
# and a timeout that fires on a call that would have succeeded is worse than
# waiting.
CALL_TIMEOUT = 180


def model_for(mode: str | None) -> str:
    return MODE_MODELS.get((mode or DEFAULT_MODE).strip().lower(), 'sonnet')


class ChatClaudeCode:
    """
    A chat model backed by the Claude Code CLI.

    Shaped to what browser_use asks of a model — `ainvoke` taking messages and
    returning text — rather than to the CLI, so the browsing loop does not know
    which of the two paths it is on.
    """

    def __init__(self, mode: str | None = None, cli: str | None = None) -> None:
        self.mode = (mode or DEFAULT_MODE).strip().lower()
        self.model = model_for(self.mode)
        self._cli = cli or shutil.which('claude') or shutil.which('claude.cmd') or 'claude'

    # browser_use reads these for logging and for its own token bookkeeping.
    @property
    def provider(self) -> str:
        return 'claude-code'

    @property
    def name(self) -> str:
        return f'claude-code/{self.model}'

    @property
    def model_name(self) -> str:
        # browser_use's protocol reads this for its legacy path; without it the
        # loop dies with an AttributeError before the first page is fetched.
        return self.model

    def __str__(self) -> str:
        return self.name

    async def ainvoke(
        self,
        messages: list,
        output_format: Any = None,
        **_: Any,
    ) -> Any:
        """
        One turn. `messages` is browser_use's list; images inside it survive.

        `output_format`, when given, is described in the prompt and the reply
        is parsed into it. See _ask for why it is not a --json-schema argument.
        """
        payload = _to_stream_json(messages, _schema_of(output_format))
        text = await self._ask(payload)

        # With an output_format, browser_use expects the parsed object, not the
        # JSON that describes it. Returning the string works right up until the
        # loop reads `.completion.action`, which is far from where the mistake
        # was made.
        if output_format is not None:
            return _Completion(_parse_into(text, output_format))
        return _Completion(text)

    async def _ask(self, payload: str) -> str:
        args = [
            self._cli,
            '-p',
            '--input-format', 'stream-json',
            # The CLI insists these three travel together.
            '--output-format', 'stream-json',
            '--verbose',
            '--model', self.model,
            # No tools, no filesystem, no shell. Dex is the agent here; the CLI
            # is being asked for one judgement about one page, and a browsing
            # brain that could quietly go and read files would be a serious and
            # surprising escalation.
            #
            # `--permission-mode plan` is deliberately NOT passed, and it used to
            # be. Measured on the same call: 10.8s with it, 5.4s without — and
            # over a fifteen-step browse that is the difference between eighty
            # seconds and one hundred and sixty. Worse, plan mode occasionally
            # makes the CLI answer *about* planning ("this request doesn't fit
            # the plan-mode workflow") rather than about the page, which is a
            # derailment on a call that has nothing to do with editing code.
            #
            # It was never the safety property anyway. An empty --allowedTools
            # is: with no tools there is nothing to permit.
            '--allowedTools', '',
        ]

        # `--json-schema` is deliberately not used, and it was, twice over:
        #
        #   "The command line is too long."   browser_use's action schema is
        #       about 17 KB and a Windows command line caps well below that
        #       once the .CMD shim has wrapped it.
        #   "unknown keyword: min_items"      the schema it generates is
        #       pydantic's, and the CLI validates strictly.
        #
        # So the shape is described in the prompt instead — the same thing the
        # planner's Claude Code provider does — and the reply is parsed. That
        # is strictly less enforcement than a real schema, which is why
        # _parse_into raises loudly rather than returning a half-built object.

        process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # No console window, matching every other subprocess in Dex.
            creationflags=0x08000000 if os.name == 'nt' else 0,
        )

        try:
            out, err = await asyncio.wait_for(
                process.communicate(payload.encode('utf-8')),
                timeout=CALL_TIMEOUT,
            )
        except asyncio.TimeoutError:
            process.kill()
            raise RuntimeError(
                f'{self.name} did not answer within {CALL_TIMEOUT}s. The Claude '
                'Code CLI starts cold on every call; a very large page can push '
                'it past this. Try Fast mode, or add an Anthropic key in '
                'Settings — the API path answers in seconds because there is no '
                'CLI to start.'
            ) from None

        result = _result_of(out.decode('utf-8', 'replace'))
        if result is None:
            detail = err.decode('utf-8', 'replace').strip() or 'no result in the reply'
            hint = ''
            if 'not logged in' in detail.lower() or 'unauthor' in detail.lower():
                hint = ' — run `claude` in a terminal once and sign in'
            elif 'usage limit' in detail.lower() or 'rate' in detail.lower():
                hint = ' — the Claude Code usage limit is reached; it resets on its own'
            raise RuntimeError(f'{self.name} failed: {detail[:400]}{hint}')

        return result


class _Completion:
    """
    What browser_use expects back.

    Its own ChatInvokeCompletion is a pydantic model with required fields; this
    stands in for it with the same attribute names, so the loop reads
    `.completion` and `.usage` without either side knowing the difference.
    """

    def __init__(self, completion) -> None:
        self.completion = completion
        self.content = completion
        self.usage = None
        self.thinking = None
        self.redacted_thinking = None
        self.stop_reason = None
        self.stop_details = None

    def __str__(self) -> str:
        return str(self.completion)


def _parse_into(text: str, output_format):
    """
    The model's JSON, as the class the caller asked for.

    Tolerant about wrapping — a model told to answer in JSON sometimes adds a
    sentence in front of it — and honest about failing: an unparseable answer
    raises here, where the reason is still visible, rather than becoming an
    object with missing fields that fails three frames later.
    """
    payload = _first_object(text)
    if payload is None:
        raise ValueError(
            f'{output_format.__name__ if hasattr(output_format, "__name__") else "the model"} '
            f'expected JSON and got: {text[:200]}'
        )

    if hasattr(output_format, 'model_validate_json'):
        return output_format.model_validate_json(payload)
    if hasattr(output_format, 'model_validate'):
        return output_format.model_validate(json.loads(payload))
    return json.loads(payload)


def _first_object(text: str) -> str | None:
    """The outermost {...} in a reply, scanning from both ends."""
    stripped = text.strip()
    if stripped.startswith('{') and stripped.endswith('}'):
        return stripped
    start = stripped.find('{')
    end = stripped.rfind('}')
    if start == -1 or end <= start:
        return None
    return stripped[start:end + 1]


def _to_stream_json(messages: list, schema: str | None = None) -> str:
    """
    browser_use's messages, as the CLI's streaming input.

    Images are carried through as base64 blocks rather than dropped. That is the
    entire point of this path — a browsing model that cannot see the page is
    the configuration being replaced.

    System messages are folded into the first user turn, because stream-json
    input has no separate system role and a system prompt silently discarded
    would take the loop's instructions with it.
    """
    system: list = []
    turns: list = []

    for message in messages:
        role = _role_of(message)
        blocks = _blocks_of(message)
        if not blocks:
            continue
        if role == 'system':
            system.extend(blocks)
        else:
            turns.append({'role': role, 'content': blocks})

    if system and turns:
        first = next((t for t in turns if t['role'] == 'user'), None)
        if first is not None:
            first['content'] = system + first['content']
        else:
            turns.insert(0, {'role': 'user', 'content': system})
    elif system:
        turns.append({'role': 'user', 'content': system})

    # The required shape, as text on the last user turn.
    if schema and turns:
        last = next((t for t in reversed(turns) if t['role'] == 'user'), None)
        if last is not None:
            last['content'] = list(last['content']) + [{
                'type': 'text',
                'text': (
                    'Reply with ONE JSON object and nothing else — no prose, no '
                    'code fence. It must satisfy this JSON Schema:' + chr(10) + schema
                ),
            }]

    lines = [
        json.dumps({'type': 'user', 'message': turn})
        for turn in turns
        if turn['role'] == 'user'
    ]
    # Only user turns are sent. The CLI keeps no conversation across a `-p`
    # call, so browser_use's assistant turns are history rather than something
    # to replay; they are already summarised into the user content it builds.
    return '\n'.join(lines) + '\n'


def _role_of(message: Any) -> str:
    role = getattr(message, 'role', None) or (
        message.get('role') if isinstance(message, dict) else None
    )
    role = str(role or 'user').lower()
    return role if role in ('user', 'system', 'assistant') else 'user'


def _blocks_of(message: Any) -> list:
    """
    Anthropic content blocks from whatever shape browser_use used.

    Deliberately liberal: the library has changed its message classes more than
    once, and a brittle reader here would fail as an unexplained empty prompt
    rather than as an error anyone could act on.
    """
    content = getattr(message, 'content', None)
    if content is None and isinstance(message, dict):
        content = message.get('content')

    if isinstance(content, str):
        return [{'type': 'text', 'text': content}] if content.strip() else []

    blocks: list = []
    for part in content or []:
        kind = getattr(part, 'type', None) or (
            part.get('type') if isinstance(part, dict) else None
        )

        if kind == 'text':
            text = getattr(part, 'text', None) or (
                part.get('text') if isinstance(part, dict) else ''
            )
            if text and str(text).strip():
                blocks.append({'type': 'text', 'text': str(text)})
            continue

        if kind in ('image_url', 'image'):
            data, media = _image_of(part)
            if data:
                blocks.append({
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': media,
                        'data': data,
                    },
                })
            continue

        if isinstance(part, str) and part.strip():
            blocks.append({'type': 'text', 'text': part})

    return blocks


def _image_of(part: Any) -> tuple:
    """Base64 and media type, from any of the shapes an image arrives in."""
    holder = getattr(part, 'image_url', None) or (
        part.get('image_url') if isinstance(part, dict) else None
    )
    url = ''
    if isinstance(holder, str):
        url = holder
    elif holder is not None:
        url = getattr(holder, 'url', None) or (
            holder.get('url') if isinstance(holder, dict) else ''
        ) or ''

    if url.startswith('data:'):
        head, _, data = url.partition(',')
        media = head[5:].split(';')[0] or 'image/png'
        return data, media

    source = getattr(part, 'source', None) or (
        part.get('source') if isinstance(part, dict) else None
    )
    if isinstance(source, dict) and source.get('data'):
        return source['data'], source.get('media_type', 'image/png')

    # A path or raw bytes, which some versions pass directly.
    if isinstance(url, str) and url and os.path.exists(url):
        with open(url, 'rb') as handle:
            return base64.b64encode(handle.read()).decode(), 'image/png'

    return '', 'image/png'


def _schema_of(output_format: Any) -> str | None:
    """The caller's required shape as a JSON Schema string, for the prompt."""
    if output_format is None:
        return None
    try:
        if hasattr(output_format, 'model_json_schema'):
            return json.dumps(output_format.model_json_schema())
        if isinstance(output_format, dict):
            return json.dumps(output_format)
    except Exception as exc:  # noqa: BLE001 - a schema that cannot be built is not fatal
        log.debug('could not build a schema: %s', exc)
    return None


def _unfence(text: str) -> str:
    """
    Drop a ```json wrapper if the model added one.

    Asked for JSON it usually returns JSON, and sometimes returns JSON inside a
    code fence. Both are the model doing what was asked; only one of them
    parses, so the fence is removed here rather than defended against at every
    call site.
    """
    stripped = text.strip()
    if not stripped.startswith('```'):
        return text
    newline = chr(10)
    body = stripped.split(newline, 1)[1] if newline in stripped else ''
    end = body.rfind('```')
    return (body[:end] if end != -1 else body).strip()


def _result_of(stdout: str) -> str | None:
    """The `result` line out of the CLI's stream."""
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get('type') == 'result':
            result = event.get('result')
            if isinstance(result, str):
                return _unfence(result)
            if result is not None:
                return json.dumps(result)
    return None
