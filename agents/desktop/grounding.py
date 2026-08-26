"""
Grounding: turning "the Save button" into a pixel the mouse can be sent to.

This is the one job in Dex where the *prompt format* matters more than the model.
Measured on a synthetic UI with known control centres, the same model produced:

    "reply with {"x": <int>, "y": <int>}"      Save button off by 1359 px
    normalized box, 0-1000                     Save button off by 1 px

Same model, same screenshot, same target. Asking a general vision model for raw
pixel coordinates in a 2560-wide image asks it to be a ruler; a normalized box
asks it to point.

UI-TARS is the exception, and it earns it: trained for this task, it answers in
the pixel space of the image it was given and is *more* accurate that way.
Measured against the same fixture — 6px median versus Gemini's 22px, at 0.4s a
call instead of 1.5s. So the coordinate convention is declared per backend
rather than guessed, because guessing it wrong moves the click by hundreds of
pixels while looking entirely reasonable.

Every backend downscales first. A 2560x1440 screenshot does not merely run
slowly through Qwen2.5-VL — it kills the runner outright.

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


def parse_point(text: str, width: int, height: int, space: str = 'image') -> dict | None:
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
            return _to_pixels((xmin + xmax) / 2, (ymin + ymax) / 2, 'normalized', width, height)

    obj = re.search(r'\{[^{}]*"x"\s*:\s*(-?[\d.]+)[^{}]*"y"\s*:\s*(-?[\d.]+)[^{}]*\}', text)
    if obj:
        return _to_pixels(float(obj.group(1)), float(obj.group(2)), space, width, height)

    point = re.search(r'<point>\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*</point>', text)
    if point:
        return _to_pixels(float(point.group(1)), float(point.group(2)), space, width, height)

    action = re.search(r'start_box\s*=\s*[\'"]?\(?\s*(-?[\d.]+)[,\s]+(-?[\d.]+)', text)
    if action:
        return _to_pixels(float(action.group(1)), float(action.group(2)), space, width, height)

    pair = re.search(r'[\(\[]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[\)\]]', text)
    if pair:
        return _to_pixels(float(pair.group(1)), float(pair.group(2)), space, width, height)

    loose = re.findall(r'-?\d+\.?\d*', text)
    if len(loose) >= 2:
        return _to_pixels(float(loose[0]), float(loose[1]), space, width, height)

    return None


def _to_pixels(x: float, y: float, space: str, width: int, height: int) -> dict:
    """
    Convert a model's answer into screen pixels.

    The convention is passed in rather than guessed. An earlier version inferred
    it — "both values under 1000 means normalized" — which is wrong exactly when
    it matters: UI-TARS answering (992, 637) about a 1154px-wide image is
    absolute, and treating it as normalized moves the click 150px.

      'normalized'  0-1000 grid          (Gemini, Claude)
      'image'       pixels of the image the model was given (UI-TARS)
    """
    if space == 'normalized':
        return {'x': int(x / 1000 * width), 'y': int(y / 1000 * height)}
    return {'x': int(x), 'y': int(y)}


# Qwen2.5-VL — which UI-TARS 1.5 is built on — expands an image into vision
# tokens by area. A 2560x1440 screenshot (3.7M px) does not merely run slowly:
# it takes the llama-server runner down with it, and Ollama reports only
# "an error was encountered while running the model".
#
# Measured on an RX 6800M (12 GB):
#     3.7M px  crashes the runner
#     1.0M px  works, 0.4s median once warm
#     0.75M px works, and noticeably less accurate
MAX_IMAGE_PIXELS = 1_000_000


def prepare_image(screenshot_b64: str, max_pixels: int = MAX_IMAGE_PIXELS):
    """
    Shrink a screenshot to something a vision model can actually take.

    Returns the encoded image plus the factors needed to map a coordinate in
    that image back to the real screen. Losing those factors is how a grounded
    click lands in the wrong half of a 4K display.
    """
    import base64
    import io

    from PIL import Image

    with Image.open(io.BytesIO(base64.b64decode(screenshot_b64))) as img:
        width, height = img.size
        scale = min((max_pixels / (width * height)) ** 0.5, 1.0)
        if scale >= 1.0:
            return screenshot_b64, width, height, 1.0, 1.0

        new_w, new_h = int(width * scale), int(height * scale)
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        resized.convert('RGB').save(buf, format='PNG')
        encoded = base64.b64encode(buf.getvalue()).decode()

    return encoded, new_w, new_h, width / new_w, height / new_h


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
            image, width, height, sx, sy = prepare_image(screenshot_b64)
            resp = requests.post(
                f'{self.endpoint}/api/generate',
                json={
                    'model': self.model,
                    'prompt': UITARS_PROMPT.format(target=target),
                    'images': [image],
                    'stream': False,
                    'options': {'temperature': 0, 'num_predict': 64},
                },
                timeout=180,
            )
            if not resp.ok:
                log.error('UI-TARS HTTP %s: %s', resp.status_code, resp.text[:200])
                return None

            # UI-TARS answers in the pixel space of the image it was handed, so
            # the answer has to come back through the same resize.
            point = parse_point(resp.json().get('response', ''), width, height, space='image')
            return None if point is None else {
                'x': int(point['x'] * sx),
                'y': int(point['y'] * sy),
            }
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
            # Normalized output means the resize does not change the mapping —
            # it only saves tokens and upload time.
            image, _, _, _, _ = prepare_image(screenshot_b64)
            width, height = _dimensions(screenshot_b64)
            body = {
                'contents': [{'parts': [
                    {'inline_data': {'mime_type': 'image/png', 'data': image}},
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
                data['candidates'][0]['content']['parts'][0]['text'],
                width, height, space='normalized',
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
            image, _, _, _, _ = prepare_image(screenshot_b64)
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
                                'data': image,
                            },
                        },
                        {'type': 'text', 'text': NORMALIZED_PROMPT.format(target=target)},
                    ],
                }],
            )
            return parse_point(response.content[0].text, width, height, space='normalized')
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
