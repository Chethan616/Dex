"""
Grounding: turning "the Save button" into a pixel the mouse can be sent to.

This is the one job in Dex where the *prompt format* matters more than the model.
Measured on a synthetic UI with known control centres, the same model produced:

    "reply with {"x": <int>, "y": <int>}"      Save button off by 1359 px
    normalized box, 0-1000                     Save button off by 1 px

Same model, same screenshot, same target. Asking a vision model for raw pixel
coordinates in a 2560-wide image asks it to be a ruler; asking for a normalized
box asks it to point. So every backend here uses a normalized format and
converts afterwards, and the parser accepts every shape these models actually
emit rather than one canonical one.

Backends, in the order they are preferred:
  1. UI-TARS via Ollama  — local, free, unlimited, trained for exactly this
  2. Gemini              — good at pointing; watch the project's daily quota
  3. Claude              — fallback

Only reached by Tier 3. Tiers 1 and 2 need no grounding at all, which is why
most tasks never load a vision model.
"""
from __future__ import annotations

import json
import logging
import os
import re

log = logging.getLogger('Grounding')

# UI-TARS is trained on this instruction. Deviating from it is the usual reason
# people report the model "not working".
UITARS_PROMPT = (
    'Output only the coordinate of one point in your response. '
    'What element matches the following task: {target}'
)

# Google's documented format for spatial output.
NORMALIZED_PROMPT = (
    'Locate "{target}" in this screenshot. Return ONLY JSON: '
    '[{{"box_2d":[ymin,xmin,ymax,xmax],"label":"{target}"}}] '
    'with coordinates normalized 0-1000. If it is not visible, return [].'
)


def parse_point(text: str, width: int, height: int) -> dict | None:
    """
    Accept every coordinate shape these models emit, and convert to pixels.

    Handles: (x,y) · [x,y] · {"x":..,"y":..} · box_2d [ymin,xmin,ymax,xmax] ·
    <point>x y</point> · click(start_box='(x,y)') · and bare numbers in prose.

    Being liberal here is deliberate. A model that answered correctly but in an
    unexpected wrapper would otherwise look like a grounding failure, and the
    recovery for that is a retry that produces the same unparsed answer.
    """
    if not text:
        return None
    text = text.strip()

    box = re.search(r'"box_2d"\s*:\s*\[([\d.,\s-]+)\]', text)
    if box:
        nums = [float(n) for n in box.group(1).split(',')]
        if len(nums) == 4:
            ymin, xmin, ymax, xmax = nums
            return _scale((xmin + xmax) / 2, (ymin + ymax) / 2, width, height, normalized=True)

    obj = re.search(r'\{[^{}]*"x"\s*:\s*(-?[\d.]+)[^{}]*"y"\s*:\s*(-?[\d.]+)[^{}]*\}', text)
    if obj:
        return _scale(float(obj.group(1)), float(obj.group(2)), width, height)

    point = re.search(r'<point>\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*</point>', text)
    if point:
        return _scale(float(point.group(1)), float(point.group(2)), width, height)

    action = re.search(r'start_box\s*=\s*[\'"]?\(?\s*(-?[\d.]+)[,\s]+(-?[\d.]+)', text)
    if action:
        return _scale(float(action.group(1)), float(action.group(2)), width, height)

    pair = re.search(r'[\(\[]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[\)\]]', text)
    if pair:
        return _scale(float(pair.group(1)), float(pair.group(2)), width, height)

    loose = re.findall(r'-?\d+\.?\d*', text)
    if len(loose) >= 2:
        return _scale(float(loose[0]), float(loose[1]), width, height)

    return None


def _scale(x: float, y: float, width: int, height: int, normalized: bool | None = None) -> dict:
    """
    UI-TARS 1.5 emits 0-1000; older builds emit absolute pixels. Both fitting
    inside 0-1000 on a larger screen means normalized.
    """
    if normalized is None:
        normalized = x <= 1000 and y <= 1000 and (width > 1000 or height > 1000)
    if normalized:
        return {'x': int(x / 1000 * width), 'y': int(y / 1000 * height)}
    return {'x': int(x), 'y': int(y)}


def _dimensions(screenshot_b64: str) -> tuple[int, int]:
    """Read the real size out of the image rather than assuming the screen's."""
    import base64
    import io

    from PIL import Image

    with Image.open(io.BytesIO(base64.b64decode(screenshot_b64))) as img:
        return img.size


