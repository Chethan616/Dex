/**
 * chrome.tabs and chrome.windows for extensions, on top of BrowserPool.
 *
 * The model, chosen so extensions behave as they would in Chrome:
 * - **Each DEX task is a window.** Its tabs are that window's tabs; the task
 *   on screen in DEX is the focused (and "current") window.
 * - **A tab's id is its WebContents id.** That's the id Electron's own
 *   extension APIs already use (tabs.sendMessage, scripting.executeScript,
 *   a content script's `sender.tab.id`), so what the shim reports and what
 *   Electron does always agree.
 * - **What a tab shows depends on the extension**, as in Chrome: its URL,
 *   title and icon only with the "tabs" permission, a matching host
 *   permission, or activeTab on that tab.
 *
 * Tab events come from diffing what BrowserPool reports after each change
 * (`TabEventTracker`), so every way a tab changes — you, the agent, a page —
 * reaches extensions the same way.
 */
import { ApiError, type CallContext, type Handler, type PoolTab, type PoolWindow, type TabsBackend } from './types';
import { matchesAny } from './matchPattern';

export interface ExtensionAccess {
  /** May this extension see `url` in tab `tabId`? */
  canSee(extensionId: string, url: string, tabId: number): boolean;
  hasPermission(extensionId: string, permission: string): boolean;
  /** captureVisibleTab: `<all_urls>`, or activeTab on this tab. */
  canCapture(extensionId: string, url: string, tabId: number): boolean;
  /** The task a popup (or side panel) of this extension was opened over. */
  popupSessionOf(contents: unknown): string | null;
}

export interface ChromeTab {
  id: number;
  index: number;
  windowId: number;
  active: boolean;
  highlighted: boolean;
  selected: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  autoDiscardable: boolean;
  frozen: boolean;
  incognito: boolean;
  groupId: number;
  splitViewId: number;
  mutedInfo: { muted: boolean; reason?: string };
  status: 'loading' | 'complete' | 'unloaded';
  lastAccessed: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
}

export interface ChromeWindow {
  id: number;
  focused: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
  incognito: boolean;
  type: 'normal';
  state: 'normal';
  alwaysOnTop: boolean;
  tabs?: ChromeTab[];
}

/** Stable integer window ids for tasks, for as long as DEX runs. */
export class WindowIds {
  private ids = new Map<string, number>();
  private sessions = new Map<number, string>();
  private next = 1;

  of(sessionId: string): number {
    let id = this.ids.get(sessionId);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(sessionId, id);
      this.sessions.set(id, sessionId);
    }
    return id;
  }

  sessionOf(windowId: number): string | null {
    return this.sessions.get(windowId) ?? null;
  }
}

function safe<T>(f: () => T, fallback: T): T {
  try { return f(); } catch { return fallback; }
}

function urlOf(tab: PoolTab): string {
  if (tab.pending) return tab.pending.url;
  return safe(() => tab.wc.getURL(), '');
}

function titleOf(tab: PoolTab): string {
  if (tab.pending) return tab.pending.title;
  return safe(() => tab.wc.getTitle(), '');
}

/** One tab, as extension `extId` may see it. */
export function chromeTab(extId: string, win: PoolWindow, tab: PoolTab, index: number, windowId: number, access: ExtensionAccess): ChromeTab {
  const id = tab.wc.id;
  const url = urlOf(tab);
  const visible = access.canSee(extId, url, id);
  const out: ChromeTab = {
    id,
    index,
    windowId,
    active: tab.active,
    highlighted: tab.active,
    selected: tab.active,
    pinned: false,
    audible: safe(() => tab.wc.isCurrentlyAudible(), false),
    discarded: Boolean(tab.pending),
    autoDiscardable: true,
    frozen: false,
    incognito: false,
    groupId: -1,
    splitViewId: -1,
    mutedInfo: { muted: safe(() => tab.wc.isAudioMuted(), false), reason: 'user' },
    status: tab.pending ? 'unloaded' : tab.loading ? 'loading' : 'complete',
    lastAccessed: Date.now(),
  };
  if (visible) {
    out.url = url || 'about:blank';
    out.title = titleOf(tab) || out.url;
    if (tab.faviconUrl) out.favIconUrl = tab.faviconUrl;
  }
  void win;
  return out;
}

/** "abc*" style title patterns from tabs.query. */
function titleMatches(pattern: string, title: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(title);
}

const CURRENT = -2;

export class TabsApi {
  readonly windowIds = new WindowIds();

  constructor(private readonly backend: TabsBackend, private readonly access: ExtensionAccess) {}

