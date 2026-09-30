import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserPool } from '../../../src/main/sessions/BrowserPool';
import { contentViewStub } from '../../fixtures/electron-mock';

function mockWindow(): any {
  return { isDestroyed: () => false, contentView: { ...contentViewStub } };
}

function instrumentLifecycle(view: NonNullable<ReturnType<BrowserPool['create']>>) {
  const setFrameRate = vi.fn<(fps: number) => void>();
  const sendCommand = vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});
  const wc = view.webContents as unknown as {
    setFrameRate: (fps: number) => void;
    debugger: {
      sendCommand: (method: string, params: Record<string, unknown>) => Promise<unknown>;
      attach: () => void;
      detach: () => void;
      isAttached: () => boolean;
    };
  };
  wc.setFrameRate = setFrameRate;
  Object.assign(wc.debugger, {
    sendCommand,
    attach: vi.fn<() => void>(),
    detach: vi.fn<() => void>(),
    isAttached: () => false,
  });
  return { setFrameRate, sendCommand };
}

// ---------------------------------------------------------------------------
// Creation & lifecycle
// ---------------------------------------------------------------------------

describe('BrowserPool — creation', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(3); });
  afterEach(() => { pool.destroyAll(); });

  it('creates a browser view and returns it', () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();
    expect(pool.activeCount).toBe(1);
  });

  it('assigns unique webContents per session', () => {
    const v1 = pool.create('s1');
    const v2 = pool.create('s2');
    expect(v1!.webContents.id).not.toBe(v2!.webContents.id);
  });

  it('returns existing view for duplicate session ID', () => {
    const v1 = pool.create('s1');
    const v2 = pool.create('s1');
    expect(v1).toBe(v2);
    expect(pool.activeCount).toBe(1);
  });

  it('getWebContents returns the correct webContents', () => {
    const view = pool.create('s1');
    const wc = pool.getWebContents('s1');
    expect(wc).toBe(view!.webContents);
  });

  it('getWebContents returns null for unknown session', () => {
    expect(pool.getWebContents('nonexistent')).toBeNull();
  });

  it('getView returns the view or null', () => {
    pool.create('s1');
    expect(pool.getView('s1')).not.toBeNull();
    expect(pool.getView('nonexistent')).toBeNull();
  });

  it('notifies when Ctrl+C is pressed inside a browser view and prevents the page keypress when handled', () => {
    const view = pool.create('s1');
    const onInterruptShortcut = vi.fn(() => true);
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(onInterruptShortcut);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'c', control: true, meta: false, alt: false },
    );

    expect(onInterruptShortcut).toHaveBeenCalledWith('s1');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('lets Ctrl+C through to the page when the app does not handle it', () => {
    const view = pool.create('s1');
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(() => false);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'c', control: true, meta: false, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not treat Escape as the browser-view interrupt shortcut', () => {
    const view = pool.create('s1');
    const onInterruptShortcut = vi.fn(() => true);
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(onInterruptShortcut);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'Escape', control: false, meta: false, alt: false },
    );

    expect(onInterruptShortcut).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrency limits
// ---------------------------------------------------------------------------

