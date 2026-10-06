import { WebContentsView, nativeTheme, type BrowserWindow, type View, type WebContents } from 'electron';
import { browserLogger } from '../logger';
import { getWindowBackgroundColor } from '../themeMode';
import { leaseDebugger } from '../cdpLease';
import { normalizeAddress } from '../../shared/address';
import { noteInputEvent } from '../workspace/userActivity';
import { fitStage, getStage, type StageHost } from '../workspace/stage';
import type { TabInfo } from './types';

const DEFAULT_BROWSER_WIDTH = 1280;
const DEFAULT_BROWSER_HEIGHT = 800;
const DEFAULT_MAX_CONCURRENT = 10;
const THROTTLED_FRAME_RATE = 4;
const IDLE_FRAME_RATE = 1;
const ACTIVE_FRAME_RATE = 60;
const DEFAULT_IDLE_FREEZE_DELAY_MS = 15_000;
/** Tabs per task before opening another quietly closes the oldest background one. */
const MAX_TABS_PER_SESSION = 12;
/** How long a tab off your screen stays awake after the agent last used it. */
const AGENT_BUSY_MS = 6_000;

type Rect = { x: number; y: number; width: number; height: number };
type ViewHost = { contentView: { addChildView(view: View): void; removeChildView(view: View): void }; isDestroyed(): boolean };

/**
 * Who opened a tab: the task's first tab ('task'), the user (the + button,
 * Ctrl+T), a page (window.open, target=_blank, an OAuth popup), or the agent
 * itself (`dex-tab new`).
 */
export type TabOpener = 'task' | 'user' | 'page' | 'agent';

/** One tab as the workspace UI sees it. */
export interface WorkspaceTabState {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  openedBy: TabOpener;
  /** Nothing loaded yet: the workspace shows DEX's New-tab page instead. */
  isNewTab: boolean;
  crashed: boolean;
  /** Opened by DEX for its own work; closed when the run ends unless kept. */
  temporary: boolean;
  /** Page zoom in percent (100 when not zoomed). */
  zoom: number;
}

export type TabAction = 'back' | 'forward' | 'reload' | 'stop';

export const WORKSPACE_SHORTCUTS = [
  'new-tab', 'close-tab', 'reopen-tab', 'focus-address', 'reload', 'back', 'forward', 'next-tab', 'prev-tab',
  'find', 'zoom-in', 'zoom-out', 'zoom-reset',
] as const;
export type WorkspaceShortcut = typeof WORKSPACE_SHORTCUTS[number];

export type ZoomStep = 'in' | 'out' | 'reset';

/** Chrome's zoom levels. */
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** The next zoom level from `current`, Chrome's way: the nearest level past it. */
export function nextZoom(current: number, step: ZoomStep): number {
  if (step === 'reset') return 1;
  if (step === 'in') return ZOOM_LEVELS.find((z) => z > current + 0.001) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((z) => z < current - 0.001) ?? ZOOM_LEVELS[0];
}

/** Find-in-page's count, for the find bar. */
export interface FindResult {
  /** 1-based; 0 when nothing matches. */
  active: number;
  matches: number;
}

/** How many closed tabs Ctrl+Shift+T can bring back, per task. */
const REOPEN_STACK = 10;

interface TabEntry {
  id: string;
  view: WebContentsView;
  openedBy: TabOpener;
  createdAt: number;
  faviconUrl: string | null;
  loading: boolean;
  crashed: boolean;
  /** Has ever started a real navigation (so it's no longer a "new tab"). */
  navigated: boolean;
  /** The agent's scratch tab: closed at the end of the run unless kept. */
  temporary: boolean;
  kept: boolean;
  /** On your screen (in DEX's window), parked on the stage, or in no window. */
  place: 'screen' | 'stage' | 'none';
  parent: ViewHost | null;
  /** Set while the agent is using a tab that's off your screen (it's shown on the stage). */
  agentBusyTimer: ReturnType<typeof setTimeout> | null;
}

interface PoolEntry {
  sessionId: string;
  /** The active tab's view — what "the session's browser" means everywhere else. */
  view: WebContentsView;
  tabs: TabEntry[];
  activeTabId: string;
  nextTabSeq: number;
  createdAt: number;
  attached: boolean;
  /** Last bounds the pane gave us, so a newly activated tab lands in the same rect. */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** The window the active view is attached to (for swapping tabs in place). */
  window: BrowserWindow | null;
  idleFreezeEligible: boolean;
  frozen: boolean;
  freezeTimer: ReturnType<typeof setTimeout> | null;
  /** Pages you closed, newest last, for Ctrl+Shift+T. DEX's scratch tabs aren't kept. */
  closed?: string[];
}

function readIdleFreezeDelayMs(): number {
  const raw = process.env.BU_IDLE_BROWSER_FREEZE_DELAY_MS;
  if (raw == null || raw.trim() === '') return DEFAULT_IDLE_FREEZE_DELAY_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_IDLE_FREEZE_DELAY_MS;
  return value;
}

function isBlank(url: string): boolean {
  return !url || url === 'about:blank';
}

export class BrowserPool {
  private entries: Map<string, PoolEntry> = new Map();
  private maxConcurrent: number;
  private queue: string[] = [];
  private onGone?: (sessionId: string) => void;
  private onNavigate?: (sessionId: string, url: string) => void;
  private onInterruptShortcut?: (sessionId: string) => boolean | void;
  private onTabsChanged?: (sessionId: string, tabs: WorkspaceTabState[]) => void;
  private onFocusAddress?: (sessionId: string) => void;
  private onFind?: (sessionId: string) => void;
  private onFound?: (sessionId: string, tabId: string, result: FindResult) => void;
  private tabsChangedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private idleFreezeDelayMs: number;
  private stage: () => StageHost | null;
  /** The hub asked for the views out of the way (a menu over them). */
  private uiHidden = false;
  /** DEX's window is hidden (closed to the tray) or minimized. */
  private windowHidden = false;

  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT, opts: { idleFreezeDelayMs?: number; stage?: () => StageHost | null } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.idleFreezeDelayMs = opts.idleFreezeDelayMs ?? readIdleFreezeDelayMs();
    this.stage = opts.stage ?? getStage;
    browserLogger.info('BrowserPool.init', { maxConcurrent });

