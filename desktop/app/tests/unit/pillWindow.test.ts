import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

interface MockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const windows: MockBrowserWindow[] = [];
const userDataPath = path.join(os.tmpdir(), `BrowserUseDesktop-pill-window-test-${process.pid}`);
const mockScreen = {
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  getDisplayNearestPoint: vi.fn(() => ({
    bounds: { x: 20, y: 30, width: 1200, height: 900 },
    workArea: { x: 20, y: 30, width: 1200, height: 900 },
  })),
  getAllDisplays: vi.fn(() => [{
    bounds: { x: 20, y: 30, width: 1200, height: 900 },
    workArea: { x: 20, y: 30, width: 1200, height: 900 },
  }]),
};

class MockBrowserWindow {
  private bounds: MockBounds;
  private destroyed = false;
  private visible = false;
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  webContents = {
    setZoomFactor: vi.fn(),
    setVisualZoomLevelLimits: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };

  constructor(opts: { width: number; height: number }) {
    this.bounds = { x: 0, y: 0, width: opts.width, height: opts.height };
    windows.push(this);
  }

  setVisibleOnAllWorkspaces = vi.fn();
  setAlwaysOnTop = vi.fn();
  setBackgroundColor = vi.fn();
  loadURL = vi.fn();
  loadFile = vi.fn();
  on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  });
  focus = vi.fn();

  getBounds(): MockBounds {
    return { ...this.bounds };
  }

  setBounds(bounds: MockBounds): void {
    this.bounds = { ...bounds };
  }

  showInactive(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  BrowserWindow: MockBrowserWindow,
  screen: mockScreen,
}));

vi.mock('../../src/main/logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function pillBoundsStorePath(): string {
  return path.join(userDataPath, 'pill-bounds.json');
}

function readSavedPillBounds(): MockBounds {
  const raw = fs.readFileSync(pillBoundsStorePath(), 'utf-8');
  return JSON.parse(raw) as MockBounds;
}

async function loadPillModule() {
  vi.resetModules();
  return import('../../src/main/pill');
}

describe('pill window sizing', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    windows.length = 0;
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true });
    mockScreen.getCursorScreenPoint.mockReturnValue({ x: 100, y: 100 });
    mockScreen.getDisplayNearestPoint.mockReturnValue({
      bounds: { x: 20, y: 30, width: 1200, height: 900 },
      workArea: { x: 20, y: 30, width: 1200, height: 900 },
    });
    mockScreen.getAllDisplays.mockReturnValue([{
      bounds: { x: 20, y: 30, width: 1200, height: 900 },
      workArea: { x: 20, y: 30, width: 1200, height: 900 },
    }]);
  });

  test('showPill preserves the last renderer-requested height while repositioning', async () => {
    const pill = await loadPillModule();

    const win = pill.createPillWindow();
    pill.setPillHeight(141);

    expect(win.getBounds().height).toBe(141);

    pill.hidePill();
    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 20 + (1200 - pill.PILL_WIDTH) / 2,
      y: 190,
      width: pill.PILL_WIDTH,
      height: 141,
    });
  });

  test('showPill restores the last user-moved position after hide', async () => {
    vi.useFakeTimers();
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();
    vi.advanceTimersByTime(250);

    win.setBounds({ x: 400, y: 260, width: pill.PILL_WIDTH, height: pill.PILL_HEIGHT_COLLAPSED });
    win.emit('move');

    expect(readSavedPillBounds()).toEqual({
      x: 400,
      y: 260,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });

    pill.hidePill();
    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 400,
      y: 260,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });
  });

  test('showPill restores the persisted position after module reload', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 380, y: 250, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 380,
      y: 250,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });
  });

  test('showPill clamps a partially offscreen saved position to the visible work area', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 1100, y: 880, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 20 + 1200 - pill.PILL_WIDTH,
      y: 30 + 900 - pill.PILL_HEIGHT_COLLAPSED,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });
    expect(readSavedPillBounds()).toEqual({
      x: 20 + 1200 - pill.PILL_WIDTH,
      y: 30 + 900 - pill.PILL_HEIGHT_COLLAPSED,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });
  });

  test('showPill falls back to the default position when saved position is fully offscreen', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 9000, y: 9000, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 20 + (1200 - pill.PILL_WIDTH) / 2,
      y: 190,
      width: pill.PILL_WIDTH,
      height: pill.PILL_HEIGHT_COLLAPSED,
    });
  });
});

describe('pill window lazy creation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    windows.length = 0;
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true });
  });

  // The pill used to be created hidden at app startup and stay resident for
  // the app's whole life — one extra idle Electron renderer process even for
  // someone who never opens it. togglePill() is the one entry point every
  // caller (hotkey, tray, onboarding, IPC) goes through, so creating on
  // first toggle there is what makes lazy creation actually lazy everywhere.
  test('togglePill creates the window on first call, with no prior createPillWindow()', async () => {
    const pill = await loadPillModule();

    expect(windows.length).toBe(0);
    pill.togglePill();

    expect(windows.length).toBe(1);
    expect(windows[0].isVisible()).toBe(true);
  });

  test('a second togglePill() reuses the same window instance rather than creating another', async () => {
    const pill = await loadPillModule();

    pill.togglePill(); // creates + shows
    pill.togglePill(); // hides

    expect(windows.length).toBe(1);
    expect(windows[0].isVisible()).toBe(false);
  });
});

describe('roundedRectShape', () => {
  test('covers the full card height with no gaps and stays inside its bounds', async () => {
    const pill = await loadPillModule();
    const rects = pill.roundedRectShape(720, 120, 20);
    const rows = new Set<number>();
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(720);
      for (let y = r.y; y < r.y + r.height; y++) rows.add(y);
    }
    expect(rows.size).toBe(120);
    // Corners are cut, the middle is full width.
    const top = rects.find((r) => r.y === 0)!;
    expect(top.x).toBeGreaterThan(0);
    expect(rects.find((r) => r.y === 20 && r.height > 1)).toMatchObject({ x: 0, width: 720 });
  });

  test('a zero radius is one plain rectangle', async () => {
    const pill = await loadPillModule();
    expect(pill.roundedRectShape(100, 40, 0)).toEqual([{ x: 0, y: 0, width: 100, height: 40 }]);
  });
});
