"""
Worker + Reflection agent loop — the core of the Desktop Agent.

Architecture mirrors Agent-S3 (simular-ai):
  Worker:     perceives screen → decides next action
  Grounding:  maps target description → pixel coordinates
  Executor:   performs the action
  Reflection: checks if action succeeded (lightweight, inline)

The Worker is provider-agnostic (see worker_providers.py) — Anthropic, Groq,
or the Claude Code CLI can all answer "what's the next action", selected the
same way agents/browser/agent_runner.py selects its own LLM. Grounding stays
UI-TARS-first (local, free, already provider-flexible) regardless of which
Worker is in use.

Phase C of the vision-first migration: this loop now runs the WHOLE task
(can_operate_computer), not just a GUI sub-instruction handed to it after
other deterministic tiers already ran (can_control_gui). MAX_STEPS is raised
accordingly, and it carries the same two bounded-failure mechanisms already
proven for the browser's own loop (agents/browser/agent_runner.py):
consecutive PROVIDER failures (parse/API errors — a failure to decide at
all, not a bad-but-real decision) and a stuck detector (the same action on
the same target repeated with no progress). Both give up cleanly with a
specific reason instead of exhausting the step budget silently.
"""
import logging

from worker_providers import WorkerProvider

log = logging.getLogger('AgentLoop')

# A whole task needs more budget than a GUI sub-instruction did — this was
# 20 when the loop only ever ran after deterministic tiers had done most of
# the work. Re-tune empirically as real tasks are run through it.
MAX_STEPS = 40

# Mirrors agents/browser/agent_runner.py's MAX_CONSECUTIVE_LLM_FAILURES: a
# reasoning-provider failure (not a bad decision — a failure to decide at
# all) this many times in a row means give up, not keep trying the same
# call forever.
MAX_CONSECUTIVE_WORKER_FAILURES = 3

# Mirrors agent_runner.py's STUCK_REPEAT_THRESHOLD: the same action on the
# same target this many times in a row, regardless of whether each
# individual attempt "succeeded", means the loop is not making progress.
STUCK_REPEAT_THRESHOLD = 4

# History is kept as plain text and grows without bound otherwise. Once it
# would exceed this many characters, older steps are summarized down to a
# count instead of full detail — a long task should not silently lose the
# original goal to context pressure.
MAX_HISTORY_CHARS = 4000


class AgentLoop:
    def __init__(self, worker: WorkerProvider, grounding):
        self.worker = worker
        self.grounding = grounding

    async def run(self, task: str, executor, on_step=None) -> dict:
        steps_taken: list[dict] = []
        consecutive_worker_failures = 0

        for step_num in range(MAX_STEPS):
            screenshot = executor.screenshot_b64()
            action = await self._worker_step(task, steps_taken, screenshot)

            if on_step:
                on_step(step_num, action)

            atype = action.get('action_type', '')
            log.info(f'Step {step_num + 1}: {atype} — {action.get("reasoning", "")[:100]}')

            # ── Bounded provider-failure escape hatch ───────────────────────
            # A provider failure (marked _provider_error by worker_providers.py
            # — a parse/HTTP failure, not a genuine model decision) must not
            # be treated the same as "the model decided to give up", and must
            # not be retried forever either. This is the exact anti-pattern a
            # live browser-agent run hit earlier this session: an unbounded
            # fallback masquerading as a real decision, burning the whole step
            # budget with no progress.
            if action.get('_provider_error'):
                consecutive_worker_failures += 1
                steps_taken.append({
                    'step': step_num + 1,
                    'action_type': 'provider_error',
                    'reasoning': action.get('failure_reason', ''),
                    'coords': None,
                    'ok': False,
                })
                if consecutive_worker_failures >= MAX_CONSECUTIVE_WORKER_FAILURES:
                    return {
                        'success': False,
                        'error': (
                            f'The reasoning provider ({self.worker.name}) failed '
                            f'{consecutive_worker_failures} times in a row: '
                            f'{action.get("failure_reason", "unknown error")}'
                        ),
                        'steps': steps_taken,
                    }
                # Not yet at the ceiling — try again next step rather than
                # ending the task on a single transient failure.
                continue
            consecutive_worker_failures = 0

            if atype == 'done':
                return {'success': True, 'steps': steps_taken}

            if atype == 'failed':
                # A genuine model decision to give up — distinct from a
                # provider error above, and not retried: the model looked at
                # the screen and concluded the task cannot be done.
                return {
                    'success': False,
                    'error': action.get('failure_reason', 'Agent reported failure'),
                    'steps': steps_taken,
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
                'target_description': action.get('target_description', ''),
                'coords': coords,
                'ok': ok,
            })

            # ── Stuck detector ───────────────────────────────────────────────
            # Same action, same target, repeated back to back: not
            # progressing, whatever `ok` says. Mirrors
            # agents/browser/agent_runner.py's stuck-loop check.
            recent = steps_taken[-STUCK_REPEAT_THRESHOLD:]
            if len(recent) == STUCK_REPEAT_THRESHOLD and all(
                s.get('action_type') == atype
                and s.get('target_description') == action.get('target_description', '')
                for s in recent
            ):
                return {
                    'success': False,
                    'error': (
                        f"Stuck: '{atype}' on "
                        f"{action.get('target_description') or '(no target)'} repeated "
                        f"{STUCK_REPEAT_THRESHOLD}x with no progress."
                    ),
                    'steps': steps_taken,
                }

            if not ok:
                return {
                    'success': False,
                    'error': f'Action execution failed at step {step_num + 1} ({atype})',
                    'steps': steps_taken,
                }

        return {
            'success': False,
            'error': f'Max steps ({MAX_STEPS}) reached without completing task',
            'steps': steps_taken,
        }

    async def _worker_step(self, task: str, steps_taken: list[dict], screenshot_b64: str) -> dict:
        history = _format_history(steps_taken)

        try:
            return await self.worker.decide(screenshot_b64, task, history)
        except Exception as err:  # noqa: BLE001
            log.warning(f'Worker ({self.worker.name}) decide failed: {err}')
            return {'action_type': 'failed', 'failure_reason': str(err), 'reasoning': '', '_provider_error': True}


def _format_history(steps_taken: list[dict]) -> str:
    """
    The full task text stays stable across every call (passed separately);
    this is just what's been done so far. Once it would grow past
    MAX_HISTORY_CHARS, older steps collapse to a count instead of full
    detail — a long task should not lose the ability to see recent
    context, but also should not spend the whole prompt budget on step 2's
    reasoning by step 40.
    """
    if not steps_taken:
        return ''

    lines = [
        f"  {s['step']}. {s['action_type']} — {s['reasoning']}"
        for s in steps_taken
    ]
    full = '\n\nCompleted steps:\n' + '\n'.join(lines)
    if len(full) <= MAX_HISTORY_CHARS:
        return full

    # Keep the most recent steps in full detail; summarize the rest by count.
    kept: list[str] = []
    total = len('\n\nCompleted steps:\n')
    for line in reversed(lines):
        if total + len(line) > MAX_HISTORY_CHARS:
            break
        kept.insert(0, line)
        total += len(line) + 1
    omitted = len(lines) - len(kept)
    summary = f'  ... ({omitted} earlier step(s) omitted) ...\n' if omitted > 0 else ''
    return '\n\nCompleted steps:\n' + summary + '\n'.join(kept)