    // Repaint every pooled view (attached AND detached, every tab) when the
    // theme flips. themeMode.applyBackgroundToAllWindows only walks attached
    // contentView children, so a session sitting at "Browser not started
    // yet" while the user toggles theme would otherwise carry stale bg
    // until next attach.
    nativeTheme.on('updated', () => {
      const color = getWindowBackgroundColor();
      for (const entry of this.entries.values()) {
        for (const tab of entry.tabs) {
          try { tab.view.setBackgroundColor(color); } catch { /* view destroyed */ }
        }
      }
    });
  }

  /** Register a listener that fires when a session's WebContents is gone
   *  (destroyed, crashed, or explicitly closed). Used to push a browser-gone
   *  notification to the renderer so the UI can stop showing "Browser starting…". */
  setOnGone(listener: (sessionId: string) => void): void {
    this.onGone = listener;
  }

  /** Register a listener that fires on every top-frame navigation (including
   *  in-page hash/pushState) of the tab being shown. Used by SessionManager
   *  to keep session.primarySite in sync with the actual browser. */
  setOnNavigate(listener: (sessionId: string, url: string) => void): void {
    this.onNavigate = listener;
  }

  /** Register a listener for Ctrl+C inside an attached browser view. Returning
   *  true means the keypress was handled and should not continue into the page. */
  setOnInterruptShortcut(listener: (sessionId: string) => boolean | void): void {
    this.onInterruptShortcut = listener;
  }

  /** Tabs opened, closed, switched, navigated, retitled or loading — coalesced. */
  setOnTabsChanged(listener: (sessionId: string, tabs: WorkspaceTabState[]) => void): void {
    this.onTabsChanged = listener;
  }

  private notifyGone(sessionId: string): void {
    try { this.onGone?.(sessionId); } catch (err) {
      browserLogger.warn('BrowserPool.notifyGone.listenerError', { sessionId, error: (err as Error).message });
    }
  }

  private notifyNavigate(sessionId: string, url: string): void {
    try { this.onNavigate?.(sessionId, url); } catch (err) {
      browserLogger.warn('BrowserPool.notifyNavigate.listenerError', { sessionId, error: (err as Error).message });
    }
  }

  private notifyInterruptShortcut(sessionId: string): boolean {
    try { return this.onInterruptShortcut?.(sessionId) === true; } catch (err) {
      browserLogger.warn('BrowserPool.notifyInterruptShortcut.listenerError', { sessionId, error: (err as Error).message });
      return false;
    }
  }

  /** Many events per page load (title, favicon, loading, in-page nav) → one push. */
  private scheduleTabsChanged(sessionId: string): void {
    if (!this.onTabsChanged || this.tabsChangedTimers.has(sessionId)) return;
    this.tabsChangedTimers.set(sessionId, setTimeout(() => {
      this.tabsChangedTimers.delete(sessionId);
      if (!this.entries.has(sessionId)) return;
      try { this.onTabsChanged?.(sessionId, this.listTabs(sessionId)); } catch (err) {
        browserLogger.warn('BrowserPool.notifyTabsChanged.listenerError', { sessionId, error: (err as Error).message });
      }
    }, 30));
  }

  get activeCount(): number {
    return this.entries.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  canCreate(): boolean {
    return this.entries.size < this.maxConcurrent;
  }

  create(sessionId: string, sessionStartedAt?: number): WebContentsView | null {
    if (this.entries.has(sessionId)) {
      browserLogger.warn('BrowserPool.create.duplicate', { sessionId });
      return this.entries.get(sessionId)!.view;
    }

    if (!this.canCreate()) {
      this.queue.push(sessionId);
      browserLogger.warn('BrowserPool.create.queued', {
        sessionId,
        activeCount: this.entries.size,
        maxConcurrent: this.maxConcurrent,
        queuePosition: this.queue.length,
      });
      return null;
    }

    const startupStartedAt = Date.now();
    const timingStartedAt = sessionStartedAt ?? startupStartedAt;
    browserLogger.info('BrowserPool.startup.start', {
      sessionId,
      component: 'BrowserPool',
      area: 'startup',
      event: 'start',
      msSinceSessionStart: Date.now() - timingStartedAt,
      activeCount: this.entries.size,
      maxConcurrent: this.maxConcurrent,
    });

    const entry: PoolEntry = {
      sessionId,
      view: null as unknown as WebContentsView,
      tabs: [],
      activeTabId: '',
      nextTabSeq: 1,
      createdAt: startupStartedAt,
      attached: false,
      bounds: null,
      window: null,
      idleFreezeEligible: false,
      frozen: false,
      freezeTimer: null,
    };
    this.entries.set(sessionId, entry);

    const tab = this.addTab(entry, { openedBy: 'task', timingStartedAt });
    entry.view = tab.view;
    entry.activeTabId = tab.id;

    browserLogger.info('BrowserPool.create', {
      sessionId,
      activeCount: this.entries.size,
      maxConcurrent: this.maxConcurrent,
      pid: tab.view.webContents.getOSProcessId(),
    });
    this.scheduleTabsChanged(sessionId);
    return tab.view;
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  /**
   * Make a tab. `webContents` is set for a page-opened popup: Chromium already
   * made its WebContents (so `window.opener` works) and we host it in a view.
   */
  private addTab(
    entry: PoolEntry,
    opts: { openedBy: TabOpener; webContents?: WebContents; timingStartedAt?: number },
  ): TabEntry {
    const view = opts.webContents
      ? new WebContentsView({ webContents: opts.webContents })
      : new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: true,
        },
      });
    // Without this, attach/detach during view swaps briefly paints black
    // (Chromium's default before the page commits its first frame).
    view.setBackgroundColor(getWindowBackgroundColor());
    const tab: TabEntry = {
      id: `t${entry.nextTabSeq++}`,
      view,
      openedBy: opts.openedBy,
      createdAt: Date.now(),
      faviconUrl: null,
      loading: false,
      crashed: false,
      navigated: Boolean(opts.webContents),
      temporary: false,
      kept: false,
      place: 'none',
      parent: null,
      agentBusyTimer: null,
    };
    entry.tabs.push(tab);
    this.wireTab(entry, tab, opts.timingStartedAt ?? Date.now());
    // Born off screen, on the stage at the pane's size: it lays out at the
    // size it'll be shown at, and the agent can use it before you ever see it.
    this.park(tab, entry.bounds ?? { x: 0, y: 0, width: DEFAULT_BROWSER_WIDTH, height: DEFAULT_BROWSER_HEIGHT });
    return tab;
  }

  private wireTab(entry: PoolEntry, tab: TabEntry, timingStartedAt: number): void {
    const { sessionId } = entry;
    const view = tab.view;
    const wc = view.webContents;
    const startupStartedAt = Date.now();
    const startupMs = (): number => Date.now() - startupStartedAt;
    const sessionMs = (): number => Date.now() - timingStartedAt;
    const isActive = (): boolean => this.entries.get(sessionId)?.activeTabId === tab.id;
    const changed = (): void => this.scheduleTabsChanged(sessionId);

    browserLogger.info('BrowserPool.startup.constructed', {
      sessionId,
      tabId: tab.id,
      component: 'BrowserPool',
      area: 'startup',
      event: 'constructed',
      msSinceSessionStart: sessionMs(),
      pid: wc.getOSProcessId(),
      wcId: wc.id,
    });

    // Anti-detection: replace the Electron default UA with a vanilla Chrome UA.
    // The default contains TWO bot tells — the app name token (`app/x.y.z`)
    // injected by Electron between `Gecko)` and `Chrome/`, and the Electron
    // token (`Electron/x.y.z`) before `Safari/`. Strip both. We keep the real
    // bundled Chromium version (process.versions.chrome) so feature-detection,
    // Sec-CH-UA hints, and TLS fingerprint stay coherent with the engine.
    try {
      const defaultUa = wc.getUserAgent();
      const cleanedUa = defaultUa
        .replace(/\sElectron\/\S+/, '')
        .replace(/\s[A-Za-z][\w-]*\/\d+\.\d+\.\d+(?=\sChrome\/)/, '');
      if (cleanedUa !== defaultUa) {
        wc.setUserAgent(cleanedUa);
        browserLogger.info('BrowserPool.userAgent.stripped', { sessionId, tabId: tab.id, before: defaultUa, after: cleanedUa });
      }
    } catch (err) {
      browserLogger.warn('BrowserPool.userAgent.error', { sessionId, error: (err as Error).message });
    }

    // Anti-detection: hide `navigator.webdriver` on every frame load. Runs in
    // the page's isolated world via executeJavaScript — does not touch the
    // CDP session the agent uses, so driving behavior is unaffected.
    const hideWebdriver = (): void => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(
        "try{Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>undefined,configurable:true})}catch(e){}",
        true,
      ).catch(() => { /* frame may have navigated away */ });
    };
    wc.on('dom-ready', hideWebdriver);
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'c' && input.control && !input.meta && !input.alt) {
        const handled = this.notifyInterruptShortcut(sessionId);
        if (handled) event.preventDefault();
        return;
      }
      // Browser shortcuts while the page has focus (the hub handles the same
      // keys when its own chrome has focus).
      const shortcut = this.browserShortcut(key, input);
      if (!shortcut) return;
      event.preventDefault();
      this.runShortcut(sessionId, tab.id, shortcut);
    });

    wc.setFrameRate(THROTTLED_FRAME_RATE);

    // Your input to the page, so DEX can wait while you're using it
    // (workspace/userActivity.ts). DEX's own CDP input is filtered out there.
    wc.on('input-event', (_event, input) => noteInputEvent(wc, input.type));

    // window.open / target=_blank / OAuth popups become tabs in this
    // workspace instead of stray native windows. Chromium makes the
    // WebContents itself, so window.opener keeps working.
    try {
      wc.setWindowOpenHandler(({ url, disposition }) => {
        const live = this.entries.get(sessionId);
        if (!live) return { action: 'deny' };
        return {
          action: 'allow',
          createWindow: (options) => {
            // Electron passes the WebContents Chromium made for the popup (not
            // in its BrowserWindowConstructorOptions type); hosting that one is
            // what keeps window.opener alive.
            const popupContents = (options as { webContents?: WebContents }).webContents;
            const popup = this.addTab(live, { openedBy: 'page', webContents: popupContents });
            browserLogger.info('BrowserPool.tab.popup', { sessionId, tabId: popup.id, from: tab.id, url, disposition });
            this.trimTabs(live);
            if (disposition !== 'background-tab') this.activateTab(sessionId, popup.id);
            this.scheduleTabsChanged(sessionId);
            return popup.view.webContents;
          },
        };
      });
    } catch (err) {
      browserLogger.warn('BrowserPool.tab.windowOpenHandler.error', { sessionId, error: (err as Error).message });
    }

    let navigationSeq = 0;
    let currentNavigation: { id: number; url: string; startedAt: number } | null = null;
    const navigationElapsedMs = (): number | null =>
      currentNavigation ? Date.now() - currentNavigation.startedAt : null;

    wc.once('did-start-loading', () => {
      browserLogger.info('BrowserPool.startup.didStartLoading', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'startup', event: 'didStartLoading',
        msSinceCreate: startupMs(), msSinceSessionStart: sessionMs(), pid: wc.getOSProcessId(), wcId: wc.id, url: wc.getURL(),
      });
    });
    wc.once('dom-ready', () => {
      browserLogger.info('BrowserPool.startup.domReady', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'startup', event: 'domReady',
        msSinceCreate: startupMs(), msSinceSessionStart: sessionMs(), pid: wc.getOSProcessId(), wcId: wc.id, url: wc.getURL(),
      });
    });
    wc.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      browserLogger.warn('BrowserPool.startup.didFailLoad', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'startup', event: 'didFailLoad',
        msSinceCreate: startupMs(), msSinceSessionStart: sessionMs(), pid: wc.getOSProcessId(), wcId: wc.id,
        errorCode, errorDescription, validatedURL, isMainFrame,
      });
    });

    wc.on('destroyed', () => {
      browserLogger.info('BrowserPool.wc.destroyed', { sessionId, tabId: tab.id, msSinceCreate: startupMs() });
      this.forgetTab(sessionId, tab.id);
    });
    wc.on('render-process-gone', (_event, details) => {
      browserLogger.warn('BrowserPool.wc.renderProcessGone', { sessionId, tabId: tab.id, reason: details.reason, msSinceCreate: startupMs() });
      tab.crashed = true;
      changed();
      // Only the tab on screen ends "the browser"; a crashed background tab
      // just shows as crashed in the strip.
      if (isActive()) this.notifyGone(sessionId);
    });

    wc.on('found-in-page', (_event, result) => {
      if (!result.finalUpdate) return;
      this.onFound?.(sessionId, tab.id, { active: result.activeMatchOrdinal ?? 0, matches: result.matches ?? 0 });
    });
    wc.on('zoom-changed', () => changed());

    wc.on('did-start-loading', () => { tab.loading = true; changed(); });
    wc.on('did-stop-loading', () => { tab.loading = false; changed(); });
    wc.on('page-title-updated', () => changed());
    wc.on('page-favicon-updated', (_event, favicons) => {
      tab.faviconUrl = favicons.find((f) => /^https?:|^data:image\//.test(f)) ?? null;
      changed();
    });

    wc.on('did-start-navigation', (details) => {
      const { url, isMainFrame, isSameDocument } = details as unknown as { url: string; isMainFrame: boolean; isSameDocument: boolean };
      if (!isMainFrame) return;
      if (!isBlank(url)) tab.navigated = true;
      navigationSeq += 1;
      currentNavigation = { id: navigationSeq, url, startedAt: Date.now() };
      browserLogger.info('BrowserPool.navigation.start', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'start',
        navigationId: currentNavigation.id, url, isSameDocument,
        msSinceBrowserCreate: startupMs(), msSinceSessionStart: sessionMs(), pid: wc.getOSProcessId(), wcId: wc.id,
      });
      if (!isSameDocument) tab.faviconUrl = null;
      changed();
    });
    wc.on('did-redirect-navigation', (details) => {
      const { url, isMainFrame } = details as unknown as { url: string; isMainFrame: boolean };
      if (!isMainFrame) return;
      if (currentNavigation) currentNavigation.url = url;
      browserLogger.info('BrowserPool.navigation.redirect', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'redirect',
        navigationId: currentNavigation?.id ?? null, url, msSinceNavigationStart: navigationElapsedMs(),
      });
    });
    // Top-frame navigation — full page load. Covers agent-driven goto(),
    // user clicks on links, form submits, history back/forward, etc.
    wc.on('did-navigate', (_event, url) => {
      browserLogger.info('BrowserPool.navigation.didNavigate', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'didNavigate',
        navigationId: currentNavigation?.id ?? null, url, startedUrl: currentNavigation?.url ?? null,
        msSinceNavigationStart: navigationElapsedMs(), msSinceBrowserCreate: startupMs(), msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(), wcId: wc.id,
      });
      if (isActive()) this.notifyNavigate(sessionId, url);
      changed();
    });
    wc.on('did-finish-load', () => {
      if (!currentNavigation) return;
      browserLogger.info('BrowserPool.navigation.didFinishLoad', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'didFinishLoad',
        navigationId: currentNavigation.id, url: wc.getURL(), startedUrl: currentNavigation.url,
        msSinceNavigationStart: navigationElapsedMs(), msSinceBrowserCreate: startupMs(), msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(), wcId: wc.id,
      });
      currentNavigation = null;
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      browserLogger.warn('BrowserPool.navigation.didFailLoad', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'didFailLoad',
        navigationId: currentNavigation?.id ?? null, validatedURL, startedUrl: currentNavigation?.url ?? null,
        msSinceNavigationStart: navigationElapsedMs(), errorCode, errorDescription, pid: wc.getOSProcessId(), wcId: wc.id,
      });
      if (errorCode !== -3) currentNavigation = null;
      changed();
    });
    // SPA/hash navigation — pushState, replaceState, hash changes. Many
    // sites (x.com, linkedin, gmail) never fire did-navigate after the
    // initial load, so without this the primarySite gets stuck on the
    // first URL and misses SPA route changes.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      browserLogger.info('BrowserPool.navigation.inPage', {
        sessionId, tabId: tab.id, component: 'BrowserPool', area: 'navigation', event: 'inPage', url,
      });
      if (isActive()) this.notifyNavigate(sessionId, url);
      changed();
    });
  }

  private browserShortcut(
    key: string,
    input: { control: boolean; shift: boolean; alt: boolean; meta: boolean },
  ): WorkspaceShortcut | null {
    if (input.control && !input.alt && !input.meta) {
      if (key === 't') return input.shift ? 'reopen-tab' : 'new-tab';
      if (key === 'w') return 'close-tab';
      if (key === 'l') return 'focus-address';
      if (key === 'r') return 'reload';
      if (key === 'tab') return input.shift ? 'prev-tab' : 'next-tab';
      if (key === 'f') return 'find';
      if (key === '=' || key === '+') return 'zoom-in';
      if (key === '-' || key === '_') return 'zoom-out';
      if (key === '0') return 'zoom-reset';
    }
    if (input.alt && !input.control && !input.meta) {
      if (key === 'arrowleft') return 'back';
      if (key === 'arrowright') return 'forward';
    }
    if (key === 'f5' && !input.control && !input.alt) return 'reload';
    return null;
  }

  /** Run a workspace shortcut against a session's tabs. */
  runShortcut(sessionId: string, tabId: string | undefined, shortcut: WorkspaceShortcut): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const current = tabId ?? entry.activeTabId;
    switch (shortcut) {
      case 'new-tab':
        this.openTab(sessionId, { openedBy: 'user' });
        this.onFocusAddress?.(sessionId);
        break;
      case 'close-tab':
        this.closeTab(sessionId, current);
        break;
      case 'reopen-tab': {
        const url = entry.closed?.pop();
        if (url) this.openTab(sessionId, { url, openedBy: 'user' });
        break;
      }
      case 'focus-address':
        this.onFocusAddress?.(sessionId);
        break;
      case 'reload':
        this.tabAction(sessionId, current, 'reload');
        break;
      case 'back':
      case 'forward':
        this.tabAction(sessionId, current, shortcut);
        break;
      case 'next-tab':
      case 'prev-tab': {
        const i = entry.tabs.findIndex((t) => t.id === entry.activeTabId);
        const step = shortcut === 'next-tab' ? 1 : -1;
        const next = entry.tabs[(i + step + entry.tabs.length) % entry.tabs.length];
        if (next) this.activateTab(sessionId, next.id);
        break;
      }
      case 'find':
        this.onFind?.(sessionId);
        break;
      case 'zoom-in':
      case 'zoom-out':
      case 'zoom-reset':
        this.zoomTab(sessionId, current, shortcut === 'zoom-in' ? 'in' : shortcut === 'zoom-out' ? 'out' : 'reset');
        break;
    }
  }

  /** The hub should put the cursor in the address bar (Ctrl+L, a new tab). */
  setOnFocusAddress(listener: (sessionId: string) => void): void {
    this.onFocusAddress = listener;
  }

  /** The hub should open its find bar (Ctrl+F in the page). */
  setOnFind(listener: (sessionId: string) => void): void {
    this.onFind = listener;
  }

  /** Find-in-page's count changed. */
  setOnFound(listener: (sessionId: string, tabId: string, result: FindResult) => void): void {
    this.onFound = listener;
  }

  /** Zoom a tab a step (Chrome's levels). Returns the new zoom in percent, or null. */
  zoomTab(sessionId: string, tabId: string | undefined, step: ZoomStep): number | null {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === (tabId ?? entry.activeTabId));
    if (!entry || !tab || tab.view.webContents.isDestroyed()) return null;
    const wc = tab.view.webContents;
    const next = nextZoom(wc.getZoomFactor(), step);
    wc.setZoomFactor(next);
    this.scheduleTabsChanged(sessionId);
    return Math.round(next * 100);
  }

  /**
   * Find `text` in a tab: a new search, or with `next` the next match
   * (`forward: false` for the previous one). Empty text stops finding.
   */
  findInTab(sessionId: string, tabId: string | undefined, text: string, opts: { forward?: boolean; next?: boolean } = {}): boolean {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === (tabId ?? entry.activeTabId));
    if (!entry || !tab || tab.view.webContents.isDestroyed()) return false;
    const wc = tab.view.webContents;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      this.onFound?.(sessionId, tab.id, { active: 0, matches: 0 });
      return true;
    }
    wc.findInPage(text, { forward: opts.forward ?? true, findNext: !opts.next });
    return true;
  }

  /** Close find: the highlights go, and the current match stays selected. */
  stopFind(sessionId: string, tabId: string | undefined): void {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === (tabId ?? entry.activeTabId));
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('keepSelection');
  }

  /** A tab's WebContents went away (closed by us, or by the page). */
  private forgetTab(sessionId: string, tabId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const index = entry.tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return;
    const [gone] = entry.tabs.splice(index, 1);
    this.unplace(gone);
    if (entry.tabs.length === 0) {
      // The last tab went away on its own: the browser is gone.
      this.clearIdleFreezeTimer(entry);
      this.entries.delete(sessionId);
      this.notifyGone(sessionId);
      return;
    }
    if (entry.activeTabId === tabId) {
      const next = entry.tabs[Math.min(index, entry.tabs.length - 1)];
      this.swapActive(entry, null, next);
    }
    this.scheduleTabsChanged(sessionId);
  }

  /** Put `next` on screen where `prev` was (if the pane is showing one). */
  private swapActive(entry: PoolEntry, prev: TabEntry | null, next: TabEntry): void {
    entry.activeTabId = next.id;
    entry.view = next.view;
    const win = entry.window;
    if (!entry.attached || !win || win.isDestroyed()) return;
    if (this.screenAllowed()) this.putOnScreen(next, win, entry.bounds);
    else this.park(next, entry.bounds);
    if (prev && prev !== next) this.park(prev, entry.bounds);
    this.applyFrameRate(entry);
    void this.wakeForVisibility(entry, 'tab-switch');
    const url = next.view.webContents.getURL();
    if (!isBlank(url)) this.notifyNavigate(entry.sessionId, url);
  }

  /** Keep a task from hoarding tabs: close the oldest background tab past the cap. */
  private trimTabs(entry: PoolEntry): void {
    while (entry.tabs.length > MAX_TABS_PER_SESSION) {
      const victim = entry.tabs.find((t) => t.id !== entry.activeTabId);
      if (!victim) return;
      browserLogger.info('BrowserPool.tab.trimmed', { sessionId: entry.sessionId, tabId: victim.id });
      this.closeTab(entry.sessionId, victim.id);
    }
  }

  /** Open a tab. Without a URL it's a new tab (the workspace shows its New-tab page). */
  openTab(sessionId: string, opts: { url?: string; activate?: boolean; openedBy?: TabOpener; temporary?: boolean } = {}): string | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    const tab = this.addTab(entry, { openedBy: opts.openedBy ?? 'user' });
    tab.temporary = opts.temporary === true;
    if (opts.url) {
      tab.navigated = !isBlank(opts.url);
      tab.view.webContents.loadURL(opts.url).catch((err) => {
        browserLogger.warn('BrowserPool.tab.load.error', { sessionId, tabId: tab.id, error: (err as Error).message });
      });
    }
    this.trimTabs(entry);
    if (opts.activate !== false) this.activateTab(sessionId, tab.id);
    browserLogger.info('BrowserPool.tab.open', { sessionId, tabId: tab.id, openedBy: tab.openedBy, hasUrl: Boolean(opts.url) });
    this.scheduleTabsChanged(sessionId);
    return tab.id;
  }

  activateTab(sessionId: string, tabId: string): boolean {
    const entry = this.entries.get(sessionId);
    const next = entry?.tabs.find((t) => t.id === tabId);
    if (!entry || !next) return false;
    if (entry.activeTabId === tabId) return true;
    const prev = entry.tabs.find((t) => t.id === entry.activeTabId) ?? null;
    this.swapActive(entry, prev, next);
    this.scheduleTabsChanged(sessionId);
    return true;
  }

  /** Close a tab. The last tab is replaced by a fresh new tab, never left empty. */
  closeTab(sessionId: string, tabId: string): boolean {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === tabId);
    if (!entry || !tab) return false;
    if (entry.tabs.length === 1) {
      this.openTab(sessionId, { activate: true, openedBy: 'user' });
    }
    // Remember a real page for Ctrl+Shift+T (not DEX's own scratch tabs).
    const closedUrl = tab.view.webContents.isDestroyed() ? '' : tab.view.webContents.getURL();
    if (!tab.temporary && !isBlank(closedUrl)) {
      entry.closed = [...(entry.closed ?? []), closedUrl].slice(-REOPEN_STACK);
    }
    // forgetTab via 'destroyed' would also do this; do it now so the strip
    // updates immediately even if Chromium takes its time.
    this.forgetTab(sessionId, tabId);
    const wc = tab.view.webContents;
    try {
      if (!wc.isDestroyed()) (wc as unknown as { close: () => void }).close();
    } catch { /* already closing */ }
    setImmediate(() => {
      try { if (!wc.isDestroyed()) (wc as unknown as { destroy?: () => void }).destroy?.(); } catch { /* gone */ }
    });
    browserLogger.info('BrowserPool.tab.close', { sessionId, tabId });
    return true;
  }

  /** Address-bar input: a URL, or words to search for. */
  navigateTab(sessionId: string, tabId: string | undefined, input: string): boolean {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === (tabId ?? entry.activeTabId));
    const url = normalizeAddress(input);
    if (!entry || !tab || !url) return false;
    tab.navigated = !isBlank(url);
    tab.view.webContents.loadURL(url).catch((err) => {
      browserLogger.warn('BrowserPool.tab.navigate.error', { sessionId, tabId: tab.id, error: (err as Error).message });
    });
    this.scheduleTabsChanged(sessionId);
    return true;
  }

  tabAction(sessionId: string, tabId: string | undefined, action: TabAction): boolean {
    const entry = this.entries.get(sessionId);
    const tab = entry?.tabs.find((t) => t.id === (tabId ?? entry.activeTabId));
    if (!entry || !tab) return false;
    const wc = tab.view.webContents;
    const history = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void } }).navigationHistory;
    switch (action) {
      case 'back': if (history?.canGoBack()) history.goBack(); break;
      case 'forward': if (history?.canGoForward()) history.goForward(); break;
      case 'reload': wc.reload(); break;
      case 'stop': wc.stop(); break;
    }
    return true;
  }

  listTabs(sessionId: string): WorkspaceTabState[] {
    const entry = this.entries.get(sessionId);
    if (!entry) return [];
    return entry.tabs.map((tab) => {
      const wc = tab.view.webContents;
      let url = '';
      let title = '';
      let canGoBack = false;
      let canGoForward = false;
      let zoom = 100;
      try {
        zoom = Math.round((wc.getZoomFactor?.() ?? 1) * 100);
        url = wc.getURL();
        title = wc.getTitle();
        const history = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean } }).navigationHistory;
        canGoBack = history?.canGoBack() ?? false;
        canGoForward = history?.canGoForward() ?? false;
      } catch { /* destroyed mid-read */ }
      return {
        id: tab.id,
        url: isBlank(url) ? '' : url,
        title: title && title !== url && !isBlank(title) ? title : '',
        faviconUrl: tab.faviconUrl,
        loading: tab.loading,
        canGoBack,
        canGoForward,
        active: tab.id === entry.activeTabId,
        openedBy: tab.openedBy,
        isNewTab: !tab.navigated && isBlank(url),
        crashed: tab.crashed,
        temporary: tab.temporary && !tab.kept,
        zoom,
      };
    });
  }

  /** A tab you (or the agent, on purpose) want kept past the end of the run. */
  keepTab(sessionId: string, tabId: string): boolean {
    const tab = this.entries.get(sessionId)?.tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    if (!tab.kept) {
      tab.kept = true;
      this.scheduleTabsChanged(sessionId);
    }
    return true;
  }

  /**
   * End of a run: close the agent's scratch tabs, like Codex does. Never the
   * tab on screen, never one you opened, never one that was kept.
   */
  closeTemporaryTabs(sessionId: string): number {
    const entry = this.entries.get(sessionId);
    if (!entry) return 0;
    const doomed = entry.tabs.filter((t) => t.temporary && !t.kept && t.id !== entry.activeTabId);
    for (const tab of doomed) this.closeTab(sessionId, tab.id);
    if (doomed.length) browserLogger.info('BrowserPool.tab.closedTemporary', { sessionId, count: doomed.length });
    return doomed.length;
  }

  // ---------------------------------------------------------------------------
  // Where views live: on your screen, or parked on the stage (workspace/stage.ts)
  // ---------------------------------------------------------------------------

  private screenAllowed(): boolean {
    return !this.uiHidden && !this.windowHidden;
  }

  /** Take a view out of whatever window holds it. */
  private unplace(tab: TabEntry): void {
    const parent = tab.parent;
    tab.parent = null;
    tab.place = 'none';
    if (tab.agentBusyTimer) { clearTimeout(tab.agentBusyTimer); tab.agentBusyTimer = null; }
    if (!parent || parent.isDestroyed()) return;
    try { parent.contentView.removeChildView(tab.view); } catch { /* destroyed */ }
  }

  /** On your screen, in `win`, on top of the other views. */
  private putOnScreen(tab: TabEntry, win: BrowserWindow, bounds: Rect | null): void {
    if (tab.parent !== win) {
      const busy = tab.agentBusyTimer;
      tab.agentBusyTimer = null; // keep the agent's wake timer across the move
      this.unplace(tab);
      tab.agentBusyTimer = busy;
    }
    if (bounds) tab.view.setBounds(bounds);
    try { tab.view.setBackgroundColor(getWindowBackgroundColor()); } catch { /* noop */ }
    win.contentView.addChildView(tab.view); // raises it if it's already there
    tab.view.setVisible?.(true);
    tab.parent = win;
    tab.place = 'screen';
  }

  /**
   * Off your screen. On the stage it keeps a surface — the agent can still
   * screenshot it — and sleeps hidden unless the agent is using it. Without a
   * stage (macOS, tests) it's in no window, as before.
   */
  private park(tab: TabEntry, bounds: Rect | null): void {
    const stage = this.stage();
    const size = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
    if (!stage) {
      if (tab.place !== 'none') {
        const busy = tab.agentBusyTimer;
        tab.agentBusyTimer = null;
        this.unplace(tab);
        tab.agentBusyTimer = busy;
      }
      if (size) tab.view.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
      return;
    }
    if (tab.parent !== stage) {
      const busy = tab.agentBusyTimer;
      tab.agentBusyTimer = null;
      this.unplace(tab);
      tab.agentBusyTimer = busy;
      stage.contentView.addChildView(tab.view);
      tab.parent = stage;
      tab.place = 'stage';
    }
    if (size) {
      fitStage(stage, size.width, size.height);
      // Laid out while shown, then hidden — a view hidden before it's ever
      // been laid out stays 0×0. The stage is off screen, so nothing flashes.
      tab.view.setVisible?.(true);
      tab.view.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    }
    tab.view.setVisible?.(tab.agentBusyTimer !== null);
  }

  /** Re-place every attached session's front tab after the screen state changed. */
  private refreshScreen(): void {
    for (const entry of this.entries.values()) {
      if (!entry.attached || !entry.window || entry.window.isDestroyed()) continue;
      const tab = entry.tabs.find((t) => t.id === entry.activeTabId);
      if (!tab) continue;
      if (this.screenAllowed()) {
        this.putOnScreen(tab, entry.window, entry.bounds);
        void this.wakeForVisibility(entry, 'reattach');
        this.applyFrameRate(entry);
      } else {
        this.park(tab, entry.bounds);
        try {
          entry.view.webContents.setFrameRate(entry.idleFreezeEligible ? IDLE_FRAME_RATE : THROTTLED_FRAME_RATE);
        } catch { /* destroyed */ }
      }
    }
  }

  /** DEX's window was hidden to the tray / minimized, or came back. */
  setWindowHidden(hidden: boolean): void {
    if (this.windowHidden === hidden) return;
    this.windowHidden = hidden;
    browserLogger.info('BrowserPool.windowHidden', { hidden });
    this.refreshScreen();
  }

  /**
   * The pane is laying out a session it shows: make sure its tab is really on
   * screen. (Recovers from a hub that hid the views and never asked for them back.)
   */
  ensureOnScreen(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry?.attached || !entry.window || entry.window.isDestroyed() || this.windowHidden) return;
    const tab = entry.tabs.find((t) => t.id === entry.activeTabId);
    if (!tab || tab.place === 'screen') return;
    this.uiHidden = false;
    this.putOnScreen(tab, entry.window, entry.bounds);
  }

  private findTab(wc: WebContents): TabEntry | null {
    for (const entry of this.entries.values()) {
      for (const tab of entry.tabs) if (tab.view.webContents === wc) return tab;
    }
    return null;
  }

  /**
   * The agent is using this tab (a CDP command through the broker). A tab off
   * your screen is shown on the stage while it's busy, so the page runs like
   * the tab in front; it sleeps again a few seconds after the last use.
   * True when it was just woken: wait for a frame before a screenshot.
   */
  noteAgentUse(wc: WebContents): boolean {
    const tab = this.findTab(wc);
    if (!tab) return false;
    if (tab.agentBusyTimer) clearTimeout(tab.agentBusyTimer);
    tab.agentBusyTimer = setTimeout(() => {
      tab.agentBusyTimer = null;
      if (tab.place === 'stage') {
        try { tab.view.setVisible(false); } catch { /* destroyed */ }
      }
    }, AGENT_BUSY_MS);
    if (tab.place !== 'stage' || tab.view.getVisible?.() !== false) return false;
    tab.view.setVisible(true);
    return true;
  }

  /** The task whose tab `wc` is, or null (DEX's own windows, a closed tab). */
  sessionIdOf(wc: WebContents): string | null {
    for (const entry of this.entries.values()) {
      if (entry.tabs.some((t) => t.view.webContents === wc)) return entry.sessionId;
    }
    return null;
  }

  getTabWebContents(sessionId: string, tabId: string): WebContents | null {
    const tab = this.entries.get(sessionId)?.tabs.find((t) => t.id === tabId);
    return tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  }

  /** Every tab's WebContents — what the task's agent may reach (cdpBroker). */
  getAllWebContents(sessionId: string): WebContents[] {
    const entry = this.entries.get(sessionId);
    if (!entry) return [];
    return entry.tabs.map((t) => t.view.webContents).filter((wc) => !wc.isDestroyed());
  }

  getWebContents(sessionId: string): WebContents | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    return entry.view.webContents;
  }

  getView(sessionId: string): WebContentsView | null {
    const entry = this.entries.get(sessionId);
    return entry?.view ?? null;
  }

  async markSessionActive(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.idleFreezeEligible = false;
    this.clearIdleFreezeTimer(entry);
    this.applyFrameRate(entry);
    await this.setLifecycleState(entry, 'active', 'session-active');
  }

  markSessionIdle(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.idleFreezeEligible = true;
    this.applyFrameRate(entry);
    this.scheduleIdleFreeze(entry, 'session-idle');
  }

  private clearIdleFreezeTimer(entry: PoolEntry): void {
    if (!entry.freezeTimer) return;
    clearTimeout(entry.freezeTimer);
    entry.freezeTimer = null;
  }

  private frameRateFor(entry: PoolEntry): number {
    if (entry.attached) return ACTIVE_FRAME_RATE;
    return entry.idleFreezeEligible ? IDLE_FRAME_RATE : THROTTLED_FRAME_RATE;
  }

  private applyFrameRate(entry: PoolEntry): void {
    try {
      entry.view.webContents.setFrameRate(this.frameRateFor(entry));
    } catch (err) {
      browserLogger.warn('BrowserPool.frameRate.error', {
        sessionId: entry.sessionId,
        error: (err as Error).message,
      });
    }
  }

  private scheduleIdleFreeze(entry: PoolEntry, reason: string): void {
    this.clearIdleFreezeTimer(entry);
    if (!entry.idleFreezeEligible || entry.attached || this.idleFreezeDelayMs <= 0) return;

    entry.freezeTimer = setTimeout(() => {
      entry.freezeTimer = null;
      const current = this.entries.get(entry.sessionId);
      if (current !== entry) return;
      void this.freezeIfStillIdle(entry, reason);
    }, this.idleFreezeDelayMs);
  }

  private async freezeIfStillIdle(entry: PoolEntry, reason: string): Promise<void> {
    if (!entry.idleFreezeEligible || entry.attached || entry.frozen) return;
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    if (wc.isCurrentlyAudible()) {
      browserLogger.info('BrowserPool.freeze.skippedAudible', { sessionId: entry.sessionId, reason });
      this.scheduleIdleFreeze(entry, 'audible-retry');
      return;
    }

    await this.setLifecycleState(entry, 'frozen', reason);
  }

  private async wakeForVisibility(entry: PoolEntry, reason: string): Promise<void> {
    this.clearIdleFreezeTimer(entry);
    await this.setLifecycleState(entry, 'active', reason);
  }

  private async setLifecycleState(entry: PoolEntry, state: 'active' | 'frozen', reason: string): Promise<void> {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    if (state === 'active' && !entry.frozen) return;
    if (state === 'frozen' && entry.frozen) return;

    // A lease, not attach/detach: the agent's broker may hold this debugger
    // for the whole task, and a detach here would cut it off (cdpLease.ts).
    let release: (() => void) | null = null;
    try {
      release = leaseDebugger(wc);
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state });
      entry.frozen = state === 'frozen';
      browserLogger.info('BrowserPool.lifecycleState', {
        sessionId: entry.sessionId,
        state,
        reason,
      });
    } catch (err) {
      browserLogger.debug('BrowserPool.lifecycleState.error', {
        sessionId: entry.sessionId,
        state,
        reason,
        error: (err as Error).message,
      });
    } finally {
      release?.();
    }
  }

  /**
   * Pages render at the pane's real size, like any browser. (DEX used to lay
   * every page out at 1440–1920×900 and zoom it down to fit: it cost
   * sharpness, not frames — see docs/unify/P0.md.)
   */
  setViewBoundsFitted(sessionId: string, bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (!(bounds.width > 0 && bounds.height > 0)) return entry.bounds;
    entry.bounds = { ...bounds };
    this.applyBounds(entry);
    return entry.bounds;
  }

  /** The front tab takes the pane's rect — where it's shown, or its size on the stage. */
  private applyBounds(entry: PoolEntry): void {
    const tab = entry.tabs.find((t) => t.id === entry.activeTabId);
    if (!tab || !entry.bounds) return;
    if (tab.place === 'screen') tab.view.setBounds(entry.bounds);
    else this.park(tab, entry.bounds);
  }

  attachToWindow(sessionId: string, window: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.warn('BrowserPool.attach.notFound', { sessionId });
      return false;
    }

    // Re-apply the resolved theme bg every attach. While detached, the view
    // isn't a child of any window's contentView, so it misses the
    // theme-broadcast loop in themeMode.applyBackgroundToAllWindows() and
    // would otherwise paint with whatever bg it had at create time.
    try { entry.view.setBackgroundColor(getWindowBackgroundColor()); } catch { /* noop */ }

    const validShape = Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
      && bounds.width > 0 && bounds.height > 0;

    if (entry.attached) {
      browserLogger.debug('BrowserPool.attach.alreadyAttached', { sessionId });
      // Guard against transient zero/non-finite bounds (e.g. a frame fired
      // mid-relayout when the pane has 0 width/height); ResizeObserver will
      // fire again with a valid rect.
      if (!validShape) {
        browserLogger.debug('BrowserPool.attach.skipInvalidBounds', { sessionId, bounds });
        return true;
      }
      entry.bounds = { ...bounds };
      entry.window = window;
      this.applyBounds(entry);
      return true;
    }

    if (validShape) entry.bounds = { ...bounds };
    entry.attached = true;
    entry.window = window;
    const front = entry.tabs.find((t) => t.id === entry.activeTabId);
    if (front) {
      if (this.screenAllowed()) this.putOnScreen(front, window, entry.bounds);
      else this.park(front, entry.bounds);
    }
    void this.wakeForVisibility(entry, 'attach');
    this.applyFrameRate(entry);

    browserLogger.info('BrowserPool.attach', {
      sessionId,
      tabId: entry.activeTabId,
      bounds: entry.bounds,
      frameRate: this.frameRateFor(entry),
    });

    return true;
  }

  detachFromWindow(sessionId: string, _window: BrowserWindow): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.warn('BrowserPool.detach.notFound', { sessionId });
      return false;
    }

    if (!entry.attached) {
      browserLogger.debug('BrowserPool.detach.notAttached', { sessionId });
      return false;
    }

    entry.attached = false;
    const front = entry.tabs.find((t) => t.id === entry.activeTabId);
    if (front) this.park(front, entry.bounds);

    this.applyFrameRate(entry);
    this.scheduleIdleFreeze(entry, 'detached');

    browserLogger.info('BrowserPool.detach', {
      sessionId,
      frameRate: this.frameRateFor(entry),
      idleFreezeEligible: entry.idleFreezeEligible,
    });

    return true;
  }

  detachAll(window: BrowserWindow): void {
    const ids = Array.from(this.entries.keys());
    for (const id of ids) {
      this.detachFromWindow(id, window);
    }
    browserLogger.info('BrowserPool.detachAll', { count: ids.length });
  }

  /** The hub wants the views out of the way for a moment (a menu over them). */
  temporarilyDetachAll(_window: BrowserWindow): void {
    this.uiHidden = true;
    this.refreshScreen();
    browserLogger.info('BrowserPool.temporarilyDetachAll');
  }

  reattachAll(_window: BrowserWindow): void {
    this.uiHidden = false;
    this.refreshScreen();
    browserLogger.info('BrowserPool.reattachAll');
  }

  async getTabs(sessionId: string): Promise<TabInfo[]> {
    const entry = this.entries.get(sessionId);
    if (!entry) return [];

    try {
      return entry.tabs.map((tab) => {
        const wc = tab.view.webContents;
        return {
          targetId: String(wc.id),
          url: wc.getURL() || 'about:blank',
          title: wc.getTitle() || 'New Tab',
          type: 'page' as const,
          active: tab.id === entry.activeTabId,
        };
      });
    } catch (err) {
      browserLogger.warn('BrowserPool.getTabs.error', {
        sessionId,
        error: (err as Error).message,
      });
      return [];
    }
  }

  destroy(sessionId: string, _window?: BrowserWindow): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.debug('BrowserPool.destroy.notFound', { sessionId });
      return;
    }

    for (const tab of entry.tabs) this.unplace(tab);

    const lifetimeMs = Date.now() - entry.createdAt;
    this.clearIdleFreezeTimer(entry);
    const pending = this.tabsChangedTimers.get(sessionId);
    if (pending) { clearTimeout(pending); this.tabsChangedTimers.delete(sessionId); }

    // Delete from map first so each wc.on('destroyed') listener is a clean
    // no-op (it still fires, but the entry is already gone).
    this.entries.delete(sessionId);

    let closed = 0;
    for (const tab of entry.tabs) {
      const wc = tab.view.webContents;
      try {
        if (!wc.isDestroyed()) {
          (wc as unknown as { close: (opts?: { waitForBeforeUnload?: boolean }) => void }).close();
          closed++;
        }
      } catch (err) {
        browserLogger.warn('BrowserPool.destroy.closeError', {
          sessionId,
          tabId: tab.id,
          error: (err as Error).message,
        });
      }
      // wc.close() doesn't always destroy embedded WebContents synchronously
      // (or at all, for views without an unload handler). Force teardown on
      // the next tick if it's still alive.
      setImmediate(() => {
        try {
          if (!wc.isDestroyed()) {
            (wc as unknown as { destroy?: () => void }).destroy?.();
          }
        } catch (err) {
          browserLogger.warn('BrowserPool.destroy.forceError', {
            sessionId,
            error: (err as Error).message,
          });
        }
      });
    }

    // Notify renderer synchronously so "Browser ended" paints immediately —
    // we don't want to wait for the wc.destroyed event, which may be delayed
    // or never fire if close() is a no-op.
    this.notifyGone(sessionId);

    browserLogger.info('BrowserPool.destroy', {
      sessionId,
      lifetimeMs,
      tabs: entry.tabs.length,
      remainingActive: this.entries.size,
      closed,
    });

    this.drainQueue();
  }

  destroyAll(window?: BrowserWindow): void {
    const sessionIds = Array.from(this.entries.keys());
    browserLogger.info('BrowserPool.destroyAll', { count: sessionIds.length });

    for (const sessionId of sessionIds) {
      this.destroy(sessionId, window);
    }

    this.queue.length = 0;
  }

  isAttached(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    return entry?.attached ?? false;
  }

  getStats(): {
    active: number;
    queued: number;
    maxConcurrent: number;
    sessions: Array<{ sessionId: string; attached: boolean; createdAt: number; pid: number }>;
  } {
    const sessions = Array.from(this.entries.values()).map((e) => ({
      sessionId: e.sessionId,
      attached: e.attached,
      createdAt: e.createdAt,
      pid: e.view.webContents.getOSProcessId(),
    }));

    return {
      active: this.entries.size,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      sessions,
    };
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.canCreate()) {
      const nextSessionId = this.queue.shift()!;
      browserLogger.info('BrowserPool.drainQueue', {
        sessionId: nextSessionId,
        remainingQueued: this.queue.length,
      });
      // The session manager will need to call create() again for this session.
      // We emit the session ID so the caller knows to retry.
      // For now, just log — the session manager polls canCreate().
    }
  }
}
