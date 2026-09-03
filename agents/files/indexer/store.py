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
import time
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


def write(action) -> None:
    """
    Run a write, waiting out another process that is mid-batch.

    `busy_timeout` covers a writer that arrives while another holds the lock,
    but not the case that actually happens here: a transaction that begins by
    reading and then tries to write after someone else has committed. SQLite
    answers that one with SQLITE_BUSY immediately and does not apply the
    timeout, because retrying is only safe if the caller re-reads — which is
    exactly what starting the batch again does.

    Seen for real when a second crawl was started while the first was running:
    "database is locked", from a `busy_timeout` of sixty seconds.
    """
    delay = 0.05
    for attempt in range(8):
        try:
            action()
            return
        except sqlite3.OperationalError as exc:
            if 'locked' not in str(exc) and 'busy' not in str(exc):
                raise
            if attempt == 7:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 2.0)


def claim(scope: str, stale_after: float = 300.0) -> bool:
    """
    Take the right to be the crawler, if nobody else holds it.

    One crawl at a time, because two of them do not go twice as fast: SQLite
    serialises writers, so a second crawler mostly waits, and the two together
    do less work than either alone would.

    The claim goes stale on its own. A crawl is a detached process that can be
    killed with the machine, and a lock that outlives the process holding it
    would mean the index silently stops updating until someone deletes a row
    they do not know about.
    """
    age = _heartbeat_age()
    if get_state('crawling') and age is not None and age < stale_after:
        return False
    set_state('crawling', scope)
    set_state('heartbeat', str(time.time()))
    return True


def release() -> None:
    set_state('crawling', '')


def known(paths: list) -> dict:
    """`{path: (modified, size, content)}` for the ones already recorded."""
    if not paths:
        return {}
    conn = connect()
    out: dict = {}
    # Chunked because SQLite limits how many parameters one statement may
    # carry, and a crawl batch can be larger than that limit.
    for start in range(0, len(paths), 400):
        chunk = paths[start:start + 400]
        placeholders = ','.join('?' for _ in chunk)
        for path, modified, size, content in conn.execute(
            f'SELECT path, modified, size, content FROM files WHERE path IN ({placeholders})',
            chunk,
        ):
            out[path] = (modified, size, content)
    return out


def touch_many(paths: list, now: float) -> None:
    """
    Mark files as still present, without touching their text.

    The difference between this and a full upsert is the whole cost of a
    rescan. An unchanged file needs one integer written; rewriting its
    full-text row instead means re-tokenising every path on the disk to
    discover that nothing has changed.
    """
    if not paths:
        return
    conn = connect()

    def go() -> None:
        with conn:
            conn.executemany(
                'UPDATE files SET indexed_at = ? WHERE path = ?',
                [(now, path) for path in paths],
            )

    write(go)


def upsert_many(rows: list, now: float) -> None:
    """
    Record many files in one transaction.

    One transaction per file measured at about 35 files a second on this
    machine, against 330 for the same work batched: the cost is the commit,
    not the write. A crawl is hundreds of thousands of files, so this is the
    difference between an index that is ready in minutes and one that is ready
    after lunch.

    `rows` are `(path, name, ext, size, modified, body, kind)`.
    """
    if not rows:
        return
    conn = connect()

    def go() -> None:
        with conn:
            conn.executemany(
                'INSERT INTO files (path, name, ext, size, modified, indexed_at, content) '
                'VALUES (?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(path) DO UPDATE SET '
                'name=excluded.name, ext=excluded.ext, size=excluded.size, '
                'modified=excluded.modified, indexed_at=excluded.indexed_at, '
                'content=excluded.content',
                [(r[0], r[1], r[2], r[3], r[4], now, r[6]) for r in rows],
            )
            conn.executemany(
                'DELETE FROM search WHERE path = ?', [(r[0],) for r in rows],
            )
            conn.executemany(
                'INSERT INTO search (path, path_text, body) VALUES (?, ?, ?)',
                [(r[0], tokenise_path(r[0]), r[5] or '') for r in rows],
            )

    write(go)


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


def pending_contents(prefixes: list, limit: int = 200_000) -> list:
    """
    Files recorded by name whose contents have not been read yet.

    Includes the ones a previous pass could not open. That is deliberate: a
    file on a sleeping phone is not an unreadable file, and marking it read
    would mean it never gets looked at again.

    Ordered by the root they sit under, so the second pass reads the owner's
    Desktop before the rest of the disk — a pass that is only half finished
    should be half finished in the useful direction.
    """
    conn = connect()
    if not prefixes:
        return conn.execute(
            "SELECT path, size FROM files WHERE content IN ('none', 'unread') LIMIT ?",
            (limit,),
        ).fetchall()

    ordering = ' '.join(
        f'WHEN lower(path) LIKE ? THEN {rank}' for rank, _ in enumerate(prefixes)
    )
    args = [p.lower().rstrip('\/') + '%' for p in prefixes]
    return conn.execute(
        "SELECT path, size FROM files WHERE content IN ('none', 'unread') "
        f'ORDER BY CASE {ordering} ELSE 999 END LIMIT ?',
        [*args, limit],
    ).fetchall()


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
        'could_not_open': by_kind.get('unread', 0),
        'failed': by_kind.get('failed', 0),
        'database': str(index_path()),
        'built': get_state('last_crawl'),
        # Names first: the index is fully searchable by name long before every
        # scan has been through OCR, and a search should be able to say which
        # of those two it is answering from.
        'names_done': get_state('names_done'),
        'pending': by_kind.get('none', 0) + by_kind.get('unread', 0),
        # Seconds since the running crawl last wrote a batch. None when no
        # crawl has ever run. This is how the core tells a crawl that is
        # working from one that was killed with the machine.
        'heartbeat_age': _heartbeat_age(),
        'crawling': bool(get_state('crawling')),
    }


def _heartbeat_age() -> float | None:
    raw = get_state('heartbeat')
    if not raw:
        return None
    try:
        return round(time.time() - float(raw), 1)
    except ValueError:
        return None


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
