/**
 * A task's tabs, remembered (docs/unify/PLAN.md §3.2 tab persistence).
 *
 * The workspace's web tabs and document tabs are written to sessions.db a
 * moment after they change, so they come back when the task does:
 *
 * - **Web tabs** come back when the task's browser is made again (resuming
 *   after a restart, a cancel or an error). The task's own tab reopens at
 *   its last page as before; the others come back *unloaded*: title only,
 *   loading when you look at one or the agent uses it.
 * - **Document tabs** come back the first time the hub asks for the task's
 *   documents, skipping files that are gone.
 *
 * The agent's scratch tabs and blank tabs aren't remembered.
 */
import type { TabOpener, WorkspaceTabState } from '../sessions/BrowserPool';

export interface SavedTab {
  url: string;
  title: string;
  openedBy: TabOpener;
}

export interface SavedDoc {
  path: string;
  openedBy: 'user' | 'agent';
}

export interface SavedWorkspace {
  tabs: SavedTab[];
  docs: SavedDoc[];
}

export interface TabMemoryStore {
  load(sessionId: string): SavedWorkspace | null;
  save(sessionId: string, saved: SavedWorkspace): void;
}

const MAX_SAVED = 12;

function restorable(url: string): boolean {
  return /^(https?|file):/i.test(url);
}

/** The tabs worth bringing back, in strip order. */
export function tabsToSave(tabs: readonly WorkspaceTabState[]): SavedTab[] {
  return tabs
    .filter((t) => !t.temporary && !t.isNewTab && restorable(t.url))
    .slice(0, MAX_SAVED)
    .map((t) => ({ url: t.url, title: t.title.slice(0, 300), openedBy: t.openedBy }));
}

/** Parse a stored row; anything malformed is dropped rather than trusted. */
export function parseSaved(tabsJson: string, docsJson: string): SavedWorkspace {
  const parse = (raw: string): unknown[] => {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const openers: readonly string[] = ['task', 'user', 'page', 'agent'];
  const tabs = parse(tabsJson).flatMap((t): SavedTab[] => {
    const r = t as Partial<SavedTab> | null;
    if (!r || typeof r.url !== 'string' || !restorable(r.url)) return [];
    return [{
      url: r.url,
      title: typeof r.title === 'string' ? r.title : '',
      openedBy: typeof r.openedBy === 'string' && openers.includes(r.openedBy) ? r.openedBy : 'user',
    }];
  });
  const docs = parse(docsJson).flatMap((d): SavedDoc[] => {
    const r = d as Partial<SavedDoc> | null;
    if (!r || typeof r.path !== 'string' || !r.path) return [];
    return [{ path: r.path, openedBy: r.openedBy === 'agent' ? 'agent' : 'user' }];
  });
  return { tabs: tabs.slice(0, MAX_SAVED), docs: docs.slice(0, MAX_SAVED * 2) };
}

/** Coalesces changes per task and writes them a moment later (or on flush). */
export class TabMemory {
  private pending = new Map<string, SavedWorkspace>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: TabMemoryStore, private readonly delayMs = 1000) {}

  /** What's remembered for a task, including changes not yet written. */
  saved(sessionId: string): SavedWorkspace {
    return this.pending.get(sessionId) ?? this.store.load(sessionId) ?? { tabs: [], docs: [] };
  }

  noteTabs(sessionId: string, tabs: SavedTab[]): void {
    this.note(sessionId, { ...this.saved(sessionId), tabs });
  }

  noteDocs(sessionId: string, docs: SavedDoc[]): void {
    this.note(sessionId, { ...this.saved(sessionId), docs });
  }

  /** The task is gone: drop anything not yet written. */
  forget(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [sessionId, saved] of batch) this.store.save(sessionId, saved);
  }

  private note(sessionId: string, saved: SavedWorkspace): void {
    this.pending.set(sessionId, saved);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
  }
}