describe('BrowserPool — concurrency', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(2); });
  afterEach(() => { pool.destroyAll(); });

  it('enforces max concurrent limit', () => {
    pool.create('s1');
    pool.create('s2');
    const v3 = pool.create('s3');
    expect(v3).toBeNull();
    expect(pool.activeCount).toBe(2);
    expect(pool.queuedCount).toBe(1);
  });

  it('canCreate returns false at capacity', () => {
    pool.create('s1');
    expect(pool.canCreate()).toBe(true);
    pool.create('s2');
    expect(pool.canCreate()).toBe(false);
  });

  it('frees capacity when a session is destroyed', () => {
    pool.create('s1');
    pool.create('s2');
    expect(pool.canCreate()).toBe(false);

    pool.destroy('s1');
    expect(pool.canCreate()).toBe(true);
    expect(pool.activeCount).toBe(1);
  });

  it('queued count resets on destroyAll', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    expect(pool.queuedCount).toBe(1);

    pool.destroyAll();
    expect(pool.queuedCount).toBe(0);
    expect(pool.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Attach / detach (live view)
// ---------------------------------------------------------------------------

describe('BrowserPool — attach/detach', () => {
  let pool: BrowserPool;
  let win: any;

  beforeEach(() => {
    pool = new BrowserPool(5);
    win = mockWindow();
  });
  afterEach(() => { pool.destroyAll(); });

  it('attachToWindow returns true and sets bounds', () => {
    pool.create('s1');
    const bounds = { x: 100, y: 50, width: 800, height: 600 };
    const ok = pool.attachToWindow('s1', win, bounds);
    expect(ok).toBe(true);
  });

  it('attachToWindow returns false for unknown session', () => {
    const ok = pool.attachToWindow('nonexistent', win, { x: 0, y: 0, width: 100, height: 100 });
    expect(ok).toBe(false);
  });

  it('detachFromWindow returns true after attach', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const ok = pool.detachFromWindow('s1', win);
    expect(ok).toBe(true);
  });

  it('detachFromWindow returns false if not attached', () => {
    pool.create('s1');
    const ok = pool.detachFromWindow('s1', win);
    expect(ok).toBe(false);
  });

  it('detachFromWindow returns false for unknown session', () => {
    const ok = pool.detachFromWindow('nonexistent', win);
    expect(ok).toBe(false);
  });

  it('double attach updates bounds without error', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const ok = pool.attachToWindow('s1', win, { x: 50, y: 50, width: 640, height: 480 });
    expect(ok).toBe(true);
  });

  it('fills the pane at the page’s real size (no emulated 1440px layout)', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });
    expect(pool.getView('s1')!.getBounds()).toEqual({ x: 0, y: 0, width: 2000, height: 900 });
  });

  it('destroy detaches if currently attached', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    pool.destroy('s1', win);
    expect(pool.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tab observation
// ---------------------------------------------------------------------------

describe('BrowserPool — getTabs', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(5); });
  afterEach(() => { pool.destroyAll(); });

  it('returns tab info for active session', async () => {
    pool.create('s1');
    const tabs = await pool.getTabs('s1');
    expect(tabs.length).toBe(1);
    expect(tabs[0].url).toBe('about:blank');
    expect(tabs[0].type).toBe('page');
    expect(tabs[0].active).toBe(true);
  });

  it('returns empty array for unknown session', async () => {
    const tabs = await pool.getTabs('nonexistent');
    expect(tabs).toEqual([]);
  });
});

describe('BrowserPool — resize', () => {
  let pool: BrowserPool;
  let win: any;

  beforeEach(() => {
    pool = new BrowserPool(5);
    win = mockWindow();
  });

  afterEach(() => { pool.destroyAll(); });

  it('follows the pane exactly and ignores a zero-size frame', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });
    expect(pool.setViewBoundsFitted('s1', { x: 10, y: 20, width: 1200, height: 700 })).toEqual({ x: 10, y: 20, width: 1200, height: 700 });
    expect(pool.setViewBoundsFitted('s1', { x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 10, y: 20, width: 1200, height: 700 });
    expect(pool.getView('s1')!.getBounds()).toEqual({ x: 10, y: 20, width: 1200, height: 700 });
  });
});

describe('BrowserPool — idle CPU throttling', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = new BrowserPool(5, { idleFreezeDelayMs: 100 });
  });

  afterEach(() => {
    pool.destroyAll();
    vi.useRealTimers();
  });

  it('drops detached idle sessions to 1 FPS and freezes after the idle delay', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    pool.markSessionIdle('s1');
    expect(setFrameRate).toHaveBeenLastCalledWith(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(sendCommand).toHaveBeenCalledWith('Page.setWebLifecycleState', { state: 'frozen' });
  });

  it('does not freeze an idle session while it is visible', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    const win = mockWindow();
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    pool.markSessionIdle('s1');

    await vi.advanceTimersByTimeAsync(100);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(setFrameRate).toHaveBeenLastCalledWith(60);
  });

  it('wakes a frozen detached session before new agent activity', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    pool.markSessionIdle('s1');
    await vi.advanceTimersByTimeAsync(100);
    await pool.markSessionActive('s1');

    expect(sendCommand).toHaveBeenNthCalledWith(1, 'Page.setWebLifecycleState', { state: 'frozen' });
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'Page.setWebLifecycleState', { state: 'active' });
    expect(setFrameRate).toHaveBeenLastCalledWith(4);
  });
});

// ---------------------------------------------------------------------------
// Stats / monitoring
// ---------------------------------------------------------------------------

