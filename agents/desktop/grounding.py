"""
Grounding: resolves natural-language UI element descriptions to pixel coordinates.

Two backends:
  1. UI-TARS via Ollama (local, free, fastest) — used when Ollama is running with ui-tars model
  2. Claude Vision (Anthropic API) — automatic fallback, works with no local setup
"""
import json
import logging

import anthropic

log = logging.getLogger('Grounding')


class ClaudeGrounding:
    """Uses Claude Vision to locate UI elements. Works out of the box, no local GPU."""

    def __init__(self, client: anthropic.Anthropic):
        self.client = client

    def resolve(self, screenshot_b64: str, target: str) -> dict | None:
        try:
            response = self.client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=128,
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
                        {
                            'type': 'text',
                            'text': (
                                f'Locate "{target}" in this screenshot. '
                                'Reply with ONLY valid JSON: {"x": <int>, "y": <int>} '
                                'using the center pixel of the element. '
                                'If not visible, reply with {"x": null, "y": null}.'
                            ),
                        },
                    ],
                }],
            )
            text = response.content[0].text.strip()
            start, end = text.find('{'), text.rfind('}') + 1
            if start >= 0 and end > start:
                data = json.loads(text[start:end])
                if data.get('x') is not None:
                    return {'x': int(data['x']), 'y': int(data['y'])}
        except Exception as exc:
            log.error(f'Claude grounding error: {exc}')
        return None


class UITarsGrounding:
    """Uses UI-TARS-1.5-7B via Ollama for grounding. Faster and free after initial pull."""

    def __init__(self, endpoint: str = 'http://localhost:11434'):
        self.endpoint = endpoint

    def resolve(self, screenshot_b64: str, target: str) -> dict | None:
        import requests
        try:
            resp = requests.post(
                f'{self.endpoint}/api/generate',
                json={
                    'model': 'ui-tars',
                    'prompt': (
                        f'Locate the UI element: "{target}". '
                        'Return ONLY JSON: {"x": <int>, "y": <int>}'
                    ),
                    'images': [screenshot_b64],
                    'stream': False,
                },
                timeout=30,
            )
            if resp.ok:
                text = resp.json().get('response', '')
                start, end = text.find('{'), text.rfind('}') + 1
                if start >= 0 and end > start:
                    data = json.loads(text[start:end])
                    if data.get('x') is not None:
                        return {'x': int(data['x']), 'y': int(data['y'])}
        except Exception as exc:
            log.error(f'UI-TARS grounding error: {exc}')
        return None


def make_grounding(api_key: str, ollama_endpoint: str = 'http://localhost:11434'):
    """Auto-select the best available grounding backend."""
    try:
        import requests
        resp = requests.get(f'{ollama_endpoint}/api/tags', timeout=2)
        if resp.ok:
            models = [m['name'] for m in resp.json().get('models', [])]
            if any('ui-tars' in m.lower() for m in models):
                log.info('Grounding: UI-TARS via Ollama')
                return UITarsGrounding(ollama_endpoint)
    except Exception:
        pass

    log.info('Grounding: Claude Vision (Ollama/UI-TARS not available)')
    return ClaudeGrounding(anthropic.Anthropic(api_key=api_key))
