/**
 * The file-search index: one SQLite database, one connection, shared by the
 * scanner, the content backfill, and every query.
 *
 * `files` holds metadata for every file seen; `files_fts` is a plain (not
 * external-content) FTS5 table over name/content, keyed by the same integer
 * id, so a query is one join with no separate content store to keep in sync
 * by hand. `path` is stored UNINDEXED on the FTS row purely so a query result
 * never needs a second lookup — it is never part of the MATCH itself, which
 * keeps a folder name from silently padding a query's relevance.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';

export interface FileRecord {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
}

export type ContentState = 'pending' | 'indexed' | 'unsupported' | 'error';

interface FileRow {
  id: number;
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
  content_state: ContentState;
}

let db: Database.Database | null = null;

export function openIndexDb(userDataPath: string): Database.Database {
  if (db) return db;
  stmtCache.clear();
  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, 'dex-index.sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      dir TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      content_state TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_files_content_state ON files(content_state);
    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, content, path UNINDEXED, tokenize='unicode61'
    );
  `);
  mainLogger.info('search.db.opened', { dbPath });
  return db;
}

export function closeIndexDb(): void {
  stmtCache.clear();
  db?.close();
  db = null;
}

function requireDb(): Database.Database {
  if (!db) throw new Error('search index database not opened yet');
  return db;
}

/**
 * Prepared-statement cache.
 *
 * better-sqlite3 is fully synchronous and runs on whichever thread calls it —
 * here, the main process thread that also serves every IPC call the UI makes.
 * Every function below used to call `stmt(sql)` inline, which
 * re-parses and re-compiles the SQL *on every invocation*. During a scan
 * that is 2-4 compilations per file across hundreds of thousands of files,
 * all of it blocking the event loop, which is what made unrelated UI actions
 * queue up behind indexing. Compiling each distinct statement once and
 * reusing it is what prepared statements are for.
 *
 * Keyed by the SQL text itself so callers stay readable; cleared whenever the
 * database handle goes away, since a Statement is bound to its Database.
 */
const stmtCache = new Map<string, Database.Statement>();

function stmt(sql: string): Database.Statement {
  const cached = stmtCache.get(sql);
  if (cached) return cached;
  const prepared = requireDb().prepare(sql);
  stmtCache.set(sql, prepared);
  return prepared;
}

/**
 * Run `fn` inside a single SQLite transaction.
 *
 * Without this every insert commits on its own, so a bulk scan pays full
 * per-row commit overhead hundreds of thousands of times. Batching is the
 * difference between an index build that saturates the main thread and one
 * that stays out of the way.
 */
export function runInTransaction<T>(fn: () => T): T {
  return requireDb().transaction(fn)();
}

/**
 * Insert or refresh a file's metadata and its FTS name entry.
 *
 * A changed mtime means the file was edited since its content (if any) was
 * extracted, so it goes back to `pending` for the backfill pass to pick up
 * again; an unchanged one keeps whatever content_state it already had, so a
 * routine rescan does not throw away completed content indexing.
 */
export function upsertFileMeta(record: FileRecord): number {
  requireDb();
  const existing = stmt('SELECT id, mtime, content_state FROM files WHERE path = ?').get(record.path) as
    | Pick<FileRow, 'id' | 'mtime' | 'content_state'>
    | undefined;

  if (existing) {
    const changed = existing.mtime !== record.mtime;
    const nextState: ContentState = changed ? 'pending' : existing.content_state;
    stmt('UPDATE files SET name = ?, ext = ?, dir = ?, size = ?, mtime = ?, content_state = ? WHERE id = ?')
      .run(record.name, record.ext, record.dir, record.size, record.mtime, nextState, existing.id);
    stmt('UPDATE files_fts SET name = ? WHERE rowid = ?').run(record.name, existing.id);
    if (changed) stmt("UPDATE files_fts SET content = '' WHERE rowid = ?").run(existing.id);
    return existing.id;
  }

  const info = stmt('INSERT INTO files (path, name, ext, dir, size, mtime) VALUES (?, ?, ?, ?, ?, ?)')
    .run(record.path, record.name, record.ext, record.dir, record.size, record.mtime);
  const id = Number(info.lastInsertRowid);
  stmt("INSERT INTO files_fts (rowid, name, path, content) VALUES (?, ?, ?, '')")
    .run(id, record.name, record.path);
  return id;
}

/** Drop a file that no longer exists (seen by the watcher, or a rescan that finds it gone). */
export function removeFileByPath(filePath: string): void {
  requireDb();
  const row = stmt('SELECT id FROM files WHERE path = ?').get(filePath) as { id: number } | undefined;
  if (!row) return;
  stmt('DELETE FROM files WHERE id = ?').run(row.id);
  stmt('DELETE FROM files_fts WHERE rowid = ?').run(row.id);
}

/** The next batch of files whose content has not been extracted yet, most recently modified first. */
export function nextPendingBatch(limit: number): Array<Pick<FileRow, 'id' | 'path' | 'ext' | 'size'>> {
  return stmt("SELECT id, path, ext, size FROM files WHERE content_state = 'pending' ORDER BY mtime DESC LIMIT ?")
    .all(limit) as Array<Pick<FileRow, 'id' | 'path' | 'ext' | 'size'>>;
}

export function setContent(id: number, content: string, state: ContentState): void {
  stmt('UPDATE files SET content_state = ? WHERE id = ?').run(state, id);
  if (content) stmt('UPDATE files_fts SET content = ? WHERE rowid = ?').run(content, id);
}

export interface CandidateRow {
  path: string;
  name: string;
  content: string;
  size: number;
  mtime: number;
}

/**
 * A broad, cheap candidate set for one query: any file whose name or content
 * contains any of the given literal terms, OR'd together. Precision comes
 * later, in rank.ts — this only needs to not miss anything worth scoring.
 */
export function ftsCandidates(matchTerms: string[], cap: number): CandidateRow[] {
  if (matchTerms.length === 0) return [];
  requireDb();
  // FTS5 query syntax: quote each term so punctuation (the "-1" in "slp da - 1")
  // can never be parsed as a MATCH operator.
  const expr = matchTerms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  return stmt(
      `SELECT f.path AS path, f.name AS name, fts.content AS content, f.size AS size, f.mtime AS mtime
       FROM files_fts fts JOIN files f ON f.id = fts.rowid
       WHERE files_fts MATCH ?
       LIMIT ?`,
    )
    .all(expr, cap) as CandidateRow[];
}

export function indexStats(): { total: number; indexed: number; pending: number } {
  requireDb();
  const total = (stmt('SELECT COUNT(*) c FROM files').get() as { c: number }).c;
  const indexed = (stmt("SELECT COUNT(*) c FROM files WHERE content_state = 'indexed'").get() as { c: number }).c;
  const pending = (stmt("SELECT COUNT(*) c FROM files WHERE content_state = 'pending'").get() as { c: number }).c;
  return { total, indexed, pending };
}
