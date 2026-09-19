/**
 * db.ts's own branching logic — insert vs. update, the changed-mtime reset,
 * content backfill, removal — exercised against a fake `better-sqlite3`.
 *
 * Real `better-sqlite3` is compiled against Electron's ABI and will not
 * dlopen under plain Node (the same reason SessionDb.test.ts mocks it — see
 * that file's header). The actual SQL this module issues — the schema, the
 * FTS5 MATCH syntax, the join, updates against a virtual table — was verified
 * separately against a real, freshly-built better-sqlite3 in an isolated
 * scratch install; what is worth guarding here with a fast, always-run test
 * is db.ts's own control flow, which does not need real SQLite to be correct.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeFileRow {
  id: number;
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
  content_state: string;
}

const state = vi.hoisted(() => ({
  files: new Map<number, FakeFileRow>(),
  fts: new Map<number, { name: string; path: string; content: string }>(),
  nextId: 1,
}));

vi.mock('better-sqlite3', () => {
  class FakeStatement {
    constructor(private sql: string) {}

    private byPath(path: string): FakeFileRow | undefined {
      return [...state.files.values()].find((f) => f.path === path);
    }

    get(...args: unknown[]): unknown {
      if (this.sql.includes('SELECT id, mtime, content_state FROM files WHERE path')) {
        const row = this.byPath(args[0] as string);
        return row ? { id: row.id, mtime: row.mtime, content_state: row.content_state } : undefined;
      }
      if (this.sql.includes('SELECT id FROM files WHERE path')) {
        const row = this.byPath(args[0] as string);
        return row ? { id: row.id } : undefined;
      }
      if (this.sql.includes("COUNT(*) c FROM files WHERE content_state = 'indexed'")) {
        return { c: [...state.files.values()].filter((f) => f.content_state === 'indexed').length };
      }
      if (this.sql.includes("COUNT(*) c FROM files WHERE content_state = 'pending'")) {
        return { c: [...state.files.values()].filter((f) => f.content_state === 'pending').length };
      }
      if (this.sql.includes('COUNT(*) c FROM files')) {
        return { c: state.files.size };
      }
      throw new Error(`FakeStatement.get: unhandled SQL: ${this.sql}`);
    }

    run(...args: unknown[]): { lastInsertRowid: number } {
      if (this.sql.startsWith('INSERT INTO files (')) {
        const [path, name, ext, dir, size, mtime] = args as [string, string, string, string, number, number];
        const id = state.nextId++;
        state.files.set(id, { id, path, name, ext, dir, size, mtime, content_state: 'pending' });
        return { lastInsertRowid: id };
      }
      if (this.sql.startsWith('UPDATE files SET name')) {
        const [name, ext, dir, size, mtime, content_state, id] = args as [string, string, string, number, number, string, number];
        const row = state.files.get(id);
        if (row) Object.assign(row, { name, ext, dir, size, mtime, content_state });
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('UPDATE files SET content_state')) {
        const [content_state, id] = args as [string, number];
        const row = state.files.get(id);
        if (row) row.content_state = content_state;
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('INSERT INTO files_fts (')) {
        // The real statement embeds `content` as a SQL literal (`''`) rather
        // than binding it — the insert path always starts a file with no
        // content, so only rowid/name/path travel as parameters.
        const [rowid, name, path] = args as [number, string, string];
        state.fts.set(rowid, { name, path, content: '' });
        return { lastInsertRowid: 0 };
      }
      if (this.sql.includes("UPDATE files_fts SET content = '' WHERE rowid")) {
        const [rowid] = args as [number];
        const row = state.fts.get(rowid);
        if (row) row.content = '';
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('UPDATE files_fts SET name')) {
        const [name, rowid] = args as [string, number];
        const row = state.fts.get(rowid);
        if (row) row.name = name;
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('UPDATE files_fts SET content')) {
        const [content, rowid] = args as [string, number];
        const row = state.fts.get(rowid);
        if (row) row.content = content;
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('DELETE FROM files WHERE id')) {
        state.files.delete(args[0] as number);
        return { lastInsertRowid: 0 };
      }
      if (this.sql.startsWith('DELETE FROM files_fts WHERE rowid')) {
        state.fts.delete(args[0] as number);
        return { lastInsertRowid: 0 };
      }
      throw new Error(`FakeStatement.run: unhandled SQL: ${this.sql}`);
    }

    all(...args: unknown[]): unknown[] {
      if (this.sql.includes("content_state = 'pending'")) {
        const limit = args[0] as number;
        return [...state.files.values()]
          .filter((f) => f.content_state === 'pending')
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, limit)
          .map((f) => ({ id: f.id, path: f.path, ext: f.ext, size: f.size }));
      }
      if (this.sql.includes('files_fts MATCH')) {
        const [expr, cap] = args as [string, number];
        const terms = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1].toLowerCase());
        const hits = [...state.fts.entries()]
          .filter(([, row]) => terms.some((term) => row.name.toLowerCase().includes(term) || row.content.toLowerCase().includes(term)))
          .slice(0, cap)
          .map(([rowid, row]) => {
            const file = state.files.get(rowid)!;
            return { path: row.path, name: row.name, content: row.content, size: file.size, mtime: file.mtime };
          });
        return hits;
      }
      throw new Error(`FakeStatement.all: unhandled SQL: ${this.sql}`);
    }
  }

  class FakeDatabase {
    pragma(): void {}
    exec(): void {}
    prepare(sql: string): FakeStatement { return new FakeStatement(sql); }
    close(): void {}
  }

  return { default: FakeDatabase };
});

const {
  closeIndexDb, ftsCandidates, indexStats, nextPendingBatch,
  openIndexDb, removeFileByPath, setContent, upsertFileMeta,
} = await import('../../../src/main/search/db');

beforeEach(() => {
  state.files.clear();
  state.fts.clear();
  state.nextId = 1;
  closeIndexDb();
  openIndexDb('C:/fake-userdata');
});

afterEach(() => {
  closeIndexDb();
});

describe('search db', () => {
  it('inserts a file as pending with no content yet', () => {
    upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    expect(indexStats()).toEqual({ total: 1, indexed: 0, pending: 1 });
  });

  it('finds a candidate by name even before content is extracted', () => {
    upsertFileMeta({ path: 'C:/syllabus.pdf', name: 'syllabus.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    const rows = ftsCandidates(['syllabus'], 10);
    expect(rows.map((r) => r.path)).toEqual(['C:/syllabus.pdf']);
    expect(rows[0].content).toBe('');
  });

  it('backfills content and it becomes searchable and no longer pending', () => {
    const id = upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    setContent(id, 'all about cryptography basics', 'indexed');

    expect(ftsCandidates(['cryptography'], 10).map((r) => r.path)).toEqual(['C:/a.pdf']);
    expect(indexStats().indexed).toBe(1);
    expect(nextPendingBatch(10)).toEqual([]);
  });

  it('an extraction error still clears the pending state', () => {
    const id = upsertFileMeta({ path: 'C:/bad.pdf', name: 'bad.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    setContent(id, '', 'error');
    expect(nextPendingBatch(10)).toEqual([]);
    expect(indexStats().pending).toBe(0);
  });

  it('re-queues a file for content extraction when its mtime changes, clearing stale content immediately', () => {
    const id = upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    setContent(id, 'original text about databases', 'indexed');
    expect(ftsCandidates(['databases'], 10).length).toBe(1);

    upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 200, mtime: 2000 });

    expect(indexStats().pending).toBe(1);
    expect(ftsCandidates(['databases'], 10).length).toBe(0);
  });

  it('keeps content_state when metadata is refreshed with the same mtime', () => {
    const id = upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    setContent(id, 'stable content', 'indexed');
    upsertFileMeta({ path: 'C:/a.pdf', name: 'a.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    expect(indexStats().indexed).toBe(1);
  });

  it('removes a file from both tables', () => {
    upsertFileMeta({ path: 'C:/gone.pdf', name: 'gone.pdf', ext: 'pdf', dir: 'C:/', size: 100, mtime: 1000 });
    removeFileByPath('C:/gone.pdf');
    expect(indexStats().total).toBe(0);
    expect(ftsCandidates(['gone'], 10)).toEqual([]);
  });

  it('removing a path that was never indexed is a no-op', () => {
    expect(() => removeFileByPath('C:/never-existed.pdf')).not.toThrow();
  });
});
