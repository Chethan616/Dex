import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appHandlers, appOn, loggerSpy, MockBrowserWindow } = vi.hoisted(() => {
  const loggerSpy = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const appHandlers = new Map<string, () => void>();
  const appOn = vi.fn((event: string, handler: () => void) => {
    appHandlers.set(event, handler);
  });

  class MockBrowserWindow {
    static last: MockBrowserWindow | null = null;
    static handlers = new Map<string, () => void>();
    static focusedWindow: MockBrowserWindow | null = null;

    id = 1;
    isDestroyed = vi.fn(() => false);
    isVisible = vi.fn(() => false);
    isFullScreen = vi.fn(() => false);
    isSimpleFullScreen = vi.fn(() => false);
    isMaximized = vi.fn(() => false);
    setFullScreen = vi.fn();
    setSimpleFullScreen = vi.fn();
    setFullScreenable = vi.fn();
    setMaximizable = vi.fn();
    setMinimizable = vi.fn();
    unmaximize = vi.fn();
    setMinimumSize = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setAlwaysOnTop = vi.fn();
    setParentWindow = vi.fn();
    setBounds = vi.fn();
    getBounds = vi.fn(() => ({ x: 0, y: 0, width: 380, height: 220 }));
    getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 900, height: 700 }));
    showInactive = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(() => Promise.resolve());
    loadFile = vi.fn(() => Promise.resolve());
    on = vi.fn((event: string, handler: () => void) => {
      MockBrowserWindow.handlers.set(event, handler);
    });
    webContents = {
      on: vi.fn(),
      send: vi.fn(),
      setVisualZoomLevelLimits: vi.fn(),
      setZoomFactor: vi.fn(),
    };

    constructor(public options: Record<string, unknown>) {
      MockBrowserWindow.last = this;
      MockBrowserWindow.handlers = new Map();
    }

    static getFocusedWindow(): MockBrowserWindow | null {
      return MockBrowserWindow.focusedWindow;
    }
  }

  return { appHandlers, appOn, loggerSpy, MockBrowserWindow };
});

vi.mock('../../src/main/logger', () => ({ mainLogger: loggerSpy, rendererLogger: loggerSpy }));
vi.mock('../../src/main/viteDepStaleHeal', () => ({ registerViteDepStaleHeal: vi.fn() }));

vi.mock('electron', () => ({
  app: { on: appOn },
  BrowserWindow: MockBrowserWindow,
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayMatching: vi.fn(() => ({ id: 1 })),
    getDisplayNearestPoint: vi.fn(() => ({ id: 1 })),
  },
}));

describe('logsPill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    MockBrowserWindow.last = null;
    MockBrowserWindow.focusedWindow = null;
    MockBrowserWindow.handlers = new Map();
    appHandlers.clear();
  });

  it('creates the logs window as non-fullscreenable and non-maximizable', async () => {
    const { createLogsWindow } = await import('../../src/main/logsPill');

    createLogsWindow();
    const win = MockBrowserWindow.last!;

    expect(win.options).toEqual(expect.objectContaining({
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      resizable: true,
    }));
    expect(win.setFullScreenable).toHaveBeenCalledWith(false);
    expect(win.setMaximizable).toHaveBeenCalledWith(false);
    expect(win.setMinimizable).toHaveBeenCalledWith(false);
  });

  it('leaves disallowed fullscreen and maximize states if Electron enters them', async () => {
    const { createLogsWindow } = await import('../../src/main/logsPill');

    createLogsWindow();
    const win = MockBrowserWindow.last!;
    win.isFullScreen.mockReturnValue(true);
    win.isSimpleFullScreen.mockReturnValue(true);
    win.isMaximized.mockReturnValue(true);

    MockBrowserWindow.handlers.get('enter-full-screen')?.();

    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    expect(win.setSimpleFullScreen).toHaveBeenCalledWith(false);
    expect(win.unmaximize).toHaveBeenCalled();
    expect(win.setFullScreenable).toHaveBeenLastCalledWith(false);
    expect(win.setMaximizable).toHaveBeenLastCalledWith(false);
    expect(win.setMinimizable).toHaveBeenLastCalledWith(false);
  });

  it('reapplies the non-fullscreen policy when switching log display modes', async () => {
    const { createLogsWindow, setLogsMode } = await import('../../src/main/logsPill');

    createLogsWindow();
    const win = MockBrowserWindow.last!;
    vi.clearAllMocks();

    setLogsMode('full');

    expect(win.setFullScreenable).toHaveBeenCalledWith(false);
    expect(win.setMaximizable).toHaveBeenCalledWith(false);
    expect(win.setMinimizable).toHaveBeenCalledWith(false);
  });

  it('hides the logs window when the app deactivates', async () => {
    vi.useFakeTimers();
    const { attachToHub, createLogsWindow } = await import('../../src/main/logsPill');

    createLogsWindow();
    const win = MockBrowserWindow.last!;
    win.isVisible.mockReturnValue(true);
    const hub = new MockBrowserWindow({});
    attachToHub(hub as unknown as Electron.BrowserWindow);

    appHandlers.get('did-resign-active')?.();
    vi.advanceTimersByTime(60);

    expect(win.hide).toHaveBeenCalled();
    vi.useRealTimers();
  });

  // The logs window used to be created hidden at shell startup and sit
  // resident for the app's whole life — a full extra Electron renderer
  // process even for a session that never opens Logs. showLogs/toggleLogs/
  // focusLogsFollowUp now each create the window on first use instead.
  describe('lazy creation', () => {
    it('toggleLogs creates the window on first call, with no prior createLogsWindow()', async () => {
      const { toggleLogs } = await import('../../src/main/logsPill');

      expect(MockBrowserWindow.last).toBeNull();
      toggleLogs('s1');

      expect(MockBrowserWindow.last).not.toBeNull();
    });

    it('showLogs creates the window on first call', async () => {
      const { showLogs } = await import('../../src/main/logsPill');

      expect(MockBrowserWindow.last).toBeNull();
      showLogs('s1');

      expect(MockBrowserWindow.last).not.toBeNull();
    });

    it('focusLogsFollowUp creates the window on first call', async () => {
      const { focusLogsFollowUp } = await import('../../src/main/logsPill');

      expect(MockBrowserWindow.last).toBeNull();
      focusLogsFollowUp('s1');

      expect(MockBrowserWindow.last).not.toBeNull();
    });

    it('a window created after attachToHub() still gets parented to the hub', async () => {
      const { attachToHub, showLogs } = await import('../../src/main/logsPill');
      const hub = new MockBrowserWindow({});

      attachToHub(hub as unknown as Electron.BrowserWindow); // runs before the logs window exists
      showLogs('s1'); // lazily creates it now

      const win = MockBrowserWindow.last!;
      expect(win).not.toBeNull();
      expect(win.setParentWindow).toHaveBeenCalledWith(hub);
    });
  });
});