describe('BrowserPool — getStats', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(3); });
  afterEach(() => { pool.destroyAll(); });

  it('returns accurate stats with no sessions', () => {
    const stats = pool.getStats();
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.maxConcurrent).toBe(3);
    expect(stats.sessions).toEqual([]);
  });

  it('returns accurate stats with active sessions', () => {
    pool.create('s1');
    pool.create('s2');
    const stats = pool.getStats();
    expect(stats.active).toBe(2);
    expect(stats.sessions.length).toBe(2);
    expect(stats.sessions[0].sessionId).toBe('s1');
    expect(stats.sessions[0].attached).toBe(false);
    expect(typeof stats.sessions[0].pid).toBe('number');
    expect(typeof stats.sessions[0].createdAt).toBe('number');
  });

  it('reflects attached state in stats', () => {
    pool.create('s1');
    const win = mockWindow();
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const stats = pool.getStats();
    expect(stats.sessions[0].attached).toBe(true);
  });

  it('includes queued count', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    pool.create('s4');
    const stats = pool.getStats();
    expect(stats.active).toBe(3);
    expect(stats.queued).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Destroy / cleanup
// ---------------------------------------------------------------------------

describe('BrowserPool — destroy', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(5); });

  it('destroy removes the entry', () => {
    pool.create('s1');
    pool.destroy('s1');
    expect(pool.activeCount).toBe(0);
    expect(pool.getWebContents('s1')).toBeNull();
  });

  it('destroy is idempotent', () => {
    pool.create('s1');
    pool.destroy('s1');
    pool.destroy('s1');
    expect(pool.activeCount).toBe(0);
  });

  it('destroyAll clears everything', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    pool.destroyAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tabs (the unify workspace)
// ---------------------------------------------------------------------------

describe('BrowserPool — tabs', () => {
  let pool: BrowserPool;
  let win: any;
  let added: unknown[];
  let removed: unknown[];

  beforeEach(() => {
    pool = new BrowserPool(5);
    added = [];
    removed = [];
    win = {
      isDestroyed: () => false,
      contentView: {
        ...contentViewStub,
        addChildView: (v: unknown) => { added.push(v); },
        removeChildView: (v: unknown) => { removed.push(v); },
      },
    };
  });

  afterEach(() => { pool.destroyAll(); });

  it('starts with one active new tab', () => {
    pool.create('s1');
    const tabs = pool.listTabs('s1');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: 't1', active: true, isNewTab: true, openedBy: 'task', url: '' });
  });

  it('opens, switches and reports tabs; the session view is the active tab', async () => {
    pool.create('s1');
    const first = pool.getWebContents('s1');
    const id = pool.openTab('s1', { url: 'https://example.com/' })!;
    expect(pool.listTabs('s1').map((t) => [t.id, t.active])).toEqual([['t1', false], [id, true]]);
    expect(pool.getWebContents('s1')).not.toBe(first);
    expect(pool.getAllWebContents('s1')).toHaveLength(2);
    expect(pool.listTabs('s1')[1]).toMatchObject({ url: 'https://example.com/', isNewTab: false, openedBy: 'user' });

    expect(pool.activateTab('s1', 't1')).toBe(true);
    expect(pool.getWebContents('s1')).toBe(first);
  });

  it('swaps the native view in place when the pane is showing one', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 5, y: 6, width: 900, height: 600 });
    const firstView = pool.getView('s1');
    pool.openTab('s1', { url: 'https://example.com/' });
    const secondView = pool.getView('s1')!;
    expect(added.at(-1)).toBe(secondView);
    expect(removed.at(-1)).toBe(firstView);
    expect(secondView.getBounds()).toEqual({ x: 5, y: 6, width: 900, height: 600 });
  });

  it('closing the active tab shows its neighbour; closing the last leaves a new tab, not an ended task', () => {
    const gone = vi.fn();
    pool.setOnGone(gone);
    pool.create('s1');
    const second = pool.openTab('s1', { url: 'https://example.com/' })!;
    pool.closeTab('s1', second);
    expect(pool.listTabs('s1').map((t) => t.id)).toEqual(['t1']);
    expect(pool.listTabs('s1')[0].active).toBe(true);

    pool.closeTab('s1', 't1');
    const tabs = pool.listTabs('s1');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ active: true, isNewTab: true });
    expect(gone).not.toHaveBeenCalled();
    expect(pool.activeCount).toBe(1);
  });

  it('opens a page’s popup as a tab in the same workspace', async () => {
    const { createPopupWebContents } = await import('../../fixtures/electron-mock');
    pool.create('s1');
    const opener = pool.getWebContents('s1') as unknown as { openWindow: (d: unknown) => any };
    const decision = opener.openWindow({ url: 'https://accounts.example.com/oauth', disposition: 'foreground-tab' });
    expect(decision.action).toBe('allow');
    const popupWc = createPopupWebContents();
    expect(decision.createWindow({ webContents: popupWc })).toBe(popupWc);
    const tabs = pool.listTabs('s1');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ openedBy: 'page', active: true, isNewTab: false });
    expect(pool.getWebContents('s1')).toBe(popupWc);
  });

  it('turns address-bar input into a URL or a search', () => {
    pool.create('s1');
    pool.navigateTab('s1', undefined, 'github.com');
    expect(pool.getWebContents('s1')!.getURL()).toBe('https://github.com/');
    pool.navigateTab('s1', undefined, 'resnet vs vgg16');
    expect(pool.getWebContents('s1')!.getURL()).toMatch(/^https:\/\/www\.google\.com\/search\?q=resnet%20vs%20vgg16/);
  });

  it('pushes one coalesced change per burst of tab events', async () => {
    const changes = vi.fn();
    pool.setOnTabsChanged(changes);
    pool.create('s1');
    pool.openTab('s1', { url: 'https://example.com/' });
    pool.openTab('s1', { url: 'https://example.org/' });
    await new Promise((r) => setTimeout(r, 60));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0][1]).toHaveLength(3);
  });

  it('ends the browser when a page closes the last tab itself', () => {
    const gone = vi.fn();
    pool.setOnGone(gone);
    pool.create('s1');
    (pool.getWebContents('s1') as unknown as { destroy: () => void }).destroy();
    expect(gone).toHaveBeenCalledWith('s1');
    expect(pool.activeCount).toBe(0);
  });
});

