/**
 * Index scope is a performance contract, not a preference.
 *
 * Indexing the whole home directory (never mind whole drives) produced a
 * 3.4 GB FTS5 index and a content backfill that never finished — and since
 * better-sqlite3 is synchronous on the main process thread, that meant the
 * one thread serving every UI IPC call was permanently busy writing into a
 * multi-gigabyte database. These lock in the narrowed default so widening
 * it again has to be a deliberate act.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectRoots } from '../../../src/main/search/indexer';

const home = os.homedir();

afterEach(() => {
  delete process.env.DEX_INDEX_ROOTS;
});

describe('detectRoots', () => {
  it('never returns a whole drive or the bare home directory by default', () => {
    const chosen = detectRoots();
    expect(chosen).not.toContain('C:\\');
    expect(chosen).not.toContain('D:\\');
    expect(chosen).not.toContain(home);
  });

  it('only returns well-known document folders, all under the home directory', () => {
    const allowed = new Set(['Desktop', 'Documents', 'Downloads']);
    for (const root of detectRoots()) {
      expect(root.startsWith(home)).toBe(true);
      expect(allowed.has(path.basename(root))).toBe(true);
    }
  });

  it('returns only folders that actually exist on this machine', () => {
    for (const root of detectRoots()) expect(fs.existsSync(root)).toBe(true);
  });

  it('DEX_INDEX_ROOTS overrides completely, so a whole drive stays opt-in', () => {
    process.env.DEX_INDEX_ROOTS = 'C:\\' + ',' + 'D:\\';
    expect(detectRoots()).toEqual(['C:\\', 'D:\\']);
  });

  it('trims whitespace and drops empty entries in the override', () => {
    process.env.DEX_INDEX_ROOTS = 'C:\\docs , ,D:\\media ';
    expect(detectRoots()).toEqual(['C:\\docs', 'D:\\media']);
  });
});
