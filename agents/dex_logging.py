"""
Logging for the agent servers, which run with no console.

Two things this has to survive, and the first one is fatal if missed:

**`sys.stdout` and `sys.stderr` are None under pythonw.exe.** The servers are
started by `run-dev.ps1` with the GUI-subsystem interpreter so they have no
console window. `logging.basicConfig()` with no handlers installs a
`StreamHandler` on `sys.stderr`, which is None, and that raises during startup —
a server that dies before it can log why, with no console to show the traceback
and no file to look in.

**A background process with no log cannot be debugged.** Once the window is
gone, the file is the only thing left. So the file handler is not a nicety, it
is the whole output.

Mirrors `_log_handlers()` in daemon/DexDaemon.py, which has the same problem for
the same reason.
"""
from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def log_dir() -> Path:
    base = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
    return Path(base) / 'DEX'


def configure(name: str, level: int = logging.INFO) -> logging.Logger:
    """
    Set up logging for an agent server and return its logger.

    `name` also names the file: "app" -> %LOCALAPPDATA%\\DEX\\app.log.
    """
    handlers: list[logging.Handler] = []

    # Only when there is somewhere to write. See the module docstring.
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler(sys.stderr))

    try:
        directory = log_dir()
        directory.mkdir(parents=True, exist_ok=True)
        handlers.append(
            RotatingFileHandler(
                directory / f'{name}.log', maxBytes=1_000_000, backupCount=2,
                encoding='utf-8',
            )
        )
    except OSError:
        # A server that cannot open its log still has a job to do.
        pass

    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
        handlers=handlers,
        force=True,
    )

    logger = logging.getLogger(name)
    logger.info('Log file: %s', log_dir() / f'{name}.log')
    return logger
