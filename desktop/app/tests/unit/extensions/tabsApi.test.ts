import { describe, it, expect, vi } from 'vitest';
import { TabEventTracker, TabsApi, WindowIds, type ExtensionAccess } from '../../../src/main/extensions/tabsApi';
import type { CallContext, PoolTab, PoolWindow, TabsBackend } from '../../../src/main/extensions/types';

let nextWc = 100;
function tab(url: string, over: Partial<PoolTab> = {}): PoolTab {
  const id = nextWc++;
  const state = { url, title: `Title of ${url}`, audible: false, muted: false };
  return {
    tabId: `t${id}`,
    wc: {
      id,
      getURL: () => state.url,
      getTitle: () => state.title,
      isCurrentlyAudible: () => state.audible,
      isAudioMuted: () => state.muted,
      setAudioMuted: (m: boolean) => { state.muted = m; },
      _state: state,
    } as unknown as PoolTab['wc'],
    active: false,
    pending: null,
    loading: false,
    faviconUrl: null,
    openedBy: 'user',
    ...over,
  };
}

function setup(windows: PoolWindow[], shown: string | null, access: Partial<ExtensionAccess> = {}) {
  const backend: TabsBackend = {
    windows: () => windows,
    shownSessionId: () => shown,
    hubFocused: () => true,
    openTab: vi.fn((sessionId: string, url: string, active: boolean) => {
      const t = tab(url, { active });
      windows.find((w) => w.sessionId === sessionId)!.tabs.push(t);
      return t;
    }),
    closeTab: vi.fn(() => true),
    activateTab: vi.fn(() => true),
    loadUrl: vi.fn(() => true),
    goBack: vi.fn(() => true),
    goForward: vi.fn(() => true),
    showSession: vi.fn(),
  };
  const api = new TabsApi(backend, {
    canSee: () => true,
    hasPermission: () => true,
    canCapture: () => true,
    popupSessionOf: () => null,
    ...access,
  });
  return { api, backend, handlers: api.handlers() };
}

const ctx: CallContext = { extensionId: 'a'.repeat(32), kind: 'worker' };

describe('chrome.tabs over DEX tasks', () => {
  it('finds the active tab of the task on screen for {active, currentWindow}', () => {
    const one = tab('https://one.example/', { active: true });
    const two = tab('https://two.example/', { active: true });
    const { handlers } = setup([
      { sessionId: 's1', title: '', tabs: [tab('https://x.example/'), one] },
      { sessionId: 's2', title: '', tabs: [two] },
    ], 's1');
    const found = handlers['tabs.query'](ctx, [{ active: true, currentWindow: true }]) as Array<{ id: number; url: string; index: number }>;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: one.wc.id, url: 'https://one.example/', index: 1 });
  });

  it('hides URLs and titles from an extension without access, and won\'t match them by URL', () => {
    const t = tab('https://bank.example/', { active: true });
    const { handlers } = setup([{ sessionId: 's1', title: '', tabs: [t] }], 's1', { canSee: () => false });
    const [seen] = handlers['tabs.query'](ctx, [{}]) as Array<{ url?: string; title?: string }>;
    expect(seen.url).toBeUndefined();
    expect(seen.title).toBeUndefined();
    expect(handlers['tabs.query'](ctx, [{ url: '*://bank.example/*' }])).toEqual([]);
  });

  it('matches tabs by URL pattern and title pattern', () => {
    const { handlers } = setup([{ sessionId: 's1', title: '', tabs: [tab('https://docs.example/a'), tab('https://mail.example/b')] }], 's1');
    expect((handlers['tabs.query'](ctx, [{ url: ['*://mail.example/*'] }]) as unknown[]).length).toBe(1);
    expect((handlers['tabs.query'](ctx, [{ title: 'Title of https://docs*' }]) as unknown[]).length).toBe(1);
  });

  it('opens a tab in the task on screen, resolving relative URLs against the extension', () => {
    const { handlers, backend } = setup([{ sessionId: 's1', title: '', tabs: [] }], 's1');
    const created = handlers['tabs.create'](ctx, [{ url: 'options.html' }]) as { url: string };
    expect(backend.openTab).toHaveBeenCalledWith('s1', `chrome-extension://${'a'.repeat(32)}/options.html`, true);
    expect(created.url).toBe(`chrome-extension://${'a'.repeat(32)}/options.html`);
  });

  it("won't let an extension open javascript:, file: or data: pages", () => {
    const { handlers } = setup([{ sessionId: 's1', title: '', tabs: [] }], 's1');
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi']) {
      expect(() => handlers['tabs.create'](ctx, [{ url }])).toThrow(/doesn't let extensions open/);
    }
  });

  it('says "No tab with id" for a tab that isn\'t there', () => {
    const { handlers } = setup([{ sessionId: 's1', title: '', tabs: [] }], 's1');
    expect(() => handlers['tabs.get'](ctx, [12345])).toThrow('No tab with id: 12345.');
  });

  it('updates the active tab when no id is given, and mutes', () => {
    const t = tab('https://a.example/', { active: true });
    const { handlers, backend } = setup([{ sessionId: 's1', title: '', tabs: [t] }], 's1');
    handlers['tabs.update'](ctx, [undefined, { url: 'https://b.example/', muted: true }]);
    expect(backend.loadUrl).toHaveBeenCalledWith('s1', t.tabId, 'https://b.example/');
    expect(t.wc.isAudioMuted()).toBe(true);
  });

  it('treats each task as a window, and refuses to close one', () => {
    const { handlers } = setup([
      { sessionId: 's1', title: '', tabs: [tab('https://a.example/', { active: true })] },
      { sessionId: 's2', title: '', tabs: [] },
    ], 's1');
    const all = handlers['windows.getAll'](ctx, [{ populate: true }]) as Array<{ id: number; focused: boolean; tabs: unknown[] }>;
    expect(all.map((w) => w.focused)).toEqual([true, false]);
    expect(all[0].tabs).toHaveLength(1);
    expect(() => handlers['windows.remove'](ctx, [all[0].id])).toThrow(/can't close a DEX task/);
  });
});

describe('TabEventTracker', () => {
  it('reports created, activated, updated (loading → complete) and removed, like Chrome', () => {
    const ids = new WindowIds();
    const tracker = new TabEventTracker(ids);
    const t = tab('https://a.example/', { active: true });
    const win: PoolWindow = { sessionId: 's1', title: '', tabs: [t] };
    const first = tracker.diff([win], 's1');
    expect(first.map((e) => e.type)).toEqual(['windowCreated', 'created', 'activated', 'focusChanged']);

    (t.wc as unknown as { _state: { url: string } })._state.url = 'https://b.example/';
    const second = tracker.diff([win], 's1');
    expect(second).toEqual([
      { type: 'updated', tabId: t.wc.id, changeInfo: { status: 'loading', url: 'https://b.example/' } },
      { type: 'updated', tabId: t.wc.id, changeInfo: { status: 'complete' } },
    ]);

    win.tabs = [];
    const third = tracker.diff([win], 's1');
    expect(third).toContainEqual({ type: 'removed', tabId: t.wc.id, windowId: ids.of('s1'), isWindowClosing: false });

    const fourth = tracker.diff([], null);
    expect(fourth).toContainEqual({ type: 'windowRemoved', windowId: ids.of('s1') });
  });

  it('says nothing when nothing changed', () => {
    const tracker = new TabEventTracker(new WindowIds());
    const win: PoolWindow = { sessionId: 's1', title: '', tabs: [tab('https://a.example/', { active: true })] };
    tracker.diff([win], 's1');
    expect(tracker.diff([win], 's1')).toEqual([]);
  });
});