  /** Every tab with where it lives. */
  private all(): Array<{ win: PoolWindow; tab: PoolTab; index: number; windowId: number }> {
    const out: Array<{ win: PoolWindow; tab: PoolTab; index: number; windowId: number }> = [];
    for (const win of this.backend.windows()) {
      const windowId = this.windowIds.of(win.sessionId);
      win.tabs.forEach((tab, index) => out.push({ win, tab, index, windowId }));
    }
    return out;
  }

  find(tabId: number): { win: PoolWindow; tab: PoolTab; index: number; windowId: number } | null {
    return this.all().find((t) => t.tab.wc.id === tabId) ?? null;
  }

  /** The window a caller means by "current": its own tab's, its popup's, or the one on screen. */
  currentSession(ctx: CallContext): string | null {
    if (ctx.contents) {
      const popup = this.access.popupSessionOf(ctx.contents);
      if (popup) return popup;
      const own = this.all().find((t) => t.tab.wc === ctx.contents);
      if (own) return own.win.sessionId;
    }
    return this.backend.shownSessionId() ?? this.backend.windows()[0]?.sessionId ?? null;
  }

  private resolveWindow(ctx: CallContext, windowId: number | undefined): string | null {
    if (windowId === undefined || windowId === CURRENT) return this.currentSession(ctx);
    return this.windowIds.sessionOf(windowId);
  }

  tabFor(extId: string, tabId: number): ChromeTab | null {
    const t = this.find(tabId);
    return t ? chromeTab(extId, t.win, t.tab, t.index, t.windowId, this.access) : null;
  }

  windowFor(extId: string, sessionId: string, populate: boolean): ChromeWindow | null {
    const win = this.backend.windows().find((w) => w.sessionId === sessionId);
    if (!win) return null;
    const id = this.windowIds.of(sessionId);
    const out: ChromeWindow = {
      id,
      focused: this.backend.shownSessionId() === sessionId && this.backend.hubFocused(),
      top: 0, left: 0, width: 1280, height: 800,
      incognito: false, type: 'normal', state: 'normal', alwaysOnTop: false,
    };
    if (populate) out.tabs = win.tabs.map((tab, index) => chromeTab(extId, win, tab, index, id, this.access));
    return out;
  }

  query(ctx: CallContext, q: Record<string, unknown>): ChromeTab[] {
    const ext = ctx.extensionId;
    const current = this.currentSession(ctx);
    const shown = this.backend.shownSessionId() ?? current;
    const urls = q.url === undefined ? null : (Array.isArray(q.url) ? q.url : [q.url]).filter((u): u is string => typeof u === 'string');
    return this.all()
      .filter(({ win, tab, index, windowId }) => {
        if (q.active !== undefined && tab.active !== q.active) return false;
        if (q.highlighted !== undefined && tab.active !== q.highlighted) return false;
        if (q.currentWindow === true && win.sessionId !== current) return false;
        if (q.currentWindow === false && win.sessionId === current) return false;
        if (q.lastFocusedWindow === true && win.sessionId !== shown) return false;
        if (q.lastFocusedWindow === false && win.sessionId === shown) return false;
        if (typeof q.windowId === 'number') {
          const want = q.windowId === CURRENT ? (current ? this.windowIds.of(current) : -1) : q.windowId;
          if (windowId !== want) return false;
        }
        if (typeof q.index === 'number' && index !== q.index) return false;
        if (q.pinned === true) return false;
        if (q.discarded !== undefined && Boolean(tab.pending) !== q.discarded) return false;
        if (q.audible !== undefined && safe(() => tab.wc.isCurrentlyAudible(), false) !== q.audible) return false;
        if (q.muted !== undefined && safe(() => tab.wc.isAudioMuted(), false) !== q.muted) return false;
        if (typeof q.status === 'string') {
          const status = tab.pending ? 'unloaded' : tab.loading ? 'loading' : 'complete';
          if (status !== q.status) return false;
        }
        if (typeof q.groupId === 'number' && q.groupId !== -1) return false;
        if (typeof q.windowType === 'string' && q.windowType !== 'normal') return false;
        const url = urlOf(tab);
        if (urls || typeof q.title === 'string') {
          if (!this.access.canSee(ext, url, tab.wc.id)) return false;
          if (urls && !matchesAny(urls, url)) return false;
          if (typeof q.title === 'string' && !titleMatches(q.title, titleOf(tab))) return false;
        }
        return true;
      })
      .map(({ win, tab, index, windowId }) => chromeTab(ext, win, tab, index, windowId, this.access));
  }

