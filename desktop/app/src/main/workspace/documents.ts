/**
 * Document tabs (docs/unify/PLAN.md §3.9): files a task shows you in the
 * workspace — a report DEX wrote, a PDF it downloaded, a sheet it filled —
 * drawn by the hub itself (pdf.js, docx-preview, SheetJS…), not a browser view.
 *
 * This keeps each task's open documents and watches their files, so when the
 * agent rewrites one its tab reloads. Which files may be opened is the
 * caller's check: the hub may open files the task recorded; the agent opens
 * with `dex-open`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';

export interface DocTab {
  id: string;
  path: string;
  name: string;
  openedBy: 'user' | 'agent';
  openedAt: number;
  size: number;
  mtimeMs: number;
}

/** Bigger than this is "open it in its own app", not a tab. */
export const MAX_DOC_BYTES = 80 * 1024 * 1024;

const key = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

interface Watch {
  watcher: fs.FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

export class DocumentTabs {
  private bySession = new Map<string, DocTab[]>();
  private watches = new Map<string, Watch>();
  private seq = 0;

  constructor(
    private readonly onListChanged: (sessionId: string, docs: DocTab[], focusId?: string) => void,
    private readonly onFileChanged: (sessionId: string, docId: string, mtimeMs: number) => void,
  ) {}

  list(sessionId: string): DocTab[] {
    return (this.bySession.get(sessionId) ?? []).map((d) => ({ ...d }));
  }

  get(sessionId: string, id: string): DocTab | null {
    return this.bySession.get(sessionId)?.find((d) => d.id === id) ?? null;
  }

  /** Is `filePath` one of this task's open documents? */
  isOpen(sessionId: string, filePath: string): boolean {
    const k = key(filePath);
    return (this.bySession.get(sessionId) ?? []).some((d) => key(d.path) === k);
  }

  /**
   * Open (or re-show) a document. Throws if it isn't a readable file or is
   * too big for a tab. `focus` puts it in front in the hub.
   */
  open(sessionId: string, filePath: string, openedBy: DocTab['openedBy'], focus = true): DocTab {
    const abs = path.resolve(filePath);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`Not a file: ${abs}`);
    if (stat.size > MAX_DOC_BYTES) throw new Error(`Too big to show in a tab (${Math.round(stat.size / 1024 / 1024)} MB); open it in its own app.`);

    const docs = this.bySession.get(sessionId) ?? [];
    let doc = docs.find((d) => key(d.path) === key(abs));
    if (!doc) {
      doc = {
        id: `d${++this.seq}`,
        path: abs,
        name: path.basename(abs),
        openedBy,
        openedAt: Date.now(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
      docs.push(doc);
      this.bySession.set(sessionId, docs);
      this.watch(abs);
      mainLogger.info('documents.open', { sessionId, id: doc.id, openedBy, size: stat.size });
    }
    this.onListChanged(sessionId, this.list(sessionId), focus ? doc.id : undefined);
    return { ...doc };
  }

  /**
   * Bring back a task's remembered documents (main/workspace/tabMemory.ts),
   * quietly: none comes to the front, and files that are gone are skipped.
   * Returns how many came back.
   */
  restore(sessionId: string, saved: ReadonlyArray<{ path: string; openedBy: DocTab['openedBy'] }>): number {
    const docs = this.bySession.get(sessionId) ?? [];
    let added = 0;
    for (const s of saved) {
      const abs = path.resolve(s.path);
      if (docs.some((d) => key(d.path) === key(abs))) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (!stat.isFile() || stat.size > MAX_DOC_BYTES) continue;
      // openedAt 0: never "just opened", so the hub doesn't jump to it.
      docs.push({ id: `d${++this.seq}`, path: abs, name: path.basename(abs), openedBy: s.openedBy, openedAt: 0, size: stat.size, mtimeMs: stat.mtimeMs });
      this.watch(abs);
      added++;
    }
    if (added === 0) return 0;
    this.bySession.set(sessionId, docs);
    mainLogger.info('documents.restore', { sessionId, count: added });
    this.onListChanged(sessionId, this.list(sessionId));
    return added;
  }

  close(sessionId: string, id: string): boolean {
    const docs = this.bySession.get(sessionId);
    const index = docs?.findIndex((d) => d.id === id) ?? -1;
    if (!docs || index < 0) return false;
    const [gone] = docs.splice(index, 1);
    this.unwatchIfUnused(gone.path);
    this.onListChanged(sessionId, this.list(sessionId));
    return true;
  }

  /** The task is gone: forget its documents and stop watching them. */
  closeSession(sessionId: string): void {
    const docs = this.bySession.get(sessionId);
    if (!docs) return;
    this.bySession.delete(sessionId);
    for (const d of docs) this.unwatchIfUnused(d.path);
  }

  dispose(): void {
    for (const w of this.watches.values()) {
      if (w.timer) clearTimeout(w.timer);
      try { w.watcher.close(); } catch { /* gone */ }
    }
    this.watches.clear();
    this.bySession.clear();
  }

  private watch(abs: string): void {
    const k = key(abs);
    if (this.watches.has(k)) return;
    try {
      const w: Watch = { watcher: fs.watch(abs, { persistent: false }), timer: null };
      // Editors and agents write in bursts (truncate, write, rename): settle first.
      w.watcher.on('change', () => {
        if (w.timer) clearTimeout(w.timer);
        w.timer = setTimeout(() => { w.timer = null; this.fileChanged(abs); }, 250);
      });
      w.watcher.on('error', () => { /* the file went away; the tab keeps its last copy */ });
      this.watches.set(k, w);
    } catch (err) {
      mainLogger.warn('documents.watch.failed', { error: (err as Error).message });
    }
  }

  private unwatchIfUnused(abs: string): void {
    const k = key(abs);
    for (const docs of this.bySession.values()) if (docs.some((d) => key(d.path) === k)) return;
    const w = this.watches.get(k);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    try { w.watcher.close(); } catch { /* gone */ }
    this.watches.delete(k);
  }

  private fileChanged(abs: string): void {
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { return; }
    const k = key(abs);
    for (const [sessionId, docs] of this.bySession) {
      for (const d of docs) {
        if (key(d.path) !== k || d.mtimeMs === stat.mtimeMs) continue;
        d.mtimeMs = stat.mtimeMs;
        d.size = stat.size;
        this.onFileChanged(sessionId, d.id, stat.mtimeMs);
      }
    }
  }
}