class UITarsGrounding:
    """Local, unlimited, and trained for GUI grounding specifically."""

    def __init__(self, endpoint: str = 'http://localhost:11434', model: str | None = None) -> None:
        self.endpoint = endpoint
        self.model = model or os.environ.get('DEX_GROUNDING_MODEL', 'ui-tars')

    def resolve(self, screenshot_b64: str, target: str) -> dict | None:
        import requests

        try:
            width, height = _dimensions(screenshot_b64)
            resp = requests.post(
                f'{self.endpoint}/api/generate',
                json={
                    'model': self.model,
                    'prompt': UITARS_PROMPT.format(target=target),
                    'images': [screenshot_b64],
                    'stream': False,
                    'options': {'temperature': 0, 'num_predict': 64},
                },
                timeout=180,
            )
            if not resp.ok:
                log.error('UI-TARS HTTP %s: %s', resp.status_code, resp.text[:200])
                return None
            return parse_point(resp.json().get('response', ''), width, height)
        except Exception as exc:  # noqa: BLE001
            log.error('UI-TARS grounding error: %s', exc)
        return None


class GeminiGrounding:
    """Accurate on buttons; the daily quota is the thing to watch."""

    def __init__(self, api_key: str, model: str = 'gemini-2.5-flash') -> None:
        self.api_key = api_key
        self.model = model

    def resolve(self, screenshot_b64: str, target: str) -> dict | None:
        import urllib.request

        try:
            width, height = _dimensions(screenshot_b64)
            body = {
                'contents': [{'parts': [
                    {'inline_data': {'mime_type': 'image/png', 'data': screenshot_b64}},
                    {'text': NORMALIZED_PROMPT.format(target=target)},
                ]}],
                # Thinking adds latency and tokens to what is a pointing task.
                'generationConfig': {'temperature': 0, 'thinkingConfig': {'thinkingBudget': 0}},
            }
            req = urllib.request.Request(
                f'https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent',
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json', 'X-goog-api-key': self.api_key},
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
            return parse_point(
                data['candidates'][0]['content']['parts'][0]['text'], width, height,
            )
        except Exception as exc:  # noqa: BLE001
            log.error('Gemini grounding error: %s', exc)
        return None


class ClaudeGrounding:
    """Fallback. Works with no local setup, but every call is billed."""

    def __init__(self, client) -> None:
        self.client = client

    def resolve(self, screenshot_b64: str, target: str) -> dict | None:
        try:
            width, height = _dimensions(screenshot_b64)
            response = self.client.messages.create(
                model=os.environ.get('DEX_GROUNDING_MODEL_ANTHROPIC', 'claude-sonnet-4-6'),
                max_tokens=200,
                messages=[{
                    'role': 'user',
                    'content': [
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': 'image/png',
                                'data': screenshot_b64,
                            },
                        },
                        {'type': 'text', 'text': NORMALIZED_PROMPT.format(target=target)},
                    ],
                }],
            )
            return parse_point(response.content[0].text, width, height)
        except Exception as exc:  # noqa: BLE001
            log.error('Claude grounding error: %s', exc)
        return None


def make_grounding(api_key: str = '', ollama_endpoint: str = 'http://localhost:11434'):
    """
    Pick the best grounding backend available.

    Local first, always: it is free, has no daily quota, and no screenshot of
    the owner's desktop leaves the machine. A remote model is the fallback, not
    the default.
    """
    wanted = os.environ.get('DEX_GROUNDING_MODEL', 'ui-tars').lower()

    try:
        import requests

        resp = requests.get(f'{ollama_endpoint}/api/tags', timeout=2)
        if resp.ok:
            models = [m['name'] for m in resp.json().get('models', [])]
            match = next(
                (m for m in models if wanted in m.lower() or 'ui-tars' in m.lower()),
                None,
            )
            if match:
                log.info('Grounding: %s (local, via Ollama)', match)
                return UITarsGrounding(ollama_endpoint, model=match)
    except Exception:  # noqa: BLE001
        pass

    gemini = os.environ.get('GEMINI_API_KEY')
    if gemini:
        log.info('Grounding: Gemini (no local model found)')
        return GeminiGrounding(gemini)

    if api_key:
        import anthropic

        log.info('Grounding: Claude (no local model, no Gemini key)')
        return ClaudeGrounding(anthropic.Anthropic(api_key=api_key))

    raise RuntimeError(
        'No grounding backend available. Pull a UI-TARS model into Ollama, or '
        'set GEMINI_API_KEY / ANTHROPIC_API_KEY.'
    )
