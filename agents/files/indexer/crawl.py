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
    """
    Whether to descend into a folder at all.

    The dot rule is the one that matters, and it is a rule rather than a list
    on purpose. A first crawl of this machine spent 21,000 files and 1,885 OCR
    calls inside `.codex`, `.gemini`, `.claude`, `.antigravity-ide` and
    `.cursor` — every AI tool's cache — and had still not reached the Desktop.
    Naming those five would have fixed today and missed the sixth tool
    installed next month.

    A leading dot means "configuration and cache, not documents" on every
    platform, and nothing the owner would search for is filed that way.
    """
    lowered = name.lower()
    return (
        lowered in SKIP_DIRS
        or name.startswith('$')
        or name.startswith('.')
    )


def skip_hidden(path: Path) -> bool:
    """
    Folders Windows itself marks hidden or system.

    Catches what a name rule cannot know about: a vendor cache with an ordinary
    name, a per-user store some installer created. The owner's own folders are
    not marked this way.
    """
    if os.name != 'nt':
        return False
    import ctypes

    attributes = ctypes.windll.kernel32.GetFileAttributesW(str(path))
    if attributes == -1:
        return False
    FILE_ATTRIBUTE_HIDDEN = 0x2
    FILE_ATTRIBUTE_SYSTEM = 0x4
    return bool(attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM))


# A OneDrive file that is not on this disk.
#
# With Files On-Demand a cloud file has a normal name, a normal size, and no
# bytes. *Opening* it downloads it, silently and over the network. An indexer
# that reads every file would therefore pull down the owner's entire cloud
# storage the first time it ran — metered data, hours of transfer, and a full
# disk, all as a side effect of a search.
#
# So a placeholder is indexed by name and never opened. It stays findable, and
# it is read the moment the owner has the file locally.
FILE_ATTRIBUTE_OFFLINE = 0x1000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
CLOUD_ONLY = (
    FILE_ATTRIBUTE_OFFLINE
    | FILE_ATTRIBUTE_RECALL_ON_OPEN
    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)


def is_cloud_only(path: Path) -> bool:
    if os.name != 'nt':
        return False
    import ctypes

    attributes = ctypes.windll.kernel32.GetFileAttributesW(str(path))
    return attributes != -1 and bool(attributes & CLOUD_ONLY)


# What counts as a drive worth indexing.
#
# 3 is DRIVE_FIXED and 4 is DRIVE_REMOTE. Network volumes are included because
# a mapped share is somewhere the owner genuinely keeps files, and a "search my
# pc" that silently excludes half of where things are is the same defect as
# searching only Downloads.
#
# Removable (2) stays out: a USB stick indexed today is a list of files that
# are not there tomorrow, and a search would offer paths that cannot be opened.
DRIVE_FIXED = 3
DRIVE_REMOTE = 4


def fixed_drives() -> list:
    """Local and mapped-network volumes. Removable media is deliberately left out."""
    if os.name != 'nt':
        return [Path('/')]

    import ctypes

    drives = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not (mask >> i) & 1:
            continue
        letter = chr(65 + i) + ':' + chr(92)
        kind = ctypes.windll.kernel32.GetDriveTypeW(letter)
        if kind in (DRIVE_FIXED, DRIVE_REMOTE):
            drives.append(Path(letter))
    return drives


# Where the owner's own files actually are, in the order they matter.
#
# A crawl of a home directory is minutes long, and what it visits first decides
# whether a search works during those minutes. Left alphabetical, `.antigravity`
# and `.claude` come before `CrossDevice` and `Desktop` -- which is exactly what
# happened: 21,000 files indexed and not one of them the owner's.
#
# CrossDevice is here because it is where this machine's phone transfers land,
# which is where a scanned document is most likely to be.
PRIORITY = (
    'Desktop', 'Documents', 'Downloads', 'Pictures', 'CrossDevice',
    'OneDrive', 'Videos', 'Music',
)