  /** Where an extension may send a tab. */
  checkUrl(ctx: CallContext, raw: unknown): string {
    if (typeof raw !== 'string' || !raw) throw new ApiError('A URL is required');
    let url: URL;
    try {
      url = new URL(raw, `chrome-extension://${ctx.extensionId}/`);
    } catch {
      throw new ApiError(`Invalid url: "${raw}"`);
    }
    const ok = url.protocol === 'http:' || url.protocol === 'https:' || url.href === 'about:blank'
      || (url.protocol === 'chrome-extension:');
    if (!ok) throw new ApiError(`DEX doesn't let extensions open ${url.protocol} pages`);
    return url.href;
  }

  handlers(): Record<string, Handler> {
    const need = (ctx: CallContext, tabId: unknown) => {
      if (typeof tabId !== 'number') throw new ApiError('A tab id is required');
      const t = this.find(tabId);
      if (!t) throw new ApiError(`No tab with id: ${tabId}.`);
      return t;
    };
    const tabOrActive = (ctx: CallContext, tabId: unknown) => {
      if (typeof tabId === 'number') return need(ctx, tabId);
      const session = this.currentSession(ctx);
      const t = this.all().find((x) => x.win.sessionId === session && x.tab.active);
      if (!t) throw new ApiError('No active tab');
      return t;
    };
    return {
      'tabs.query': (ctx, [q]) => this.query(ctx, (q && typeof q === 'object' ? q : {}) as Record<string, unknown>),
      'tabs.get': (ctx, [tabId]) => {
        const t = need(ctx, tabId);
        return chromeTab(ctx.extensionId, t.win, t.tab, t.index, t.windowId, this.access);
      },
      'tabs.getCurrent': (ctx) => {
        const own = ctx.contents ? this.all().find((t) => t.tab.wc === ctx.contents) : undefined;
        return own ? chromeTab(ctx.extensionId, own.win, own.tab, own.index, own.windowId, this.access) : undefined;
      },
      'tabs.getCurrentActive': (ctx, [windowId]) => {
        const session = this.resolveWindow(ctx, typeof windowId === 'number' ? windowId : undefined);
        return this.query(ctx, { active: true }).find((t) => this.windowIds.sessionOf(t.windowId) === session);
      },
      'tabs.getAllInWindow': (ctx, [windowId]) => {
        const session = this.resolveWindow(ctx, typeof windowId === 'number' ? windowId : undefined);
        return session ? this.query(ctx, { windowId: this.windowIds.of(session) }) : [];
      },
      'tabs.create': (ctx, [props]) => {
        const p = (props ?? {}) as Record<string, unknown>;
        const session = this.resolveWindow(ctx, typeof p.windowId === 'number' ? p.windowId : undefined);
        if (!session) throw new ApiError("There's no DEX task open to put the tab in");
        const url = p.url === undefined ? 'about:blank' : this.checkUrl(ctx, p.url);
        const tab = this.backend.openTab(session, url, p.active !== false);
        if (!tab) throw new ApiError("DEX couldn't open the tab");
        return this.tabFor(ctx.extensionId, tab.wc.id);
      },
      'tabs.duplicate': (ctx, [tabId]) => {
        const t = need(ctx, tabId);
        const tab = this.backend.openTab(t.win.sessionId, urlOf(t.tab) || 'about:blank', true);
        return tab ? this.tabFor(ctx.extensionId, tab.wc.id) : undefined;
      },
      'tabs.update': (ctx, [tabId, props]) => {
        const t = tabOrActive(ctx, tabId);
        const p = (props ?? {}) as Record<string, unknown>;
        if (p.url !== undefined) this.backend.loadUrl(t.win.sessionId, t.tab.tabId, this.checkUrl(ctx, p.url));
        if (p.active === true || p.highlighted === true) this.backend.activateTab(t.win.sessionId, t.tab.tabId);
        if (typeof p.muted === 'boolean') safe(() => t.tab.wc.setAudioMuted(p.muted as boolean), undefined);
        return this.tabFor(ctx.extensionId, t.tab.wc.id);
      },
      'tabs.remove': (ctx, [ids]) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter((x): x is number => typeof x === 'number');
        for (const id of list) {
          const t = this.find(id);
          if (!t) throw new ApiError(`No tab with id: ${id}.`);
          this.backend.closeTab(t.win.sessionId, t.tab.tabId);
        }
      },
      'tabs.highlight': (ctx, [info]) => {
        const i = (info ?? {}) as { tabs?: number | number[]; windowId?: number };
        const session = this.resolveWindow(ctx, i.windowId);
        const index = Array.isArray(i.tabs) ? i.tabs[0] : i.tabs;
        const win = this.backend.windows().find((w) => w.sessionId === session);
        const tab = typeof index === 'number' ? win?.tabs[index] : undefined;
        if (!win || !tab) throw new ApiError('No tab at that index');
        this.backend.activateTab(win.sessionId, tab.tabId);
        return this.windowFor(ctx.extensionId, win.sessionId, true);
      },
      // DEX's tab strip keeps its own order; moving is accepted and reported as is.
      'tabs.move': (ctx, [ids]) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter((x): x is number => typeof x === 'number');
        const tabs = list.map((id) => this.tabFor(ctx.extensionId, id)).filter(Boolean);
        return Array.isArray(ids) ? tabs : tabs[0];
      },
      'tabs.goBack': (ctx, [tabId]) => { const t = tabOrActive(ctx, tabId); this.backend.goBack(t.win.sessionId, t.tab.tabId); },
      'tabs.goForward': (ctx, [tabId]) => { const t = tabOrActive(ctx, tabId); this.backend.goForward(t.win.sessionId, t.tab.tabId); },
      'tabs.discard': (ctx, [tabId]) => this.tabFor(ctx.extensionId, tabOrActive(ctx, tabId).tab.wc.id),
      'tabs.captureVisibleTab': async (ctx, [windowId, options]) => {
        const session = this.resolveWindow(ctx, typeof windowId === 'number' ? windowId : undefined);
        const t = this.all().find((x) => x.win.sessionId === session && x.tab.active);
        if (!t) throw new ApiError('No visible tab');
        if (!this.access.canCapture(ctx.extensionId, urlOf(t.tab), t.tab.wc.id)) {
          throw new ApiError("Either the '<all_urls>' or 'activeTab' permission is required.");
        }
        const o = (options ?? {}) as { format?: string; quality?: number };
        const image = await t.tab.wc.capturePage();
        if (o.format === 'jpeg') {
          const q = typeof o.quality === 'number' ? Math.max(0, Math.min(100, Math.round(o.quality))) : 92;
          return `data:image/jpeg;base64,${image.toJPEG(q).toString('base64')}`;
        }
        return image.toDataURL();
      },
      'tabs.detectLanguage': async (ctx, [tabId]) => {
        const t = tabOrActive(ctx, tabId);
        const lang = await t.tab.wc.executeJavaScript('document.documentElement.lang || navigator.language || ""', true).catch(() => '');
        return typeof lang === 'string' && lang ? lang.split('-')[0].toLowerCase() : 'und';
      },
      'tabs.group': () => { throw new ApiError("DEX doesn't have tab groups"); },
      'tabs.ungroup': () => { throw new ApiError("DEX doesn't have tab groups"); },

