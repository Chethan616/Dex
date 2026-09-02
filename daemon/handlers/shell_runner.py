"""
Running commands.

Two actions, deliberately:

  `run_shell`    the original, unchanged. Seven read-only programs, no policy
                 to reason about. Old plans and saved workflows keep working
                 exactly as they did.
  `run_command`  banded by command_policy — GREEN silently, AMBER after the
                 owner confirms, RED refused. This is what makes git, npm,
                 compilers, hashing and port listings possible.

The band is decided here, in the daemon, and reported back so the core can
raise the right confirmation card. Deciding it in the core instead would put the
only copy of the policy on the far side of a pipe from the thing that runs the
command — which is precisely the arrangement that let `set_dns` report success
for months without ever executing.
"""
from __future__ import annotations

import json

import logging
import os
import subprocess

from ._proc import NO_WINDOW
from .command_policy import AMBER, GREEN, RED, classify, guard

log = logging.getLogger('ShellRunner')

# The original allowlist. Kept as-is: it is the GREEN floor, and `run_shell` is
# still what a plan should use when a read is all it needs.
ALLOWED = {
    'ipconfig', 'netsh', 'powercfg', 'tasklist',
    'systeminfo', 'whoami', 'hostname',
}

# Output is truncated before it crosses the pipe. `tasklist` on a busy machine
# or `git log` without a limit runs to megabytes, and the planner is going to
# read this — an unbounded result is a bill and a context overflow, not detail.
MAX_OUTPUT = 24_000


class ShellRunner:

    @staticmethod
    def run(params: dict) -> dict:
        """The original read-only action. Unchanged behaviour."""
        command = _as_list(params.get('command', []))
        if not command:
            raise ValueError('No command provided')

        base = os.path.basename(command[0]).lower()
        if base.endswith('.exe'):
            base = base[:-4]
        if base not in ALLOWED:
            raise PermissionError(
                f'"{base}" is not in the read-only allowlist: {sorted(ALLOWED)}. '
                'Use run_command for anything else — it classifies the command '
                'and asks before changing something.'
            )

        return _execute(command, params, band=GREEN)

    @staticmethod
    def run_command(params: dict) -> dict:
        """
        Run a command, subject to its band.

        RED raises here and never runs. AMBER runs — the confirmation card is
        the core's job, and by the time the daemon sees the request the owner
        has already answered it. What the daemon guarantees is the part no
        approval can override: RED stays refused.
        """
        command = _as_list(params.get('command', []))
        if not command:
            raise ValueError('run_command needs a command')

        band, reason = guard(command)
        log.info('run_command [%s] %s — %s', band, command[0], reason)
        return _execute(command, params, band=band, reason=reason)

    @staticmethod
    def classify_command(params: dict) -> dict:
        """
        What band would this command fall into?

        Lets the planner ask before committing to a step, the same way
        `registry_classify` does — and lets the confirmation card say "this will
        install Python packages" rather than showing a command line.
        """
        command = _as_list(params.get('command', []))
        if not command:
            raise ValueError('classify_command needs a command')
        band, reason = classify(command)
        return {
            'band': band,
            'reason': reason,
            'will_run_silently': band == GREEN,
            'needs_confirmation': band == AMBER,
            'refused': band == RED,
        }


def _as_list(command) -> list:
    """
    Always a list of arguments, never a string handed to a shell.

    A string is split rather than passed through, so `shell=True` is never
    needed anywhere in this file. That is what keeps quoting an argument-parsing
    question instead of a security one.
    """
    if isinstance(command, str):
        import shlex
        return shlex.split(command, posix=False)
    return [str(part) for part in command]


def _execute(command: list, params: dict, band: str, reason: str = '') -> dict:
    timeout = int(params.get('timeout', 60))
    cwd = params.get('cwd')

    if cwd:
        cwd = os.path.abspath(os.path.expandvars(str(cwd)))
        if not _inside_profile(cwd):
            raise PermissionError(
                f'Refused: "{cwd}" is outside your user profile. Dex runs '
                'commands in folders you own.'
            )
        if not os.path.isdir(cwd):
            raise ValueError(f'No such directory: {cwd}')

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd or None,
        creationflags=NO_WINDOW,
        errors='replace',
    )

    stdout, out_clipped = _clip(result.stdout or '')
    stderr, err_clipped = _clip(result.stderr or '')

    return {
        'command': ' '.join(command),
        'band': band,
        'what_it_does': reason,
        'stdout': stdout,
        'stderr': stderr,
        'returncode': result.returncode,
        'truncated': out_clipped or err_clipped,
        # Reported rather than raised. A non-zero exit is often the answer —
        # `git diff --quiet` returns 1 to mean "there are changes" — and the
        # caller decides whether that is a failure.
        'ok': result.returncode == 0,
        # The output, parsed, when it is JSON.
        #
        # A later step can point at a field of this — `{{step_1.output.best}}`
        # — which is how one step uses what another measured. Without it the
        # winner of a DNS benchmark is a line of text inside `stdout`, and the
        # only thing pointing at it can produce is the string "stdout".
        #
        # Absent rather than null when the output is not JSON, so a reference
        # to a field of it fails loudly instead of resolving to nothing.
        **({'json': parsed} if (parsed := _as_json(stdout)) is not None else {}),
    }


def _as_json(text: str):
    """
    The output as an object, or None.

    Only a complete JSON object or array counts. A bare number or a quoted
    string is almost always coincidence — `echo 5` is not structured output —
    and treating it as such would put a `json` field on results that have no
    structure to offer.
    """
    stripped = (text or '').strip()
    if not stripped or stripped[0] not in '{[':
        return None
    try:
        value = json.loads(stripped)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, (dict, list)) else None


def _clip(text: str) -> tuple:
    if len(text) <= MAX_OUTPUT:
        return text, False
    half = MAX_OUTPUT // 2
    return (
        f'{text[:half]}\n... [{len(text) - MAX_OUTPUT} characters omitted] ...\n{text[-half:]}',
        True,
    )


def _inside_profile(path: str) -> bool:
    profile = os.path.abspath(os.path.expanduser('~'))
    try:
        return os.path.commonpath([profile, os.path.abspath(path)]) == profile
    except ValueError:
        # Different drives — commonpath raises rather than returning nothing.
        return False
