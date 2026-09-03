"""
Where the index lives, and what it remembers about a file.

Its own database, `%LOCALAPPDATA%\\DEX\\index.db`, deliberately not the core's
`dex.db`. Three reasons: it is written by a Python process while dex.db belongs
to the Node core, it is large and disposable where dex.db is small and precious,
and "delete the index and rebuild it" should never be a sentence that risks the
owner's task history.

SQLite FTS5 for the text. Two searchable surfaces per file:

    the path      name, folders, extension — how most files are found
    the content   extracted text and OCR — how a file called scan001.jpg is
                  found by the words printed inside it

Kept as one FTS table with both columns rather than two tables, so a single
query ranks a filename match and a content match against each other instead of
needing them merged afterwards.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

# One connection per thread. SQLite objects are not shareable across threads and
# the crawler is threaded; a shared handle here would fail intermittently and
# only under load, which is the worst way for it to fail.
_local = threading.local()

# Held while a connection is being set up. Switching a database to WAL takes an
# exclusive lock, and six crawler threads opening a brand-new index at the same
# moment all try to take it at once: "database is locked", on the very first
# crawl and never afterwards. The setup is serialised; the queries are not.
_setup = threading.Lock()


def index_path() -> Path:
    base = os.environ.get('DEX_INDEX_DB')
    if base:
        return Path(base)
    root = os.environ.get('LOCALAPPDATA') or os.environ.get('USERPROFILE') or '.'
    return Path(root) / 'DEX' / 'index.db'


SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ext         TEXT,
  size        INTEGER,
  modified    REAL,
  -- When this row was last looked at, so a rescan can skip unchanged files and
  -- a sweep can drop rows for files that no longer exist.
  indexed_at  REAL,
  -- 'none' until the file is opened, then 'text' | 'ocr' | 'skipped' | 'failed'.
  -- Recorded so a rescan does not retry OCR on the same unreadable scan
  -- forever, and so "why was this not found" has an answer.
  content     TEXT NOT NULL DEFAULT 'none'
);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_files_ext  ON files(ext);

-- The searchable surface. `path_text` is the path with separators turned into
-- spaces, so "UI INSPIRATIONS" is three tokens and matches a search for either.
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  path UNINDEXED,
  path_text,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""


def connect() -> sqlite3.Connection:
    existing = getattr(_local, 'conn', None)
    if existing is not None:
        return existing

    path = index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=60)
    # Wait rather than fail when another thread is mid-write. The crawler is
    # threaded by design, so contention is the normal case, not an error.
    conn.execute('PRAGMA busy_timeout = 60000')

    with _setup:
        # WAL so a search during a crawl is not blocked by it. An index nobody
        # can read while it is being built is an index nobody can use on the
        # day they install Dex.
        #
        # Asked first: the pragma is a no-op when it is already WAL, but it
        # still takes the exclusive lock to find that out.
        current = conn.execute('PRAGMA journal_mode').fetchone()
        if not current or str(current[0]).lower() != 'wal':
            conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        conn.executescript(SCHEMA)

    _local.conn = conn
    return conn


def upsert(path: str, name: str, ext: str, size: int, modified: float,
           body: str, kind: str, now: float) -> None:
    """Record one file. Replaces whatever was there for that path."""
    conn = connect()
    with conn:
        conn.execute(
            'INSERT INTO files (path, name, ext, size, modified, indexed_at, content) '
            'VALUES (?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(path) DO UPDATE SET '
            'name=excluded.name, ext=excluded.ext, size=excluded.size, '
            'modified=excluded.modified, indexed_at=excluded.indexed_at, '
            'content=excluded.content',
            (path, name, ext, size, modified, now, kind),
        )
        conn.execute('DELETE FROM search WHERE path = ?', (path,))
        conn.execute(
            'INSERT INTO search (path, path_text, body) VALUES (?, ?, ?)',
            (path, tokenise_path(path), body or ''),
        )


def tokenise_path(path: str) -> str:
    """
    A path as words.

    `C:\\Users\\cheth\\Desktop\\UI\\UI INSPIRATIONS\\UI.png` becomes
    `C Users cheth Desktop UI UI INSPIRATIONS UI png`, so a search for "UI" or
    "inspirations" or "desktop" reaches it. Without this the whole path is one
    token and only an exact match finds anything, which is why a search for
    `UI.png` on the Desktop missed a file called exactly that.
    """
    out = []
    for chunk in path.replace('\\', ' ').replace('/', ' ').split():
        out.append(chunk)
        # Also split on the separators that appear inside names, so
        # `aadhaar_card_scan.pdf` matches "aadhaar" and "card".
        for piece in chunk.replace('.', ' ').replace('_', ' ').replace('-', ' ').split():
            if piece and piece != chunk:
                out.append(piece)
    return ' '.join(out)


def needs_reindex(path: str, modified: float, size: int) -> bool:
    """
    Whether this file has changed since it was last looked at.

    Compared on mtime and size rather than a hash: hashing every file on a
    rescan would read the whole disk to answer a question the filesystem
    already answers, and the pair together is what every backup tool uses.
    """
    row = connect().execute(
        'SELECT modified, size FROM files WHERE path = ?', (path,),
    ).fetchone()
    if row is None:
        return True
    return abs((row[0] or 0) - modified) > 1e-6 or (row[1] or -1) != size


def forget(path: str) -> None:
    conn = connect()
    with conn:
        conn.execute('DELETE FROM files WHERE path = ?', (path,))
        conn.execute('DELETE FROM search WHERE path = ?', (path,))


def sweep(before: float, under: list | None = None) -> int:
    """
    Drop rows the last crawl did not touch — files that have been deleted.

    Run only after a crawl that completed, because a crawl that was interrupted
    has not touched everything it should have, and sweeping on that would
    forget files that are still there.

    `under` confines it to what the crawl actually covered. Without that, a
    crawl of one folder deletes the index of everything outside it — measured:
    indexing a temp directory reported `removed: 1448`, which was the whole
    Desktop, gone because it had not been visited this time.
    """
    conn = connect()
    with conn:
        if under:
            clause = ' AND (' + ' OR '.join('lower(path) LIKE ?' for _ in under) + ')'
            args = [before] + [r.lower().rstrip('\\/') + '%' for r in under]
        else:
            clause, args = '', [before]
        stale = [r[0] for r in conn.execute(
            'SELECT path FROM files WHERE indexed_at < ?' + clause, args,
        )]
        for path in stale:
            conn.execute('DELETE FROM files WHERE path = ?', (path,))
            conn.execute('DELETE FROM search WHERE path = ?', (path,))
    return len(stale)


def stats() -> dict:
    conn = connect()
    total = conn.execute('SELECT COUNT(*) FROM files').fetchone()[0]
    by_kind = dict(conn.execute(
        'SELECT content, COUNT(*) FROM files GROUP BY content',
    ).fetchall())
    return {
        'files': total,
        'with_text': by_kind.get('text', 0),
        'with_ocr': by_kind.get('ocr', 0),
        'not_read': by_kind.get('none', 0) + by_kind.get('skipped', 0),
        'failed': by_kind.get('failed', 0),
        'database': str(index_path()),
        'built': get_state('last_crawl'),
    }


def set_state(key: str, value: str) -> None:
    conn = connect()
    with conn:
        conn.execute(
            'INSERT INTO state (key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            (key, value),
        )


def get_state(key: str) -> str | None:
    row = connect().execute('SELECT value FROM state WHERE key = ?', (key,)).fetchone()
    return row[0] if row else None
