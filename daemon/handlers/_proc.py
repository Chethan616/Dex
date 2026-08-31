"""
The one place a handler decides whether a command actually succeeded.

Windows console tools do not agree on how to report failure. netsh writes its
errors to *stdout*, exits 1, and leaves stderr completely empty. Measured on
this machine:

    netsh interface ipv4 show dnsservers name="NoSuchAdapter123"
      exit   = 1
      stdout = "The filename, directory name, or volume label syntax is incorrect."
      stderr = ""

The network handler used to guard with `if returncode != 0 and result.stderr`,
which that failure walks straight past: the code is non-zero but stderr is
falsy, so nothing was raised and the error text was returned as the success
payload. `set_dns` reported that it had worked while changing nothing — exactly
the claim-versus-proof confusion the rest of Dex exists to prevent, sitting
inside the layer that is supposed to produce the proof.

The rule, in one place so it cannot drift per file: **a non-zero exit is a
failure, whichever stream carried the message.**
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass

DEFAULT_TIMEOUT = 15

# Never let a child put a console on the owner's desktop.
#
# This is not belt and braces — it is load-bearing. The daemon and the agents
# run under `pythonw.exe`, which is the GUI-subsystem build and therefore has
# no console at all. A console program started from a process with no console
# gets a **brand new, visible one**. So without this flag every `netsh`, every
# `tasklist`, every DPAPI decrypt flashes a black rectangle on screen — one per
# call, in the middle of whatever the owner was doing.
#
# The failure is easy to miss in development, where these processes are
# launched from a terminal and quietly inherit its console instead. It only
# appears once Dex starts itself, which is exactly when nobody is watching a
# log. Every subprocess call in the daemon and the agents passes this.
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

# Phrases Windows uses when a command needed rights the caller did not have.
# Recognising them is not special-casing an action — every privileged action
# fails this way, and "requires elevation" is a far more actionable thing to put
# in front of the owner than the raw text with an exit code.
_ELEVATION_HINTS = (
    'requires elevation',
    'run as administrator',
    'access is denied',
    'requested operation requires',
)


@dataclass
class Completed:
    """What a command did. Returned only by [try_run]."""

    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    @property
    def message(self) -> str:
        """Whatever the process actually said, from whichever stream it used."""
        return (self.stderr.strip() or self.stdout.strip() or
                f'exited {self.returncode} with no output')


class CommandFailed(RuntimeError):
    """A command Dex ran did not succeed. Carries what it said and why."""

    def __init__(self, cmd: list[str], result: Completed):
        self.cmd = cmd
        self.result = result
        self.needs_elevation = any(
            hint in result.message.lower() for hint in _ELEVATION_HINTS
        )

        detail = result.message
        if self.needs_elevation:
            detail += (
                ' — this needs an elevated daemon. Run '
                'scripts/install-daemon-service.ps1 once, or start the daemon '
                'from an Administrator terminal.'
            )
        super().__init__(f'{cmd[0]} failed ({result.returncode}): {detail}')


def try_run(cmd: list[str], timeout: int = DEFAULT_TIMEOUT) -> Completed:
    """
    Run a command and hand back what happened, raising nothing.

    For callers that genuinely branch on the exit code — `taskkill` returning
    non-zero because the process was already gone is information, not an error.
    """
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout,
        creationflags=NO_WINDOW,
    )
    return Completed(proc.returncode, proc.stdout or '', proc.stderr or '')


def run(cmd: list[str], timeout: int = DEFAULT_TIMEOUT) -> str:
    """
    Run a command, or raise [CommandFailed] explaining what it said.

    Use this everywhere the command is expected to work. Returns stdout.
    """
    result = try_run(cmd, timeout=timeout)
    if not result.ok:
        raise CommandFailed(cmd, result)
    return result.stdout