# The registry values Windows keeps for the folders it has moved.
#
# Asked rather than assumed, because on this machine the Desktop is not under
# the home directory at all: OneDrive Known Folder Move redirected it into the
# OneDrive folder. Special-casing OneDrive would fix this machine and miss the
# person who redirected Documents onto a D: drive or a share.
SHELL_FOLDERS = {
    'Desktop': 'Desktop',
    'Documents': 'Personal',
    'Downloads': '{374DE290-123F-4565-9164-39C4925E467B}',
    'Pictures': 'My Pictures',
    'Videos': 'My Video',
    'Music': 'My Music',
}

USER_SHELL_FOLDERS = (
    'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'
)


def known_folder(name: str) -> Path | None:
    """Where Windows says this folder is now, which is not always where it was."""
    value = SHELL_FOLDERS.get(name)
    if not value or os.name != 'nt':
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, USER_SHELL_FOLDERS) as key:
            raw, _ = winreg.QueryValueEx(key, value)
        return Path(os.path.expandvars(raw))
    except OSError:
        return None


def owner_folders() -> list:
    """The priority folders, wherever they actually are, without duplicates."""
    home = Path.home()
    out: list = []
    for name in PRIORITY:
        for candidate in (known_folder(name), home / name):
            if candidate and candidate.is_dir() and candidate not in out:
                out.append(candidate)
                break
    return out


def roots(scope: str) -> list:
    """
    Where to start, from what the owner said.

    'pc' means the PC. That sounds obvious and is the whole bug this replaces:
    `find_files` defaulted to Downloads, so "search my pc" searched one folder
    and confidently reported what it found there.

    The owner's folders come first in every scope, so a partial index is a
    useful one. `crawl` skips what it has already visited, so the overlap
    between these and the drive they sit on costs nothing.
    """
    scope = (scope or 'profile').strip()
    ordered = owner_folders()

    if scope.lower() == 'pc':
        return ordered + [Path.home()] + fixed_drives()
    if scope.lower() == 'profile':
        return ordered + [Path.home()]
    return [Path(os.path.expandvars(scope)).expanduser()]


