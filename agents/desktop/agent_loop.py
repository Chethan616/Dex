"""
Worker + Reflection agent loop — the core of the Desktop Agent.

Architecture mirrors Agent-S3 (simular-ai):
  Worker:     perceives screen → decides next action
  Grounding:  maps target description → pixel coordinates
  Executor:   performs the action
  Reflection: checks if action succeeded (lightweight, inline)

Models used:
  Worker / Reflection: Claude Sonnet 4.6 Vision
  Grounding:           UI-TARS-1.5-7B (Ollama) or Claude Vision fallback
"""
import logging

import anthropic

log = logging.getLogger('AgentLoop')

MAX_STEPS = 20
WORKER_MODEL = 'claude-sonnet-4-6'

WORKER_SYSTEM = """\
You are the Worker in a Windows GUI automation loop.
You receive a screenshot of the current screen and must decide the SINGLE next GUI action.

Rules:
- Output exactly ONE action per call using take_gui_action.
- Be specific about UI targets — describe what you see on screen.
- To enter text: click the target field first, then use a separate type action.
- Prefer keyboard shortcuts over menu navigation when possible (Ctrl+S to save, etc.).
- When the full task is complete, output action_type="done".
- If stuck after repeated attempts, output action_type="failed" with a clear reason.\
"""

WORKER_TOOL = {
    'name': 'take_gui_action',
    'description': 'Decide and describe the next GUI action to take',
    'input_schema': {
        'type': 'object',
        'properties': {
            'reasoning': {
                'type': 'string',
                'description': 'One-sentence explanation of why this action is next',
            },
            'action_type': {
                'type': 'string',
                'enum': [
                    'click', 'double_click', 'right_click',
                    'type', 'key', 'scroll',
                    'open_app', 'done', 'failed',
                ],
            },
            'target_description': {
                'type': 'string',
                'description': 'Natural language description of the UI element to interact with',
            },
            'text': {
                'type': 'string',
                'description': 'Exact text to type (for action_type=type)',
            },
            'key_combo': {
                'type': 'string',
                'description': 'Key combination to press, e.g. "ctrl+s", "enter", "alt+f4"',
            },
            'app_name': {
                'type': 'string',
                'description': 'Application name to open (for action_type=open_app)',
            },
            'scroll_direction': {
                'type': 'string',
                'enum': ['up', 'down', 'left', 'right'],
            },
            'scroll_amount': {'type': 'integer', 'default': 3},
            'failure_reason': {
                'type': 'string',
                'description': 'Why the task cannot be completed (for action_type=failed)',
            },
        },
        'required': ['reasoning', 'action_type'],
    },
}


class AgentLoop:
    def __init__(self, api_key: str, grounding):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.grounding = grounding

    def run(self, task: str, executor, on_step=None) -> dict:
        steps_taken: list[dict] = []

        for step_num in range(MAX_STEPS):
            screenshot = executor.screenshot_b64()
            action = self._worker_step(task, steps_taken, screenshot)

            if on_step:
                on_step(step_num, action)

            atype = action.get('action_type', '')
            log.info(f'Step {step_num + 1}: {atype} — {action.get("reasoning", "")[:100]}')

            if atype == 'done':
                return {'success': True, 'steps': steps_taken}

            if atype == 'failed':
                return {
                    'success': False,
                    'error': action.get('failure_reason', 'Agent reported failure'),
                }

            # Resolve target → coordinates (for click-like actions)
            coords = None
            if atype in ('click', 'double_click', 'right_click', 'scroll'):
                target = action.get('target_description', '')
                if target:
                    coords = self.grounding.resolve(screenshot, target)
                    if not coords:
                        log.warning(f'Grounding returned no coords for: "{target}"')

            ok = executor.execute(action, coords)
            steps_taken.append({
                'step': step_num + 1,
                'action_type': atype,
                'reasoning': action.get('reasoning', ''),
                'coords': coords,
                'ok': ok,
            })

            if not ok:
                return {
                    'success': False,
                    'error': f'Action execution failed at step {step_num + 1} ({atype})',
                }

        return {
            'success': False,
            'error': f'Max steps ({MAX_STEPS}) reached without completing task',
        }

    def _worker_step(self, task: str, steps_taken: list[dict], screenshot_b64: str) -> dict:
        history = ''
        if steps_taken:
            lines = [
                f"  {s['step']}. {s['action_type']} — {s['reasoning']}"
                for s in steps_taken
            ]
            history = '\n\nCompleted steps:\n' + '\n'.join(lines)

        response = self.client.messages.create(
            model=WORKER_MODEL,
            max_tokens=512,
            system=WORKER_SYSTEM,
            tools=[WORKER_TOOL],
            tool_choice={'type': 'any'},
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
                        'text': f'Task: {task}{history}\n\nWhat is the single next action?',
                    },
                ],
            }],
        )

        tool_use = next((b for b in response.content if b.type == 'tool_use'), None)
        if not tool_use:
            return {'action_type': 'failed', 'failure_reason': 'Worker returned no action', 'reasoning': ''}

        return tool_use.input  # type: ignore[return-value]
