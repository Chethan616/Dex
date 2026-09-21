/**
 * Regression guard for the indexer's main-thread cost.
 *
 * better-sqlite3 is synchronous and runs on whichever thread calls it — for
 * the indexer that is the main process thread, the same one serving every
 * IPC call the UI makes. Two bugs here made an index build stall unrelated
 * UI actions for seconds:
 *   1. every call re-compiled its SQL via an inline `database.prepare(...)`
 *   2. every scanned file committed its own implicit transaction
 *
 * Real better-sqlite3 is compiled against Electron's ABI and won't dlopen
 * under plain Node (same reason db.test.ts mocks it), so this asserts the
 * structural properties directly — how many times SQL gets compiled, and
 * that batch writes go through one transaction — rather than wall-clock
 * timing, which would be both unmockable here and flaky in CI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ prepareCalls: [] as string[], transactionCalls: 0 }));

vi.mock('better-sqlite3', () => {
  class FakeStatement {
    run(): { lastInsertRowid: number } { return { lastInsertRowid: 1 }; }
    get(): undefined { return undefined; }
    all(): unknown[] { return []; }
  }
  class FakeDatabase {
    prepare(sql: string): FakeStatement {
      state.prepareCalls.push(sql);
      return new FakeStatement();
    }
    transaction<T>(fn: () => T): () => T {
      state.transactionCalls += 1;
      return () => fn();
    }
    pragma(): void {}
    exec(): void {}
    close(): void {}
  }
  return { default: FakeDatabase };
});

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const tmpDirs: string[] = [];

/** better-sqlite3 is mocked, but openIndexDb's fs.mkdirSync is real. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-dbperf-'));
  tmpDirs.push(dir);
  return dir;
}

async function freshDb() {
  vi.resetModules();
  state.prepareCalls = [];
  state.transactionCalls = 0;
  const mod = await import('../../../src/main/search/db');
  mod.openIndexDb(tempDir());
  return mod;
}

function record(i: number) {
  return { path: `C:/docs/f${i}.txt`, name: `f${i}.txt`, ext: 'txt', dir: 'C:/docs', size: 10, mtime: 1 };
}

beforeEach(() => {
  state.prepareCalls = [];
  state.transactionCalls = 0;
});

afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('search db — main-thread cost', () => {
  it('compiles each distinct SQL statement once, no matter how many files are written', async () => {
    const db = await freshDb();

    for (let i = 0; i < 50; i++) db.upsertFileMeta(record(i));

    // The insert path issues 3 distinct statements (SELECT probe, INSERT
    // files, INSERT files_fts). Without caching this would be 3 * 50 = 150
    // compilations; with it, 3 — one per distinct SQL string.
    const distinct = new Set(state.prepareCalls);
    expect(state.prepareCalls.length).toBe(distinct.size);
    expect(state.prepareCalls.length).toBeLessThanOrEqual(4);
  });

  it('does not recompile when the same statements are reused across many calls', async () => {
    const db = await freshDb();

    db.upsertFileMeta(record(0));
    const afterFirst = state.prepareCalls.length;
    for (let i = 1; i < 200; i++) db.upsertFileMeta(record(i));

    // Every later call reuses what the first one compiled.
    expect(state.prepareCalls.length).toBe(afterFirst);
  });

  it('runInTransaction wraps the batch in a single SQLite transaction', async () => {
    const db = await freshDb();

    db.runInTransaction(() => {
      for (let i = 0; i < 100; i++) db.upsertFileMeta(record(i));
    });

    expect(state.transactionCalls).toBe(1);
  });

  it('runInTransaction propagates a throw so a failed batch rolls back rather than half-committing', async () => {
    const db = await freshDb();

    expect(() => db.runInTransaction(() => {
      db.upsertFileMeta(record(1));
      throw new Error('boom');
    })).toThrow('boom');
  });

  it('clears the statement cache on close so statements are never reused across database handles', async () => {
    const db = await freshDb();
    db.upsertFileMeta(record(0));
    const compiledWhileOpen = state.prepareCalls.length;
    expect(compiledWhileOpen).toBeGreaterThan(0);

    db.closeIndexDb();
    db.openIndexDb(tempDir());
    db.upsertFileMeta(record(0));

    // A Statement is bound to the Database that compiled it, so a new handle
    // must compile its own — reusing the old ones would use a closed handle.
    expect(state.prepareCalls.length).toBeGreaterThan(compiledWhileOpen);
  });
});