def walk(root: Path, seen_dirs: set | None = None):
    """
    Every file under `root`, as `os.DirEntry`, skipping what is not the owner's.

    `scandir` rather than `os.walk` for one reason that is worth the extra
    lines: on Windows a directory listing already carries each entry's size and
    timestamps, and `DirEntry.stat()` hands them back without touching the
    disk again. `os.walk` discards them, so the caller pays a second syscall
    per file — across a few hundred thousand files that is most of the crawl.
    """
    stack = [Path(root)]
    while stack:
        current = stack.pop()
        lowered = str(current).lower()

        if any(lowered.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue

        # Already walked under an earlier root. The owner's folders sit inside
        # the home directory that follows them, so without this each one would
        # be crawled twice.
        if seen_dirs is not None:
            if lowered in seen_dirs:
                continue
            seen_dirs.add(lowered)

        try:
            entries = list(os.scandir(current))
        except OSError:
            continue

        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    if not skip_dir(entry.name) and not skip_hidden(Path(entry.path)):
                        stack.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    yield entry
            except OSError:
                continue


# How many files go into one transaction.
#
# Large enough that the commit is amortised, small enough that a crawl
# interrupted halfway has still saved almost everything it walked.
BATCH = 500


def _split(batch: list) -> tuple:
    """
    A batch, split into what has changed and what has not.

    The index is asked once for the whole batch rather than once per file,
    which is the same reason the writes are batched: the cost is the round
    trip, not the row.
    """
    existing = store.known([row[0] for row in batch])
    fresh, same = [], []
    for row in batch:
        was = existing.get(row[0])
        if was and abs((was[0] or 0) - row[4]) < 1e-6 and (was[1] or -1) == row[3]:
            same.append(row[0])
        else:
            fresh.append(row)
    return fresh, same


def crawl(scope: str = 'profile', on_progress=None, read_contents: bool = True) -> dict:
    """
    Index everything under `scope`, names first.

    Two passes, and the order is the point. Measured on this machine, a crawl
    that reads contents as it goes manages about 18 files a second, because
    every image costs an OCR call — so nothing at all is findable for the first
    hour, including files whose *name* is the whole answer.

    So: every file is recorded by name first, batched, and the index is
    searchable by name within minutes. Contents fill in afterwards, and a
    search running in between says which pass it is answering from.

    Returns counts. Safe to run again: unchanged files are recognised by mtime
    and size, and a rescan writes one integer for each rather than
    re-tokenising every path on the disk.
    """
    started = time.time()
    seen = indexed = skipped = 0
    batch: list = []

    def commit(rows: list) -> None:
        nonlocal indexed, skipped
        fresh, same = _split(rows)
        indexed += len(fresh)
        skipped += len(same)
        now = time.time()
        store.upsert_many(fresh, now)
        store.touch_many(same, now)

    # Single-threaded on purpose. The work here is a stat and a string, and
    # SQLite serialises writers anyway — the threads that helped while this
    # pass also did OCR would now only contend for the write lock.
    seen_dirs: set = set()
    for root in roots(scope):
        for entry in walk(root, seen_dirs):
            seen += 1
            try:
                # Free on Windows: the directory listing already carried this.
                info = entry.stat()
            except OSError:
                continue

            name = entry.name
            dot = name.rfind('.')
            batch.append((entry.path, name, name[dot:].lower() if dot > 0 else '',
                          info.st_size, info.st_mtime, '', 'none'))

            if len(batch) >= BATCH:
                commit(batch)
                batch = []
                # A crawl is a detached process that can be killed with the
                # machine. Without a heartbeat the core cannot tell "still
                # working" from "died halfway", and half-read contents would
                # stay half-read forever.
                store.set_state('heartbeat', str(time.time()))
                if on_progress and seen % PROGRESS_EVERY < BATCH:
                    on_progress(seen, indexed)

    commit(batch)

    # Only after a pass that finished. An interrupted crawl has not touched
    # everything it should have, and sweeping on that forgets live files.
    removed = store.sweep(started, [str(r) for r in roots(scope)])
    store.set_state('names_done', time.strftime('%Y-%m-%d %H:%M:%S'))

    named_in = round(time.time() - started, 1)
    read = 0
    if read_contents:
        read = fill_contents(scope, on_progress)

    store.set_state('last_crawl', time.strftime('%Y-%m-%d %H:%M:%S'))
    store.set_state('last_scope', scope)

    return {
        'scope': scope,
        'seen': seen,
        'indexed': indexed,
        'unchanged': skipped,
        'removed': removed,
        'searchable_by_name_after': named_in,
        'contents_read': read,
        'seconds': round(time.time() - started, 1),
    }


def fill_contents(scope: str = 'profile', on_progress=None) -> int:
    """
    Read what the names pass deliberately left unread.

    Ordered so that the folders the owner actually uses are read first, for
    the same reason the crawl visits them first: a half-finished pass should
    be half-finished in the useful direction.
    """
    prefixes = [str(r).lower() for r in roots(scope)]
    rows = store.pending_contents(prefixes)
    done = 0

    def handle(row: tuple) -> None:
        nonlocal done
        path_text, size = row
        path = Path(path_text)
        try:
            info = path.stat()
        except OSError:
            store.forget(path_text)
            return

        body, kind = ('', 'skipped') if is_cloud_only(path) else extract(path, info.st_size)
        store.upsert(
            path_text, path.name, path.suffix.lower(), info.st_size,
            info.st_mtime, body, kind, time.time(),
        )
        done += 1

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = []
        for row in rows:
            futures.append(pool.submit(handle, row))
            if len(futures) >= WORKERS * 8:
                for future in futures:
                    future.result()
                futures.clear()
                store.set_state('heartbeat', str(time.time()))
                if on_progress:
                    on_progress(len(rows), done)
        for future in futures:
            future.result()

    return done


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