      'windows.get': (ctx, [windowId, info]) => {
        const session = this.resolveWindow(ctx, typeof windowId === 'number' ? windowId : undefined);
        const w = session ? this.windowFor(ctx.extensionId, session, Boolean((info as { populate?: boolean } | undefined)?.populate)) : null;
        if (!w) throw new ApiError(`No window with id: ${String(windowId)}.`);
        return w;
      },
      'windows.getCurrent': (ctx, [info]) => {
        const session = this.currentSession(ctx);
        const w = session ? this.windowFor(ctx.extensionId, session, Boolean((info as { populate?: boolean } | undefined)?.populate)) : null;
        if (!w) throw new ApiError('No current window');
        return w;
      },
      'windows.getLastFocused': (ctx, [info]) => {
        const session = this.backend.shownSessionId() ?? this.currentSession(ctx);
        const w = session ? this.windowFor(ctx.extensionId, session, Boolean((info as { populate?: boolean } | undefined)?.populate)) : null;
        if (!w) throw new ApiError('No window has focus');
        return w;
      },
      'windows.getAll': (ctx, [info]) => {
        const populate = Boolean((info as { populate?: boolean } | undefined)?.populate);
        return this.backend.windows().map((w) => this.windowFor(ctx.extensionId, w.sessionId, populate)).filter(Boolean);
      },
      // A new "window" is a tab in the task on screen: DEX doesn't open loose windows.
      'windows.create': (ctx, [data]) => {
        const d = (data ?? {}) as { url?: string | string[]; tabId?: number };
        const session = this.currentSession(ctx);
        if (!session) throw new ApiError("There's no DEX task open to put the window in");
        const urls = d.url === undefined ? [] : Array.isArray(d.url) ? d.url : [d.url];
        urls.forEach((u, i) => this.backend.openTab(session, this.checkUrl(ctx, u), i === 0));
        if (typeof d.tabId === 'number') {
          const t = this.find(d.tabId);
          if (t) this.backend.activateTab(t.win.sessionId, t.tab.tabId);
        }
        return this.windowFor(ctx.extensionId, session, true);
      },
      'windows.update': (ctx, [windowId, info]) => {
        const session = this.resolveWindow(ctx, typeof windowId === 'number' ? windowId : undefined);
        if (!session) throw new ApiError(`No window with id: ${String(windowId)}.`);
        if ((info as { focused?: boolean } | undefined)?.focused) this.backend.showSession(session);
        return this.windowFor(ctx.extensionId, session, false);
      },
      'windows.remove': () => { throw new ApiError("An extension can't close a DEX task"); },
    };
  }
}

