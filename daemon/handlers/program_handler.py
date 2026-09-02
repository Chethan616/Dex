"""
Is this program installed, and which one would run?

Two questions a plan has to be able to ask, and until now could only ask
awkwardly through `run_command ['where', 'gcc']` — which answers with a string
to parse, says nothing about *how* it was found, and cannot tell "not installed"
apart from "the shell had a bad day".

It matters most either side of an install:

    before   "set up a C compiler" should not reinstall a compiler that is
             already there. Asking first is the difference between a task that
             takes two seconds and one that downloads two hundred megabytes.

    after    an installer's exit code is a claim. `gcc --version` printing a
             version is evidence. The same rule this project applies to every
             other action applies to installing one.

Reuses `app_resolver.resolve` rather than reimplementing the search: that is
already the five-step ladder Windows itself uses — known names, App Paths,
PATH+PATHEXT, Start Menu shortcuts, packaged apps — and having two answers to
"where is chrome" would be one too many.
"""
from __future__ import annotations

import logging
import os
import struct

from . import app_resolver
from ._proc import try_run

log = logging.getLogger('ProgramHandler')

# Flags that make a program print its version and exit.
#
# Tried in order and the first that produces output wins. There is no standard:
# `gcc --version`, `java -version` (to stderr), `cl` (no flag at all, prints a
# banner). A program that answers none of them is still *found* — the path is
# the fact, the version is a bonus.
VERSION_FLAGS = (['--version'], ['-version'], ['-V'], ['version'])

VERSION_TIMEOUT = 15


class ProgramHandler:
    @staticmethod
    def find_program(params: dict) -> dict:
        """
        params:
          name      what to look for: "gcc", "node", "Google Chrome"
          version   ask it for its version too. Default true.

        Never raises for "not installed". That is an answer, and a plan that
        branches on it needs it as data rather than as an exception.
        """
        name = str(params.get('name', '')).strip()
        if not name:
            raise ValueError('find_program needs a name')

        try:
            found = app_resolver.resolve(name)
        except app_resolver.AppNotFound as exc:
            return {
                'name': name,
                'found': False,
                # The resolver's own message names every place it looked, which
                # is the difference between "not found" and a dead end.
                'reason': str(exc),
            }

        result = {
            'name': name,
            'found': True,
            'path': found.target,
            'source': found.method,
            'display': found.display or name,
        }

        # A Store app or a shell protocol has no executable to interrogate.
        if params.get('version', True) and not found.is_shell:
            version = _version_of(found.target)
            if version:
                result['version'] = version

        return result


def _version_of(target: str) -> str | None:
    """
    The program's own version string, or None.

    Deliberately tolerant about *how* the answer arrives. Many toolchains write
    their version to stderr and exit non-zero doing it — `java -version` is the
    famous one — so neither the stream nor the exit code decides. Output is
    output.

    Strict about *what is asked*, though. Handing `--version` to a GUI program
    does not print a version: it launches the application. `vivaldi --version`
    opened a browser window and sat there until the fifteen-second timeout, so
    a harmless-looking question left a window on the owner's screen. Only
    console programs are asked.
    """
    if not os.path.exists(target):
        return None
    if not _is_console_program(target):
        return None

    for flag in VERSION_FLAGS:
        try:
            result = try_run([target, *flag], timeout=VERSION_TIMEOUT)
        except Exception:  # noqa: BLE001 - a hung probe is not an error worth raising
            continue
        if result is None:
            continue
        text = ((result.stdout or '') + (result.stderr or '')).strip()
        if not text:
            continue
        # The first line is the version banner in every convention worth
        # supporting; the rest is licence text nobody asked for.
        return text.splitlines()[0].strip()[:200]

    return None


# IMAGE_SUBSYSTEM_WINDOWS_CUI — the one that means "has a console, will exit".
_SUBSYSTEM_CONSOLE = 3


def _is_console_program(target: str) -> bool:
    """
    Whether this executable is a console program.

    Read from the PE header rather than guessed from the file name, because the
    guesses are all wrong: `code.exe` is a GUI app that does answer --version,
    `python.exe` is a console app, and nothing about either name says so.

    The layout: the DOS header holds the PE offset at 0x3C; the PE signature is
    four bytes; the COFF header is twenty; the Subsystem field sits 68 bytes
    into the optional header that follows, in both PE32 and PE32+.

    Anything unreadable is treated as GUI — that is the cautious direction. A
    missed version string costs nothing; a launched application costs the owner
    a window they did not ask for.
    """
    try:
        with open(target, 'rb') as handle:
            if handle.read(2) != b'MZ':
                return False
            handle.seek(0x3C)
            pe_offset = struct.unpack('<I', handle.read(4))[0]
            handle.seek(pe_offset)
            if handle.read(4) != b'PE' + bytes(2):
                return False
            handle.seek(pe_offset + 4 + 20 + 68)
            subsystem = struct.unpack('<H', handle.read(2))[0]
            return subsystem == _SUBSYSTEM_CONSOLE
    except Exception:  # noqa: BLE001 - not a PE file, or not readable
        return False