describe('BrowserPool — the agent’s scratch tabs (dex-tab)', () => {
  let pool: BrowserPool;
  beforeEach(() => { pool = new BrowserPool(5); });
  afterEach(() => { pool.destroyAll(); });

  it('closes the agent’s background tabs at the end of the run, but not kept, shown or user tabs', () => {
    pool.create('s1');
    const scratch = pool.openTab('s1', { url: 'https://a.example/', openedBy: 'agent', activate: false, temporary: true })!;
    const kept = pool.openTab('s1', { url: 'https://b.example/', openedBy: 'agent', activate: false, temporary: true })!;
    const mine = pool.openTab('s1', { url: 'https://c.example/', openedBy: 'user', activate: false })!;
    const onScreen = pool.openTab('s1', { url: 'https://d.example/', openedBy: 'agent', activate: true, temporary: true })!;
    expect(pool.keepTab('s1', kept)).toBe(true);
    expect(pool.listTabs('s1').find((t) => t.id === scratch)?.temporary).toBe(true);
    expect(pool.listTabs('s1').find((t) => t.id === kept)?.temporary).toBe(false);

    expect(pool.closeTemporaryTabs('s1')).toBe(1);
    expect(pool.listTabs('s1').map((t) => t.id)).toEqual(['t1', kept, mine, onScreen]);
  });

  it('finds a tab’s WebContents by id', () => {
    pool.create('s1');
    const id = pool.openTab('s1', { url: 'https://a.example/', activate: false })!;
    expect(pool.getTabWebContents('s1', id)?.getURL()).toBe('https://a.example/');
    expect(pool.getTabWebContents('s1', 'nope')).toBeNull();
    expect(pool.keepTab('s1', 'nope')).toBe(false);
  });
});

