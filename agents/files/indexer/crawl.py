"""
Walking the disk, and knowing what not to walk.

The exclusions are the substance of this file, not housekeeping around it. Asked
to find an Aadhaar card, Dex once reported fifty matches for "aadhar" that were
all `values-ar.xml`, `R.txt` and `R.jar` from an Android build folder. An index
without these rules is a monument to build output: it is larger, slower, and
answers every question with generated files.

Two kinds of rule, and the difference matters:

    directories   never descended into at all — the whole subtree is skipped,
                  which is what makes a crawl of a developer's disk finish
    extensions    the file is still indexed by name, but not opened

So a `.exe` is findable by its name and never read; anything inside
`node_modules` does not exist as far as search is concerned.
"""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import store
from .extract import extract

log = logging.getLogger('Crawl')

# Whole subtrees, matched on the folder name at any depth, lowercased.
#
# Everything here is either the operating system, a package cache, or generated
# output. None of it is something the owner made or would look for.
SKIP_DIRS = {
    # Windows and installed software.
    'windows', 'winsxs', '$recycle.bin', 'system volume information',
    'program files', 'program files (x86)', 'programdata', 'msocache',
    'recovery', 'perflogs', '$windows.~bt', '$windows.~ws',
    # Caches and package stores. The single largest win on a dev machine.
    'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv',
    'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
    '.gradle', '.m2', '.nuget', '.cargo', '.rustup', '.pub-cache',
    '.npm', '.yarn', '.pnpm-store', '.cache', 'appdata',
    # Build output. This is what produced the fifty "aadhar" matches.
    'build', 'dist', 'out', 'target', 'bin', 'obj', '.next', '.nuxt',
    '.dart_tool', '.idea', '.vs', '.vscode-server', 'cmakefiles',
    'intermediates', 'generated', 'debug', 'release',
}

# Never descended into, matched on the full path prefix.
SKIP_PREFIXES = ('c:\\windows', 'c:\\program files', 'c:\\programdata')

# A crawl is mostly waiting on the disk and on OCR, so threads help even in
# Python. Modest, because the owner is using the machine at the same time.
WORKERS = 6

# Reported this often so a first crawl shows progress rather than silence.
PROGRESS_EVERY = 400


def skip_dir(name: str) -> bool:
    return name.lower() in SKIP_DIRS or name.startswith('$')


def fixed_drives() -> list:
    """Local fixed drives. Network and removable are deliberately not indexed."""
    if os.name != 'nt':
        return [Path('/')]

    import ctypes

    drives = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not (mask >> i) & 1:
            continue
        letter = f'{chr(65 + i)}:\\'
        # 3 == DRIVE_FIXED. A USB stick or a mapped share is not the owner's
        # disk and indexing one would be slow, surprising, and stale.
        if ctypes.windll.kernel32.GetDriveTypeW(letter) == 3:
            drives.append(Path(letter))
    return drives


def roots(scope: str) -> list:
    """
    Where to start, from what the owner said.

    'pc' means the PC. That sounds obvious and is the whole bug this replaces:
    `find_files` defaulted to Downloads, so "search my pc" searched one folder
    and confidently reported what it found there.
    """
    scope = (scope or 'profile').strip()
    if scope.lower() == 'pc':
        return fixed_drives()
    if scope.lower() == 'profile':
        home = Path.home()
        return [home]
    return [Path(os.path.expandvars(scope)).expanduser()]


def walk(root: Path):
    """Every file under `root`, skipping the subtrees that are not the owner's."""
    for current, dirs, files in os.walk(root, topdown=True, onerror=lambda _: None):
        lowered = current.lower()
        if any(lowered.startswith(prefix) for prefix in SKIP_PREFIXES):
            dirs[:] = []
            continue

        # Pruned in place, so os.walk never descends. Filtering afterwards would
        # still pay for reading every directory underneath.
        dirs[:] = [d for d in dirs if not skip_dir(d)]

        for name in files:
            yield Path(current) / name


def crawl(scope: str = 'profile', on_progress=None, read_contents: bool = True) -> dict:
    """
    Index everything under `scope`.

    Returns counts. Safe to run again: unchanged files are recognised by mtime
    and size and are not reopened, so a rescan of a large disk costs a stat per
    file rather than a read.
    """
    started = time.time()
    seen = indexed = skipped = 0

    def handle(path: Path) -> str:
        nonlocal indexed, skipped
        try:
            info = path.stat()
        except OSError:
            return 'gone'

        text = str(path)
        if not store.needs_reindex(text, info.st_mtime, info.st_size):
            # Still touched, so the sweep does not mistake it for deleted.
            store.upsert(
                text, path.name, path.suffix.lower(), info.st_size,
                info.st_mtime, _existing_body(text), _existing_kind(text), time.time(),
            )
            skipped += 1
            return 'unchanged'

        body, kind = ('', 'none')
        if read_contents:
            body, kind = extract(path, info.st_size)

        store.upsert(
            text, path.name, path.suffix.lower(), info.st_size,
            info.st_mtime, body, kind, time.time(),
        )
        indexed += 1
        return kind

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = []
        for root in roots(scope):
            for path in walk(root):
                seen += 1
                futures.append(pool.submit(handle, path))

                if len(futures) >= WORKERS * 32:
                    for future in futures:
                        future.result()
                    futures.clear()
                    if on_progress and seen % PROGRESS_EVERY < WORKERS * 32:
                        on_progress(seen, indexed)

        for future in futures:
            future.result()

    # Only after a crawl that finished. An interrupted crawl has not touched
    # everything it should have, and sweeping on that forgets live files.
    removed = store.sweep(started, [str(r) for r in roots(scope)])
    store.set_state('last_crawl', time.strftime('%Y-%m-%d %H:%M:%S'))
    store.set_state('last_scope', scope)

    return {
        'scope': scope,
        'seen': seen,
        'indexed': indexed,
        'unchanged': skipped,
        'removed': removed,
        'seconds': round(time.time() - started, 1),
    }


def _existing_body(path: str) -> str:
    row = store.connect().execute(
        'SELECT body FROM search WHERE path = ?', (path,),
    ).fetchone()
    return row[0] if row else ''


def _existing_kind(path: str) -> str:
    row = store.connect().execute(
        'SELECT content FROM files WHERE path = ?', (path,),
    ).fetchone()
    return row[0] if row else 'none'