/** What changed between two looks at the tabs, as Chrome's events. */
export type TabEvent =
  | { type: 'created'; tabId: number }
  | { type: 'removed'; tabId: number; windowId: number; isWindowClosing: boolean }
  | { type: 'activated'; tabId: number; windowId: number }
  | { type: 'updated'; tabId: number; changeInfo: Record<string, unknown> }
  | { type: 'windowCreated'; windowId: number }
  | { type: 'windowRemoved'; windowId: number }
  | { type: 'focusChanged'; windowId: number };

interface Seen { windowId: number; url: string; title: string; status: string; favIconUrl: string | null; audible: boolean; muted: boolean; active: boolean }

export class TabEventTracker {
  private tabs = new Map<number, Seen>();
  private windows = new Set<number>();
  private focused = -1;

  constructor(private readonly ids: WindowIds) {}

  /** Compare with the last look; the events to send, in Chrome's order. */
  diff(windows: PoolWindow[], focusedSession: string | null): TabEvent[] {
    const events: TabEvent[] = [];
    const now = new Map<number, Seen>();
    const winNow = new Set<number>();
    for (const win of windows) {
      const windowId = this.ids.of(win.sessionId);
      winNow.add(windowId);
      if (!this.windows.has(windowId)) events.push({ type: 'windowCreated', windowId });
      for (const tab of win.tabs) {
        const id = tab.wc.id;
        const seen: Seen = {
          windowId,
          url: urlOf(tab),
          title: titleOf(tab),
          status: tab.pending ? 'unloaded' : tab.loading ? 'loading' : 'complete',
          favIconUrl: tab.faviconUrl,
          audible: safe(() => tab.wc.isCurrentlyAudible(), false),
          muted: safe(() => tab.wc.isAudioMuted(), false),
          active: tab.active,
        };
        now.set(id, seen);
        const before = this.tabs.get(id);
        if (!before) {
          events.push({ type: 'created', tabId: id });
          if (seen.active) events.push({ type: 'activated', tabId: id, windowId });
          continue;
        }
        // A navigation that finished between two looks still reads loading → complete.
        if (before.url !== seen.url) {
          events.push({ type: 'updated', tabId: id, changeInfo: { status: 'loading', url: seen.url } });
          if (seen.status === 'complete') events.push({ type: 'updated', tabId: id, changeInfo: { status: 'complete' } });
        } else if (before.status !== seen.status) {
          events.push({ type: 'updated', tabId: id, changeInfo: { status: seen.status } });
        }
        if (before.title !== seen.title && seen.title) events.push({ type: 'updated', tabId: id, changeInfo: { title: seen.title } });
        if (before.favIconUrl !== seen.favIconUrl && seen.favIconUrl) events.push({ type: 'updated', tabId: id, changeInfo: { favIconUrl: seen.favIconUrl } });
        if (before.audible !== seen.audible) events.push({ type: 'updated', tabId: id, changeInfo: { audible: seen.audible } });
        if (before.muted !== seen.muted) events.push({ type: 'updated', tabId: id, changeInfo: { mutedInfo: { muted: seen.muted, reason: 'user' } } });
        if (!before.active && seen.active) events.push({ type: 'activated', tabId: id, windowId });
      }
    }
    for (const [id, before] of this.tabs) {
      if (!now.has(id)) events.push({ type: 'removed', tabId: id, windowId: before.windowId, isWindowClosing: !winNow.has(before.windowId) });
    }
    for (const windowId of this.windows) {
      if (!winNow.has(windowId)) events.push({ type: 'windowRemoved', windowId });
    }
    const focused = focusedSession ? this.ids.of(focusedSession) : -1;
    if (focused !== this.focused && (focused === -1 || winNow.has(focused))) {
      events.push({ type: 'focusChanged', windowId: focused });
      this.focused = focused;
    }
    this.tabs = now;
    this.windows = winNow;
    return events;
  }
}