describe('BrowserPool — tabs off your screen live on the stage', () => {
  type View = { getVisible(): boolean; getBounds(): { x: number; y: number; width: number; height: number } };
  let pool: BrowserPool;
  let stage: Set<unknown>;
  let screen: Set<unknown>;
  let win: any;
  const bounds = { x: 300, y: 90, width: 900, height: 640 };

  beforeEach(() => {
    stage = new Set();
    screen = new Set();
    const host = {
      contentView: { addChildView: (v: unknown) => { stage.add(v); }, removeChildView: (v: unknown) => { stage.delete(v); } },
      isDestroyed: () => false,
      getContentSize: () => [1280, 800],
      setContentSize: vi.fn(),
    };
    win = {
      isDestroyed: () => false,
      contentView: { ...contentViewStub, addChildView: (v: unknown) => { screen.add(v); }, removeChildView: (v: unknown) => { screen.delete(v); } },
    };
    pool = new BrowserPool(5, { stage: () => host as any });
  });

  afterEach(() => { vi.useRealTimers(); pool.destroyAll(); });

  it('parks a new task’s tab on the stage, laid out but asleep, until the pane shows it', () => {
    const view = pool.create('s1') as unknown as View;
    expect(stage.has(view)).toBe(true);
    expect(view.getVisible()).toBe(false);
    expect(view.getBounds()).toMatchObject({ width: 1280, height: 800 });

    pool.attachToWindow('s1', win, bounds);
    expect(screen.has(view)).toBe(true);
    expect(stage.has(view)).toBe(false);
    expect(view.getVisible()).toBe(true);
    expect(view.getBounds()).toEqual(bounds);
  });

  it('switching tabs parks the old one at the pane’s size; detaching parks the front one', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, bounds);
    const first = pool.getView('s1') as unknown as View;
    const second = pool.openTab('s1', { url: 'https://example.com/', activate: false })!;
    const secondView = pool.getTabWebContents('s1', second);
    expect(secondView).not.toBeNull();
    expect(screen.size).toBe(1);
    expect(stage.size).toBe(1); // the background tab, born on the stage at the pane's size

    pool.activateTab('s1', second);
    expect(stage.has(first)).toBe(true);
    expect(first.getVisible()).toBe(false);
    expect(first.getBounds()).toMatchObject({ x: 0, y: 0, width: 900, height: 640 });
    const front = pool.getView('s1') as unknown as View;
    expect(screen.has(front)).toBe(true);

    pool.detachFromWindow('s1', win);
    expect(screen.size).toBe(0);
    expect(stage.size).toBe(2);
  });

  it('moves the task on screen to the stage while DEX is in the tray, and back', () => {
    const view = pool.create('s1') as unknown as View;
    pool.attachToWindow('s1', win, bounds);
    pool.setWindowHidden(true);
    expect(stage.has(view)).toBe(true);
    expect(screen.has(view)).toBe(false);
    pool.setWindowHidden(false);
    expect(screen.has(view)).toBe(true);
    expect(view.getBounds()).toEqual(bounds);
  });

  it('gets out of the way for a hub menu, and recovers if the hub never asks for it back', () => {
    const view = pool.create('s1') as unknown as View;
    pool.attachToWindow('s1', win, bounds);
    pool.temporarilyDetachAll(win);
    expect(screen.has(view)).toBe(false);
    pool.reattachAll(win);
    expect(screen.has(view)).toBe(true);

    pool.temporarilyDetachAll(win);
    pool.ensureOnScreen('s1');
    expect(screen.has(view)).toBe(true);
  });

  it('wakes a parked tab while the agent uses it, then lets it sleep', () => {
    vi.useFakeTimers();
    pool.create('s1');
    pool.attachToWindow('s1', win, bounds);
    const bg = pool.openTab('s1', { url: 'https://example.com/', activate: false })!;
    const wc = pool.getTabWebContents('s1', bg)!;
    const onScreenWc = pool.getWebContents('s1')!;
    const bgView = [...stage][0] as View;

    expect(pool.noteAgentUse(wc)).toBe(true); // just woken: wait for a frame
    expect(bgView.getVisible()).toBe(true);
    expect(pool.noteAgentUse(wc)).toBe(false); // already awake
    expect(pool.noteAgentUse(onScreenWc)).toBe(false); // on screen: nothing to do

    vi.advanceTimersByTime(7_000);
    expect(bgView.getVisible()).toBe(false);
  });

  it('takes closed tabs and ended tasks off the stage and the screen', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, bounds);
    const bg = pool.openTab('s1', { url: 'https://example.com/', activate: false })!;
    expect(stage.size).toBe(1);
    pool.closeTab('s1', bg);
    expect(stage.size).toBe(0);

    pool.destroy('s1', win);
    expect(screen.size).toBe(0);
    expect(stage.size).toBe(0);
  });
});
