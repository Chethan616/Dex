import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSaved, TabMemory, tabsToSave, type SavedWorkspace } from '../../../src/main/workspace/tabMemory';
import type { WorkspaceTabState } from '../../../src/main/sessions/BrowserPool';

function tab(over: Partial<WorkspaceTabState>): WorkspaceTabState {
  return {
    id: 't1', url: 'https://example.com/', title: 'Example', faviconUrl: null, loading: false, canGoBack: false,
    canGoForward: false, active: false, openedBy: 'user', isNewTab: false, crashed: false, temporary: false, zoom: 100, ...over,
  };
}

describe('tab memory', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('remembers your pages, not DEX’s scratch tabs, new tabs or internal pages', () => {
    const saved = tabsToSave([
      tab({ id: 't1', openedBy: 'task', url: 'https://mail.example.com/inbox', title: 'Inbox' }),
      tab({ id: 't2', url: 'https://docs.example.com/', title: 'Docs' }),
      tab({ id: 't3', openedBy: 'agent', temporary: true, url: 'https://scratch.example/' }),
      tab({ id: 't4', isNewTab: true, url: '' }),
      tab({ id: 't5', url: 'chrome://gpu' }),
      tab({ id: 't6', openedBy: 'agent', url: 'file:///C:/out/report.html', title: 'Report' }),
    ]);
    expect(saved).toEqual([
      { url: 'https://mail.example.com/inbox', title: 'Inbox', openedBy: 'task' },
      { url: 'https://docs.example.com/', title: 'Docs', openedBy: 'user' },
      { url: 'file:///C:/out/report.html', title: 'Report', openedBy: 'agent' },
    ]);
  });

  it('reads back only what it can trust from a stored row', () => {
    const saved = parseSaved(
      JSON.stringify([{ url: 'https://a.example/', title: 'A', openedBy: 'page' }, { url: 'javascript:alert(1)' }, { url: 'https://b.example/', openedBy: 'root' }, null, 7]),
      JSON.stringify([{ path: 'C:/out/a.pdf', openedBy: 'agent' }, { path: '' }, { path: 'C:/out/b.md', openedBy: 'admin' }]),
    );
    expect(saved).toEqual({
      tabs: [{ url: 'https://a.example/', title: 'A', openedBy: 'page' }, { url: 'https://b.example/', title: '', openedBy: 'user' }],
      docs: [{ path: 'C:/out/a.pdf', openedBy: 'agent' }, { path: 'C:/out/b.md', openedBy: 'user' }],
    });
    expect(parseSaved('not json', '{"a":1}')).toEqual({ tabs: [], docs: [] });
  });

  it('writes a moment after changes, coalesced, and keeps tabs and documents apart', () => {
    vi.useFakeTimers();
    const rows = new Map<string, SavedWorkspace>();
    const save = vi.fn((id: string, w: SavedWorkspace) => { rows.set(id, w); });
    const memory = new TabMemory({ load: (id) => rows.get(id) ?? null, save }, 1000);

    memory.noteTabs('s1', [{ url: 'https://a.example/', title: 'A', openedBy: 'user' }]);
    memory.noteDocs('s1', [{ path: 'C:/out/a.pdf', openedBy: 'agent' }]);
    memory.noteTabs('s1', [{ url: 'https://b.example/', title: 'B', openedBy: 'user' }]);
    expect(save).not.toHaveBeenCalled();
    expect(memory.saved('s1').tabs[0].url).toBe('https://b.example/');

    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(rows.get('s1')).toEqual({
      tabs: [{ url: 'https://b.example/', title: 'B', openedBy: 'user' }],
      docs: [{ path: 'C:/out/a.pdf', openedBy: 'agent' }],
    });

    memory.noteDocs('s1', []);
    memory.flush();
    expect(rows.get('s1')!.tabs).toHaveLength(1);
    expect(rows.get('s1')!.docs).toEqual([]);
  });

  it('drops what a deleted task hadn’t written yet', () => {
    const save = vi.fn();
    const memory = new TabMemory({ load: () => null, save }, 1000);
    memory.noteTabs('gone', [{ url: 'https://a.example/', title: '', openedBy: 'user' }]);
    memory.forget('gone');
    memory.flush();
    expect(save).not.toHaveBeenCalled();
    expect(memory.saved('gone')).toEqual({ tabs: [], docs: [] });
  });
});
