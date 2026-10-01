import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentTabs, MAX_DOC_BYTES, type DocTab } from '../../../src/main/workspace/documents';

/**
 * Document tabs (docs/unify/PLAN.md §3.9): a task's open files, one tab per
 * file, watched so a rewrite reloads the tab.
 */
describe('DocumentTabs', () => {
  let dir: string;
  let lists: Array<{ sessionId: string; docs: DocTab[]; focusId?: string }>;
  let changes: Array<{ sessionId: string; docId: string; mtimeMs: number }>;
  let tabs: DocumentTabs;

  const file = (name: string, body = 'hello'): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-docs-'));
    lists = [];
    changes = [];
    tabs = new DocumentTabs(
      (sessionId, docs, focusId) => lists.push({ sessionId, docs, focusId }),
      (sessionId, docId, mtimeMs) => changes.push({ sessionId, docId, mtimeMs }),
    );
  });

  afterEach(() => {
    tabs.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a file as a tab and tells the hub, with it in front', () => {
    const p = file('report.docx');
    const doc = tabs.open('s1', p, 'agent');
    expect(doc).toMatchObject({ name: 'report.docx', path: path.resolve(p), openedBy: 'agent', size: 5 });
    expect(tabs.list('s1')).toHaveLength(1);
    expect(lists.at(-1)).toMatchObject({ sessionId: 's1', focusId: doc.id });
  });

  it('opening the same file again re-shows its tab instead of adding one', () => {
    const p = file('a.md');
    const first = tabs.open('s1', p, 'user');
    const again = tabs.open('s1', process.platform === 'win32' ? p.toUpperCase() : p, 'agent');
    expect(again.id).toBe(first.id);
    expect(tabs.list('s1')).toHaveLength(1);
    expect(lists.at(-1)?.focusId).toBe(first.id);
  });

  it('opens in the background without asking for focus', () => {
    tabs.open('s1', file('b.txt'), 'agent', false);
    expect(lists.at(-1)?.focusId).toBeUndefined();
  });

  it('keeps each task’s tabs apart', () => {
    const p = file('shared.csv');
    tabs.open('s1', p, 'user');
    expect(tabs.isOpen('s1', p)).toBe(true);
    expect(tabs.isOpen('s2', p)).toBe(false);
    expect(tabs.list('s2')).toEqual([]);
  });

  it('refuses folders, missing files and files too big for a tab', () => {
    expect(() => tabs.open('s1', dir, 'user')).toThrow(/Not a file/);
    expect(() => tabs.open('s1', path.join(dir, 'nope.pdf'), 'user')).toThrow();
    const big = file('big.bin');
    fs.truncateSync(big, MAX_DOC_BYTES + 1);
    expect(() => tabs.open('s1', big, 'user')).toThrow(/Too big/);
    expect(tabs.list('s1')).toEqual([]);
  });

  it('closes a tab, and forgets a task’s tabs when the task goes', () => {
    const a = tabs.open('s1', file('a.txt'), 'user');
    tabs.open('s1', file('b.txt'), 'user');
    expect(tabs.close('s1', a.id)).toBe(true);
    expect(tabs.close('s1', a.id)).toBe(false);
    expect(tabs.list('s1').map((d) => d.name)).toEqual(['b.txt']);
    tabs.closeSession('s1');
    expect(tabs.list('s1')).toEqual([]);
  });

  it('hands out copies, so the hub can’t edit its state', () => {
    const doc = tabs.open('s1', file('c.txt'), 'user');
    tabs.list('s1')[0].name = 'changed';
    expect(tabs.get('s1', doc.id)?.name).toBe('c.txt');
  });

  it('reports a rewrite of the file once it settles', async () => {
    const p = file('live.md', 'one');
    const doc = tabs.open('s1', p, 'agent');
    // A different mtime for sure, then a burst of writes.
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(p, 'two');
    fs.writeFileSync(p, 'three, longer');
    fs.utimesSync(p, later, later);
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0), { timeout: 3000, interval: 50 });
    expect(changes[0]).toMatchObject({ sessionId: 's1', docId: doc.id });
    expect(tabs.get('s1', doc.id)?.size).toBe('three, longer'.length);
  });
});
