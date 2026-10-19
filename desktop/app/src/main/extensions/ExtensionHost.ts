/**
 * Where extensions meet DEX (docs/unify/PLAN.md §3.8, §4.4).
 *
 * - Registers the two preloads on the web profile: extensionWorker.js for
 *   service workers and webFrame.js for frames. Both carry the shim
 *   (preload/extensionShim.ts) that gives extensions what Electron lacks.
 * - Answers the shim's calls. Who's calling is never taken from the call:
 *   a worker's extension comes from its scope, a page's from its frame's
 *   own address, and anything outside the web profile is refused.
 * - Delivers events. A worker that's asleep but listened to an event before
 *   is woken for it, as Chrome does, and gets it once its listeners are back.
 * - Draws popups (and side panels) as a small native view under the toolbar
 *   button, above the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  BrowserWindow, ipcMain, nativeImage, Notification, powerMonitor, powerSaveBlocker, webFrameMain, WebContentsView,
  type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents, type WebFrameMain,
} from 'electron';
import { ActionStore, type ActionState } from './actionApi';
import { cookiesHandlers, chromeCookie, cookieUrl } from './cookiesApi';
import type { ExtensionManager, ExtensionSummary } from './ExtensionManager';
import { actionOf, extensionFile, localize, permissionWarnings, pickIcon, type Manifest } from './manifest';
import { MenuStore, type MenuEntry, type MenuTarget } from './menusApi';
import { extensionInfo, Permissions, type ExtensionGrants } from './permissionsApi';
import { Platform, unsupportedHandler } from './platformApi';
import { ProxyControl } from './proxyApi';
import { TabEventTracker, TabsApi, type TabEvent } from './tabsApi';
import { ApiError, type CallContext, type Handler, type TabsBackend } from './types';
import { navigationFilterMatches, watchNavigation, webNavigationHandlers, type NavEvent } from './webNavigationApi';
import { createStoreApi, storeCaller } from './webStore';
import { matchesAny } from './matchPattern';
import { DnrEngine } from './dnr/engine';
import { WebRequestHub } from './webRequestHub';
import { SyncStorage } from './syncStorage';

export interface HostDeps {
  session: Electron.Session;
  manager: ExtensionManager;
  tabs: TabsBackend;
  hubWindow(): BrowserWindow | null;
  /** Where the built preloads live (main's own folder). */
  preloadDir: string;
  /** A yes/no question over DEX's window. */
  ask(message: string, detail: string, ok: string, icon?: Electron.NativeImage): Promise<boolean>;
  /** Tell the hub its toolbar or the Extensions page should refresh. */
  changed(): void;
  log(event: string, data: Record<string, unknown>): void;
  userDataPath: string;
}

interface Worker { versionId: number; sw: Electron.ServiceWorkerMain; ready: boolean; queue: Array<() => void> }

interface Listening {
  extensionId: string;
  kind: 'worker' | 'page';
  /** A page's frame, to send its events to. */
  frame?: WebFrameMain;
  contents?: WebContents;
  /** event → listener id → filter (filtered events), or `true` for plain ones. */
  events: Map<string, Map<number, unknown> | true>;
}

interface Popup { view: WebContentsView; extensionId: string; sessionId: string; kind: 'popup' | 'side_panel'; anchor: Anchor }

export interface Anchor { x: number; y: number; width: number; height: number }

/** One toolbar button, as the workspace draws it. */
export interface ToolbarItem {
  id: string;
  name: string;
  pinned: boolean;
  title: string;
  icon: string | null;
  badgeText: string;
  badgeBackgroundColor: string;
  badgeTextColor: string;
  enabled: boolean;
  hasPopup: boolean;
}

const POPUP_MIN = 25;
const POPUP_MAX = { width: 800, height: 600 };
const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})\//;

/** Events that wake a sleeping worker. Page loads would wake every extension
 *  for every request, so webRequest only reaches running workers. */
const NO_WAKE = /^webRequest\./;

function extensionOf(url: string | undefined | null): string | null {
  return url ? EXTENSION_ORIGIN.exec(url)?.[1] ?? null : null;
}

/** One extension as the agent sees it (`dex-ext list`). */
export interface AgentExtension {
  id: string;
  name: string;
  description: string;
  /** Kept in the user's hands: the agent can't use it. */
  offLimits: 'password manager' | 'wallet' | null;
  button: { title: string; badge?: string; enabled: boolean; opens: 'popup' | 'side panel' | 'acts on the page' };
  /** Where its scripts run: "every site", or the sites it names. */
  runsOn: string[];
  options: string | null;
  /** Its right-click items on the task's page ("Save to Zotero › Save page"). */
  menu: string[];
}

/** Menu entries as paths ("Parent › Child"), leaves only. */
function flatMenu(entries: MenuEntry[], prefix = ''): Array<{ path: string; entry: MenuEntry }> {
  const out: Array<{ path: string; entry: MenuEntry }> = [];
  for (const e of entries) {
    if (e.type === 'separator') continue;
    const here = prefix ? `${prefix} › ${e.label}` : e.label;
    if (e.children.length) out.push(...flatMenu(e.children, here));
    else if (e.id) out.push({ path: here, entry: e });
  }
  return out;
}

export class ExtensionHost {
  readonly menus = new MenuStore();
  readonly tabsApi: TabsApi;
  private readonly tracker: TabEventTracker;
  private readonly permissions: Permissions;
  private readonly actions: ActionStore;
  private readonly proxy: ProxyControl;
  private readonly platform: Platform;
  readonly dnr: DnrEngine;
  readonly webRequest: WebRequestHub;
  private readonly sync: SyncStorage;
  private readonly handlers = new Map<string, Handler>();
  private readonly workers = new Map<string, Worker>();
  private readonly workerInterest = new Map<string, Set<string>>();
  private readonly listening = new Map<string, Listening>();
  private readonly pendingWake = new Map<string, Array<() => void>>();
  private readonly activeTab = new Map<string, Set<number>>();
  private readonly watched = new WeakSet<WebContents>();
  private readonly iconCache = new Map<string, string | null>();
  private readonly offscreenDocs = new Map<string, BrowserWindow>();
  private readonly keepAwake = new Map<string, number>();
  private readonly grantsCache = new Map<string, ExtensionGrants>();
  private popup: Popup | null = null;
  private trackTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private changedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: HostDeps) {
    this.permissions = new Permissions((id) => this.grants(id));
    const access = {
      canSee: (ext: string, url: string, tabId: number) =>
        this.permissions.has(ext, 'tabs') || this.permissions.canReach(ext, url) || this.activeTab.get(ext)?.has(tabId) === true,
      hasPermission: (ext: string, perm: string) => this.permissions.has(ext, perm),
      canCapture: (ext: string, _url: string, tabId: number) =>
        this.permissions.hosts(ext).some((h) => h === '<all_urls>' || h === '*://*/*') || this.activeTab.get(ext)?.has(tabId) === true,
      popupSessionOf: (contents: unknown) => (this.popup && this.popup.view.webContents === contents ? this.popup.sessionId : null),
    };
    this.tabsApi = new TabsApi(deps.tabs, access);
    this.tracker = new TabEventTracker(this.tabsApi.windowIds);
    this.actions = new ActionStore({
      fromFile: (ext, rel) => this.iconFromFile(ext, rel, 32),
      fromPixels: (w, h, rgba) => this.iconFromPixels(w, h, rgba),
    }, (ext) => this.actionDefaults(ext));
    this.actions.onChanged(() => this.scheduleChanged());
    this.proxy = new ProxyControl({
      file: path.join(deps.userDataPath, 'extensions', 'proxy.json'),
      apply: async (config) => {
        await deps.session.setProxy(config);
        await deps.session.closeAllConnections().catch(() => undefined);
      },
      changed: () => this.broadcast('proxy.settings.onChange', (ext) => (this.permissions.has(ext, 'proxy') ? [this.proxy.stateFor(ext)] : null)),
      log: deps.log,
    });
    this.platform = new Platform({
      manifest: (ext) => this.grants(ext)?.manifest ?? null,
      name: (ext) => this.nameOf(ext),
      hasPermission: (ext, perm) => this.permissions.has(ext, perm),
      notify: (ext, opts, on) => this.notify(ext, opts, on),
      idleState: (s) => { try { return powerMonitor.getSystemIdleState(s); } catch { return 'unknown'; } },
      keepAwake: (ext, level) => this.setKeepAwake(ext, level),
      openTab: (ctx, url) => this.openInTab(ctx, url),
      authFlow: (ext, url, interactive) => this.authFlow(ext, url, interactive),
      offscreen: {
        create: (ext, url) => this.createOffscreen(ext, url),
        has: (ext) => this.offscreenDocs.has(ext),
        close: (ext) => this.closeOffscreen(ext),
      },
      showPanel: (ctx, page, kind) => this.showPanel(ctx.extensionId, this.tabsApi.currentSession(ctx), page, kind, null),
      contexts: (ext) => this.contexts(ext),
      setUninstallUrl: (ext, url) => deps.manager.setUninstallUrl(ext, url),
      emit: (ext, event, args) => this.emit(ext, event, args),
    });
    this.dnr = new DnrEngine({
      dir: path.join(deps.userDataPath, 'extensions', 'dnr'),
      extensionDir: (ext) => this.dirOf(ext),
      manifest: (ext) => (this.grants(ext)?.manifest as Record<string, unknown> | undefined) ?? null,
      installOrder: () => this.deps.manager.list()
        .map((x) => ({ id: x.id, at: this.deps.manager.get(x.id)?.installedAt ?? '' }))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .map((x) => x.id),
      hasHostAccess: (ext, url) => this.permissions.canReach(ext, url),
      hasPermission: (ext, perm) => this.permissions.has(ext, perm),
      setBadge: (ext, tabId, text) => this.actions.setTabBadge(ext, tabId, text),
      log: deps.log,
    });
    this.webRequest = new WebRequestHub({
      session: deps.session,
      dnr: this.dnr,
      tabOf: (wcId) => {
        if (wcId === undefined) return null;
        const t = this.tabsApi.find(wcId);
        return t ? { tabId: wcId, windowId: t.windowId } : null;
      },
      listeners: (event) => {
        const out: Array<{ context: string; extensionId: string; filters: Array<{ id: number; filter: unknown; extra: unknown }> }> = [];
        for (const [key, l] of this.listening) {
          const entry = l.events.get(event);
          if (!(entry instanceof Map)) continue;
          if (l.kind === 'worker' && !this.workers.get(l.extensionId)?.ready) continue;
          out.push({ context: key, extensionId: l.extensionId, filters: [...entry].map(([id, spec]) => ({ id, ...(spec as { filter?: unknown; extra?: unknown }) })).map((f) => ({ id: f.id, filter: f.filter, extra: f.extra })) });
        }
        return out;
      },
      canObserve: (ext, url, initiator) => this.permissions.has(ext, 'webRequest')
        && this.permissions.canReach(ext, url)
        && (!initiator || initiator.startsWith('chrome-extension://') || this.permissions.canReach(ext, `${initiator}/`)),
      deliver: (context, event, details, ids, reply) => this.deliverTo(context, event, [details], ids, reply),
      log: deps.log,
    });
    this.dnr.onChanged(() => this.webRequest.refresh());
    this.sync = new SyncStorage(path.join(deps.userDataPath, 'extensions', 'sync'), (ext, changes) => {
      this.emit(ext, 'storage.sync.onChanged', [changes], { wake: true });
      this.emit(ext, 'storage.onChanged.sync', [changes, 'sync'], { wake: true });
    });
    this.registerHandlers();
  }

  /** Send to one worker or page, to the listener ids given (webRequest). */
  private deliverTo(context: string, event: string, args: unknown[], ids: number[], reply: boolean): Promise<unknown[]> {
    const l = this.listening.get(context);
    if (!l) return Promise.resolve([]);
    const token = reply ? crypto.randomUUID() : null;
    const answer = token
      ? new Promise<unknown>((resolve) => {
        this.replies.set(token, resolve);
        setTimeout(() => { if (this.replies.delete(token)) resolve(null); }, 30_000);
      })
      : null;
    try {
      if (l.kind === 'worker') this.workers.get(l.extensionId)?.sw.send('dex-ext:event', event, args, ids, token);
      else if (l.frame && !l.frame.isDestroyed()) l.frame.send('dex-ext:event', event, args, ids, token);
    } catch { /* gone */ }
    return answer ? answer.then((a) => [a]) : Promise.resolve([]);
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------

  /** Preloads, IPC and listeners. Call once, before extensions load. */
  install(): void {
    const ses = this.deps.session;
    ses.registerPreloadScript({ id: 'dex-extension-worker', type: 'service-worker', filePath: path.join(this.deps.preloadDir, 'extensionWorker.js') });
    ses.registerPreloadScript({ id: 'dex-web-frame', type: 'frame', filePath: path.join(this.deps.preloadDir, 'webFrame.js') });

    ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'starting' || runningStatus === 'running') this.attachWorker(versionId);
      else if (runningStatus === 'stopped') this.detachWorker(versionId);
    });

    ses.extensions.on('extension-loaded', (_e, ext) => {
      this.grantsCache.delete(ext.id);
      this.iconCache.clear();
      void this.proxy.restore(ext.id);
      try { this.dnr.load(ext.id); } catch (err) { this.deps.log('extensions.dnr.loadFailed', { id: ext.id, error: (err as Error).message }); }
      this.scheduleChanged();
    });
    ses.extensions.on('extension-unloaded', (_e, ext) => {
      this.grantsCache.delete(ext.id);
      this.forgetExtension(ext.id, false);
      this.dnr.unload(ext.id, false);
      this.scheduleChanged();
    });

    ses.cookies.on('changed', (_e, cookie, cause, removed) => {
      const url = cookieUrl(cookie);
      this.broadcast('cookies.onChanged', (ext) => (this.permissions.has(ext, 'cookies') && this.permissions.canReach(ext, url)
        ? [{ removed, cookie: chromeCookie(cookie), cause }]
        : null), { wake: true });
    });

    ipcMain.handle('dex-ext:call', (e, method: unknown, args: unknown) => {
      const ctx = this.pageContext(e);
      if (!ctx) throw new Error('Not an extension page');
      return this.call(ctx, method, args);
    });
    ipcMain.on('dex-ext:listen', (e, name: unknown, spec: unknown) => this.pageListen(e, name, spec, true));
    ipcMain.on('dex-ext:unlisten', (e, name: unknown, id: unknown) => this.pageListen(e, name, id, false));
    ipcMain.on('dex-ext:reply', (_e, token: unknown, value: unknown) => this.resolveReply(token, value));

    const storeApi = createStoreApi({
      manager: this.deps.manager,
      chromeVersion: process.versions.chrome,
      confirm: async ({ name, warnings }) => this.deps.ask(`Add “${name}”?`, warnings.length ? `It can:\n${warnings.map((w) => `• ${w}`).join('\n')}` : 'It needs no special permissions.', 'Add extension'),
      confirmRemove: (name) => this.deps.ask(`Remove “${name}”?`, 'Its settings and data in DEX are deleted too.', 'Remove'),
      log: this.deps.log,
    });
    ipcMain.handle('dex-cws:call', async (e, method: unknown, args: unknown) => {
      if (e.sender.session !== this.deps.session || !storeCaller(e.senderFrame?.origin)) return undefined;
      if (typeof method !== 'string' || !Array.isArray(args)) return undefined;
      const frame = e.senderFrame;
      return storeApi(method, args, (event, eventArgs) => {
        try { if (frame && !frame.isDestroyed()) frame.send('dex-cws:event', event, eventArgs); } catch { /* page gone */ }
      });
    });
    this.deps.manager.onChanged(() => {
      this.grantsCache.clear();
      this.scheduleChanged();
    });
  }

  // ---------------------------------------------------------------------------
  // Who is calling
  // ---------------------------------------------------------------------------

  private loaded(id: string | null): id is string {
    return Boolean(id && this.deps.session.extensions.getExtension(id));
  }

  private pageContext(e: IpcMainInvokeEvent | IpcMainEvent): CallContext | null {
    if (e.sender.session !== this.deps.session) return null;
    const frame = e.senderFrame;
    const id = extensionOf(frame?.url);
    if (!frame || !this.loaded(id)) return null;
    return { extensionId: id, kind: 'page', contents: e.sender, frame };
  }

  private attachWorker(versionId: number): void {
    const sw = this.deps.session.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!sw) return;
    const id = extensionOf(sw.scope);
    if (!this.loaded(id)) return;
    const existing = this.workers.get(id);
    if (existing && existing.versionId === versionId && existing.sw === sw) return;
    const worker: Worker = { versionId, sw, ready: false, queue: [] };
    this.workers.set(id, worker);
    // Fresh start: its listeners come back as its code runs.
    this.listening.delete(`worker:${id}`);
    const ctx: CallContext = { extensionId: id, kind: 'worker' };
    try { sw.ipc.removeHandler('dex-ext:call'); } catch { /* none yet */ }
    sw.ipc.handle('dex-ext:call', (_e, method: unknown, args: unknown) => {
      if (method === '__ready') { this.workerReady(id, worker); return undefined; }
      return this.call(ctx, method, args);
    });
    sw.ipc.removeAllListeners('dex-ext:listen');
    sw.ipc.removeAllListeners('dex-ext:unlisten');
    sw.ipc.removeAllListeners('dex-ext:reply');
    sw.ipc.on('dex-ext:listen', (_e, name: unknown, spec: unknown) => this.listen(`worker:${id}`, { extensionId: id, kind: 'worker' }, name, spec, true));
    sw.ipc.on('dex-ext:unlisten', (_e, name: unknown, listenerId: unknown) => this.listen(`worker:${id}`, { extensionId: id, kind: 'worker' }, name, listenerId, false));
    sw.ipc.on('dex-ext:reply', (_e, token: unknown, value: unknown) => this.resolveReply(token, value));
  }

  private detachWorker(versionId: number): void {
    for (const [id, w] of this.workers) {
      if (w.versionId !== versionId) continue;
      this.workers.delete(id);
      this.listening.delete(`worker:${id}`);
    }
    this.webRequest.refresh();
  }

  private workerReady(id: string, worker: Worker): void {
    worker.ready = true;
    const own = this.listening.get(`worker:${id}`);
    if (own) this.workerInterest.set(id, new Set(own.events.keys()));
    for (const send of worker.queue.splice(0)) send();
    for (const later of this.pendingWake.get(id)?.splice(0) ?? []) later();
    this.pendingWake.delete(id);
    this.webRequest.refresh();
  }

  private listen(key: string, who: Omit<Listening, 'events'>, name: unknown, spec: unknown, add: boolean): void {
    if (typeof name !== 'string' || name.length > 80) return;
    let l = this.listening.get(key);
    if (!l) {
      if (!add) return;
      l = { ...who, events: new Map() };
      this.listening.set(key, l);
    }
    if (add) {
      const s = spec as { id?: unknown; filter?: unknown } | null;
      if (s && typeof s.id === 'number') {
        const cur = l.events.get(name);
        const map = cur instanceof Map ? cur : new Map<number, unknown>();
        map.set(s.id, s.filter ?? null);
        l.events.set(name, map);
      } else {
        l.events.set(name, true);
      }
      if (who.kind === 'worker') {
        const set = this.workerInterest.get(who.extensionId) ?? new Set<string>();
        set.add(name);
        this.workerInterest.set(who.extensionId, set);
      }
    } else {
      const cur = l.events.get(name);
      if (cur instanceof Map && typeof spec === 'number') {
        cur.delete(spec);
        if (cur.size === 0) l.events.delete(name);
      } else {
        l.events.delete(name);
      }
    }
    this.ensureIdlePolling();
    if (name.startsWith('webRequest.')) this.webRequest.refresh();
  }

  private pageListen(e: IpcMainEvent, name: unknown, spec: unknown, add: boolean): void {
    const ctx = this.pageContext(e);
    if (!ctx?.frame) return;
    const key = `frame:${ctx.frame.processId}:${ctx.frame.routingId}`;
    if (!this.listening.has(key) && add) {
      e.sender.once('destroyed', () => { this.listening.delete(key); this.webRequest.refresh(); });
    }
    this.listen(key, { extensionId: ctx.extensionId, kind: 'page', frame: ctx.frame, contents: e.sender }, name, spec, add);
  }

  // ---------------------------------------------------------------------------
  // Calls
  // ---------------------------------------------------------------------------

  private async call(ctx: CallContext, method: unknown, args: unknown): Promise<unknown> {
    if (typeof method !== 'string' || method.length > 120) throw new Error('Bad call');
    const list = Array.isArray(args) ? args : [];
    if (method === '__ready') return undefined;
    if (method === '__closeWindow') { if (this.popup?.view.webContents === ctx.contents) this.closePopup(); return undefined; }
    const handler = this.handlers.get(method) ?? (method.startsWith('unsupported.') ? unsupportedHandler(method) : undefined);
    if (!handler) return { __dexError: `chrome.${method} isn't available in DEX's browser yet.` };
    try {
      return await handler(ctx, list);
    } catch (err) {
      if (!(err instanceof ApiError)) this.deps.log('extensions.api.error', { method, extensionId: ctx.extensionId, error: (err as Error).message });
      // An answer, not a thrown IPC error: the shim rejects with Chrome's message.
      return { __dexError: (err as Error).message };
    }
  }

  private registerHandlers(): void {
    const add = (h: Record<string, Handler>) => { for (const [k, v] of Object.entries(h)) this.handlers.set(k, v); };
    add(this.tabsApi.handlers());
    add(this.actions.handlers(async (ctx, windowId) => {
      const session = typeof windowId === 'number' ? this.tabsApi.windowIds.sessionOf(windowId) : this.tabsApi.currentSession(ctx);
      const tabId = this.activeTabIdOf(session);
      const popup = this.actions.stateFor(ctx.extensionId, tabId ?? undefined).popup;
      if (!popup) throw new ApiError('Extension does not have a popup on the active tab.');
      await this.showPanel(ctx.extensionId, session, popup, 'popup', null);
    }));
    add(this.menus.handlers());
    add(this.dnr.handlers());
    add(this.sync.handlers((ext) => this.deps.manager.get(ext)?.fileAccess === true));
    add(this.proxy.handlers());
    add(this.platform.handlers());
    add(webNavigationHandlers((tabId) => this.tabsApi.find(tabId)?.tab.wc ?? null));
    add(cookiesHandlers({
      jar: this.deps.session.cookies,
      canReach: (ext, url) => this.permissions.has(ext, 'cookies') && this.permissions.canReach(ext, url),
      allTabIds: () => this.deps.tabs.windows().flatMap((w) => w.tabs.map((t) => t.wc.id)),
    }));
    add(this.permissions.handlers({
      ask: (ext, name, warnings) => this.deps.ask(`“${name}” would like more access`, warnings.length ? `It asks to:\n${warnings.map((w) => `• ${w}`).join('\n')}` : 'It asks for extra permissions.', 'Allow'),
      grant: (ext, perms, origins) => { this.deps.manager.grant(ext, perms, origins); this.grantsCache.delete(ext); },
      revoke: (ext, perms, origins) => { this.deps.manager.revoke(ext, perms, origins); this.grantsCache.delete(ext); },
      warningsFor: (perms, origins) => permissionWarnings({ permissions: perms, host_permissions: origins, manifest_version: 3 }),
      emit: (ext, event, args) => this.emit(ext, event, args),
    }));
    add({
      'management.getAll': (ctx) => {
        const all = this.deps.manager.list();
        const visible = this.permissions.has(ctx.extensionId, 'management') ? all : all.filter((s) => s.id === ctx.extensionId);
        return visible.map((s) => this.managementInfo(s));
      },
      'management.get': (ctx, [id]) => {
        if (id !== ctx.extensionId && !this.permissions.has(ctx.extensionId, 'management')) throw new ApiError("The 'management' permission is required.");
        const s = this.deps.manager.summary(String(id));
        if (!s) throw new ApiError(`Failed to find extension with id ${String(id)}.`);
        return this.managementInfo(s);
      },
      'management.setEnabled': async (ctx, [id, enabled]) => {
        if (!this.permissions.has(ctx.extensionId, 'management')) throw new ApiError("The 'management' permission is required.");
        if (id === ctx.extensionId) throw new ApiError("An extension can't turn itself off.");
        const s = this.deps.manager.summary(String(id));
        if (!s) throw new ApiError(`Failed to find extension with id ${String(id)}.`);
        const ok = await this.deps.ask(`${enabled ? 'Turn on' : 'Turn off'} “${s.name}”?`, `“${this.nameOf(ctx.extensionId)}” is asking.`, enabled ? 'Turn on' : 'Turn off');
        if (ok) await this.deps.manager.setEnabled(String(id), Boolean(enabled));
      },
      'management.uninstallSelf': async (ctx) => {
        const name = this.nameOf(ctx.extensionId);
        if (await this.deps.ask(`Remove “${name}”?`, 'The extension asked to be removed.', 'Remove')) await this.uninstall(ctx.extensionId);
      },
      'webRequest.handlerBehaviorChanged': () => undefined,
      'downloads.setUiOptions': () => undefined,
    });
  }

  private managementInfo(s: ExtensionSummary): Record<string, unknown> {
    const g = this.grants(s.id);
    return extensionInfo(s.id, g ?? { manifest: { name: s.name }, name: s.name, granted: { permissions: [], origins: [] } }, s.enabled, s.optionsUrl, s.source);
  }

  // ---------------------------------------------------------------------------
  // What each extension is
  // ---------------------------------------------------------------------------

  private grants(id: string): ExtensionGrants | null {
    const cached = this.grantsCache.get(id);
    if (cached) return cached;
    const ext = this.deps.session.extensions.getExtension(id);
    if (!ext) return null;
    const manifest = ext.manifest as Manifest;
    const g: ExtensionGrants = {
      manifest,
      name: localize(manifest.name, ext.path, manifest) || ext.name || id,
      granted: this.deps.manager.granted(id),
    };
    this.grantsCache.set(id, g);
    return g;
  }

  nameOf(id: string): string {
    return this.grants(id)?.name ?? this.deps.manager.summary(id)?.name ?? id;
  }

  private dirOf(id: string): string | null {
    return this.deps.session.extensions.getExtension(id)?.path ?? this.deps.manager.get(id)?.path ?? null;
  }

  private iconFromFile(id: string, rel: string, size: number): string | null {
    const key = `${id}|${rel}|${size}`;
    if (this.iconCache.has(key)) return this.iconCache.get(key) ?? null;
    const dir = this.dirOf(id);
    const file = dir ? extensionFile(dir, rel) : null;
    let url: string | null = null;
    if (file && fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) url = img.resize({ width: size, height: size, quality: 'best' }).toDataURL();
    }
    this.iconCache.set(key, url);
    return url;
  }

  private iconFromPixels(width: number, height: number, rgba: Uint8Array): string | null {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 256 || height > 256) return null;
    if (rgba.length !== width * height * 4) return null;
    const bgra = Buffer.alloc(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      bgra[i] = rgba[i + 2]; bgra[i + 1] = rgba[i + 1]; bgra[i + 2] = rgba[i]; bgra[i + 3] = rgba[i + 3];
    }
    const img = nativeImage.createFromBitmap(bgra, { width, height });
    return img.isEmpty() ? null : img.toDataURL();
  }

  /** The extension's own icon, for menus and Settings. */
  iconOf(id: string, size = 32): string | null {
    const manifest = this.grants(id)?.manifest;
    if (manifest) {
      const rel = pickIcon(manifest.icons ?? actionOf(manifest).icon, size);
      return rel ? this.iconFromFile(id, rel, size) : null;
    }
    const s = this.deps.manager.summary(id);
    if (!s?.iconPath || !fs.existsSync(s.iconPath)) return null;
    const img = nativeImage.createFromPath(s.iconPath);
    return img.isEmpty() ? null : img.resize({ width: size, height: size, quality: 'best' }).toDataURL();
  }

  iconImage(id: string, size = 16): Electron.NativeImage | undefined {
    const url = this.iconOf(id, 32);
    if (!url) return undefined;
    return nativeImage.createFromDataURL(url).resize({ width: size, height: size, quality: 'best' });
  }

  private actionDefaults(id: string): ActionState {
    const manifest = this.grants(id)?.manifest;
    if (!manifest) return {};
    const a = actionOf(manifest);
    const rel = pickIcon(a.icon, 32);
    return {
      title: a.title ? localize(a.title, this.dirOf(id) ?? '', manifest) : this.nameOf(id),
      popup: a.popup,
      icon: rel ? this.iconFromFile(id, rel, 32) ?? undefined : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  private replies = new Map<string, (value: unknown) => void>();

  private resolveReply(token: unknown, value: unknown): void {
    if (typeof token !== 'string') return;
    const done = this.replies.get(token);
    if (!done) return;
    this.replies.delete(token);
    done(value);
  }

  /** Every extension that's loaded. */
  private loadedIds(): string[] {
    return this.deps.session.extensions.getAllExtensions().map((e) => e.id);
  }

  /** Send `event` to each extension `build` returns arguments for. */
  broadcast(event: string, build: (extensionId: string) => unknown[] | null, opts: { wake?: boolean; url?: string } = {}): void {
    for (const id of this.loadedIds()) {
      let args: unknown[] | null;
      try { args = build(id); } catch { args = null; }
      if (args) this.emit(id, event, args, opts);
    }
  }

  /**
   * Send `event` to one extension's listeners. `url` filters listeners that
   * registered with a URL filter (webNavigation). Answers come back when
   * `reply` is set (webRequest.onAuthRequired).
   */
  emit(extensionId: string, event: string, args: unknown[], opts: { wake?: boolean; url?: string; reply?: boolean; only?: 'worker' } = {}): Promise<unknown[]> {
    const answers: Array<Promise<unknown>> = [];
    let workerHeard = false;
    const worker = this.workers.get(extensionId);
    const workerWants = this.workerInterest.get(extensionId)?.has(event) === true;
    // A worker that's starting hasn't added its listeners back yet: hold the
    // event for it until it says it's ready.
    const holdForWorker = Boolean(worker && !worker.ready && workerWants);
    if (holdForWorker && worker) {
      worker.queue.push(() => { void this.emit(extensionId, event, args, { ...opts, wake: false, only: 'worker' }); });
    }
    const sendTo = (l: Listening, send: (ids: number[] | null, token: string | null) => void) => {
      const entry = l.events.get(event);
      if (!entry) return false;
      let ids: number[] | null = null;
      if (entry instanceof Map) {
        ids = [...entry.entries()].filter(([, filter]) => !opts.url || navigationFilterMatches(filter, opts.url)).map(([id]) => id);
        if (ids.length === 0) return false;
      }
      let token: string | null = null;
      if (opts.reply) {
        token = crypto.randomUUID();
        const t = token;
        answers.push(new Promise((resolve) => {
          this.replies.set(t, resolve);
          setTimeout(() => { if (this.replies.delete(t)) resolve(null); }, 30_000);
        }));
      }
      send(ids, token);
      return true;
    };

    for (const [key, l] of this.listening) {
      if (l.extensionId !== extensionId) continue;
      if (l.kind === 'worker') {
        if (!worker || !worker.ready) continue;
        workerHeard = sendTo(l, (ids, token) => {
          try { worker.sw.send('dex-ext:event', event, args, ids, token); } catch { /* stopped */ }
        }) || workerHeard;
      } else {
        if (opts.only === 'worker') continue;
        const frame = l.frame;
        if (!frame || frame.isDestroyed()) { this.listening.delete(key); continue; }
        sendTo(l, (ids, token) => { try { frame.send('dex-ext:event', event, args, ids, token); } catch { /* gone */ } });
      }
    }

    // A worker that heard this event before but is asleep: wake it, and send
    // once its listeners are registered again.
    if (!workerHeard && !worker && opts.wake !== false && !NO_WAKE.test(event) && workerWants) {
      const queue = this.pendingWake.get(extensionId) ?? [];
      if (queue.length < 200) {
        queue.push(() => { void this.emit(extensionId, event, args, { ...opts, wake: false, only: 'worker' }); });
        this.pendingWake.set(extensionId, queue);
      }
      if (queue.length === 1) {
        this.deps.session.serviceWorkers.startWorkerForScope(`chrome-extension://${extensionId}/`).catch((err: Error) => {
          this.pendingWake.delete(extensionId);
          this.deps.log('extensions.wake.failed', { extensionId, error: err.message });
        });
      }
    }
    return Promise.all(answers);
  }

  private listeningTo(event: string): string[] {
    const out = new Set<string>();
    for (const l of this.listening.values()) if (l.events.has(event)) out.add(l.extensionId);
    for (const [id, names] of this.workerInterest) if (names.has(event)) out.add(id);
    return [...out];
  }

  private ensureIdlePolling(): void {
    const wanted = this.listeningTo('idle.onStateChanged').length > 0;
    if (wanted && !this.idleTimer) {
      this.idleTimer = setInterval(() => this.platform.pollIdle(this.listeningTo('idle.onStateChanged')), 15_000);
      this.idleTimer.unref?.();
    } else if (!wanted && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  /** BrowserPool reported a change (or a task's browser went away). */
  tabsChanged(): void {
    if (this.trackTimer) return;
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null;
      this.flushTabEvents();
    }, 40);
  }

  private activeTabIdOf(sessionId: string | null): number | null {
    if (!sessionId) return null;
    const win = this.deps.tabs.windows().find((w) => w.sessionId === sessionId);
    return win?.tabs.find((t) => t.active)?.wc.id ?? null;
  }

  private flushTabEvents(): void {
    const windows = this.deps.tabs.windows();
    for (const w of windows) for (const t of w.tabs) this.watch(t.wc);
    const focused = this.deps.tabs.hubFocused() ? this.deps.tabs.shownSessionId() : null;
    const events = this.tracker.diff(windows, focused);
    if (events.length === 0) return;
    if (events.some((e) => e.type === 'activated')) this.scheduleChanged();
    if (this.loadedIds().length === 0) return;
    for (const e of events) this.sendTabEvent(e);
  }

  private sendTabEvent(e: TabEvent): void {
    const tab = (ext: string) => ('tabId' in e ? this.tabsApi.tabFor(ext, e.tabId) : null);
    switch (e.type) {
      case 'created':
        this.broadcast('tabs.onCreated', (ext) => { const t = tab(ext); return t ? [t] : null; }, { wake: true });
        break;
      case 'removed':
        this.actions.forgetTab(e.tabId);
        this.dnr.forgetTab(e.tabId);
        for (const set of this.activeTab.values()) set.delete(e.tabId);
        this.broadcast('tabs.onRemoved', () => [e.tabId, { windowId: e.windowId, isWindowClosing: e.isWindowClosing }], { wake: true });
        break;
      case 'activated':
        this.broadcast('tabs.onActivated', () => [{ tabId: e.tabId, windowId: e.windowId }], { wake: true });
        break;
      case 'updated': {
        if (typeof e.changeInfo.url === 'string') for (const set of this.activeTab.values()) set.delete(e.tabId);
        this.broadcast('tabs.onUpdated', (ext) => {
          const t = tab(ext);
          if (!t) return null;
          const info = { ...e.changeInfo };
          // Without access to the page, an extension hears that it changed, not where to.
          if (!t.url) { delete info.url; delete info.title; delete info.favIconUrl; }
          if (Object.keys(info).length === 0) return null;
          return [e.tabId, info, t];
        }, { wake: true });
        break;
      }
      case 'windowCreated':
        this.broadcast('windows.onCreated', (ext) => { const s = this.tabsApi.windowIds.sessionOf(e.windowId); const w = s ? this.tabsApi.windowFor(ext, s, false) : null; return w ? [w] : null; }, { wake: true });
        break;
      case 'windowRemoved':
        this.broadcast('windows.onRemoved', () => [e.windowId], { wake: true });
        break;
      case 'focusChanged':
        this.broadcast('windows.onFocusChanged', () => [e.windowId], { wake: true });
        break;
    }
  }

  /** Follow a tab's navigations for webNavigation, once. */
  private watch(wc: WebContents): void {
    if (this.watched.has(wc) || wc.isDestroyed()) return;
    this.watched.add(wc);
    watchNavigation(wc as never, (event: NavEvent, details) => {
      const url = String(details.url ?? '');
      this.broadcast(`webNavigation.${event}`, (ext) => (this.permissions.has(ext, 'webNavigation') ? [details] : null), { url, wake: true });
    }, (pid, rid) => webFrameMain.fromId(pid, rid) as never);
  }

  // ---------------------------------------------------------------------------
  // The toolbar, popups, menus
  // ---------------------------------------------------------------------------

  private scheduleChanged(): void {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => { this.changedTimer = null; this.deps.changed(); }, 80);
  }

  /** The buttons for the task's active tab. */
  toolbar(sessionId: string | null): ToolbarItem[] {
    const tabId = this.activeTabIdOf(sessionId ?? this.deps.tabs.shownSessionId()) ?? undefined;
    return this.deps.manager.list().filter((s) => s.enabled && s.loaded).map((s) => {
      const st = this.actions.stateFor(s.id, tabId);
      return {
        id: s.id,
        name: s.name,
        pinned: s.pinned,
        title: st.title || s.name,
        icon: st.icon ?? this.iconOf(s.id, 32),
        badgeText: st.badgeText,
        badgeBackgroundColor: st.badgeBackgroundColor,
        badgeTextColor: st.badgeTextColor,
        enabled: st.enabled,
        hasPopup: Boolean(st.popup),
      };
    });
  }

  /** You clicked an extension's button (toolbar or 🧩 menu). */
  async actionClicked(extensionId: string, sessionId: string | null, anchor: Anchor | null): Promise<void> {
    const session = sessionId ?? this.deps.tabs.shownSessionId();
    const tabId = this.activeTabIdOf(session);
    if (tabId !== null) {
      const set = this.activeTab.get(extensionId) ?? new Set<number>();
      set.add(tabId);
      this.activeTab.set(extensionId, set);
    }
    if (this.popup?.extensionId === extensionId) { this.closePopup(); return; }
    const st = this.actions.stateFor(extensionId, tabId ?? undefined);
    if (!st.enabled) return;
    const panel = this.platform.sidePanelFor(extensionId);
    if (panel.openOnAction && panel.path && panel.enabled) {
      await this.showPanel(extensionId, session, panel.path, 'side_panel', anchor);
      return;
    }
    if (st.popup) {
      await this.showPanel(extensionId, session, st.popup, 'popup', anchor);
      return;
    }
    const tab = tabId !== null ? this.tabsApi.tabFor(extensionId, tabId) : null;
    this.emit(extensionId, 'action.onClicked', [tab], { wake: true });
  }

  /** A page of the extension under its button: its popup, or its side panel. */
  private async showPanel(extensionId: string, sessionId: string | null, page: string, kind: 'popup' | 'side_panel', anchor: Anchor | null): Promise<void> {
    const win = this.deps.hubWindow();
    if (!win || win.isDestroyed()) throw new ApiError("DEX's window isn't open");
    this.closePopup();
    const url = new URL(page.replace(/^\/+/, ''), `chrome-extension://${extensionId}/`).href;
    if (extensionOf(url) !== extensionId) throw new ApiError('A popup must be one of the extension\'s own pages');
    const view = new WebContentsView({
      webPreferences: { session: this.deps.session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true },
    });
    view.setBackgroundColor('#ffffff');
    try { view.setBorderRadius(10); } catch { /* older Electron */ }
    const content = win.getContentBounds();
    const a = anchor ?? { x: content.width - 56, y: 84, width: 32, height: 32 };
    this.popup = { view, extensionId, sessionId: sessionId ?? '', kind, anchor: a };
    if (kind === 'side_panel') {
      const top = a.y + a.height + 6;
      view.setBounds({ x: Math.max(8, content.width - 392), y: top, width: 380, height: Math.max(200, content.height - top - 10) });
    } else {
      this.placePopup(POPUP_MIN * 8, POPUP_MIN * 4);
    }
    win.contentView.addChildView(view);
    const wc = view.webContents;
    wc.on('preferred-size-changed', (_e, size) => { if (this.popup?.view === view && kind === 'popup') this.placePopup(size.width, size.height); });
    wc.on('blur', () => { setTimeout(() => { if (this.popup?.view === view && !wc.isDestroyed() && !wc.isFocused() && !wc.isDevToolsOpened()) this.closePopup(); }, 120); });
    wc.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); this.closePopup(); } });
    wc.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/.test(target)) this.openInTab({ extensionId, kind: 'page', contents: wc }, target);
      return { action: 'deny' };
    });
    wc.once('destroyed', () => { if (this.popup?.view === view) this.popup = null; });
    await wc.loadURL(url).catch((err: Error) => this.deps.log('extensions.popup.loadFailed', { extensionId, error: err.message }));
    if (this.popup?.view === view) wc.focus();
  }

  private placePopup(width: number, height: number): void {
    const p = this.popup;
    const win = this.deps.hubWindow();
    if (!p || !win || win.isDestroyed()) return;
    const content = win.getContentBounds();
    // +2: at fractional display scaling the reported size rounds down a
    // pixel, and the popup then grows scrollbars over its own content.
    const w = Math.max(POPUP_MIN, Math.min(POPUP_MAX.width, Math.ceil(width) + 2));
    const h = Math.max(POPUP_MIN, Math.min(POPUP_MAX.height, Math.ceil(height) + 2, content.height - p.anchor.y - p.anchor.height - 12));
    // Right edge under the button's right edge, as Chrome does; kept on screen.
    const x = Math.max(8, Math.min(content.width - w - 8, Math.round(p.anchor.x + p.anchor.width - w)));
    const y = Math.round(p.anchor.y + p.anchor.height + 4);
    p.view.setBounds({ x, y, width: w, height: h });
  }

  closePopup(): void {
    const p = this.popup;
    if (!p) return;
    this.popup = null;
    const win = this.deps.hubWindow();
    try { if (win && !win.isDestroyed()) win.contentView.removeChildView(p.view); } catch { /* gone */ }
    const wc = p.view.webContents;
    try { if (!wc.isDestroyed()) wc.close(); } catch { /* gone */ }
  }

  /** The extension items for a page's right-click menu. */
  pageMenuEntries(target: MenuTarget): MenuEntry[] {
    return this.menus.entriesFor(target, (id) => this.nameOf(id));
  }

  /** An extension's menu item was picked on a page (or on its button). */
  menuClicked(entry: MenuEntry, target: MenuTarget | null, tabId: number | null): void {
    if (!entry.id) return;
    const state = this.menus.get(entry.extensionId, entry.id);
    const flip = this.menus.clicked(entry.extensionId, entry.id);
    if (tabId !== null) {
      const set = this.activeTab.get(entry.extensionId) ?? new Set<number>();
      set.add(tabId);
      this.activeTab.set(entry.extensionId, set);
    }
    const info: Record<string, unknown> = {
      menuItemId: entry.id,
      ...(state?.parentId ? { parentMenuItemId: state.parentId } : {}),
      editable: target?.editable ?? false,
      ...flip,
    };
    if (target) {
      info.pageUrl = target.pageUrl;
      info.frameId = target.frameId;
      if (target.frameUrl) info.frameUrl = target.frameUrl;
      if (target.linkUrl) info.linkUrl = target.linkUrl;
      if (target.srcUrl) info.srcUrl = target.srcUrl;
      if (target.mediaType && target.mediaType !== 'none') info.mediaType = target.mediaType;
      if (target.selectionText) info.selectionText = target.selectionText;
    }
    const tab = tabId !== null ? this.tabsApi.tabFor(entry.extensionId, tabId) : undefined;
    this.emit(entry.extensionId, 'contextMenus.onClicked', [info, tab], { wake: true });
  }

  /** Right-click on an extension's toolbar button. */
  actionMenu(extensionId: string, sessionId: string | null, opts: { manage(): void; openTab(url: string): void }): MenuItemConstructorOptions[] {
    const s = this.deps.manager.summary(extensionId);
    if (!s) return [];
    const tabId = this.activeTabIdOf(sessionId ?? this.deps.tabs.shownSessionId());
    const own = this.menus.entriesFor(null, (id) => this.nameOf(id), extensionId);
    const items = (entries: MenuEntry[]): MenuItemConstructorOptions[] => entries.map((e) => (e.type === 'separator'
      ? { type: 'separator' as const }
      : e.type === 'submenu'
        ? { label: e.label, submenu: items(e.children) }
        : { label: e.label, enabled: e.enabled, type: e.type === 'checkbox' ? 'checkbox' as const : e.type === 'radio' ? 'radio' as const : 'normal' as const, checked: e.checked, click: () => this.menuClicked(e, null, tabId) }));
    const out: MenuItemConstructorOptions[] = [{ label: s.name, enabled: false, icon: this.iconImage(extensionId) }];
    if (own.length) out.push({ type: 'separator' }, ...items(own));
    out.push({ type: 'separator' });
    if (s.optionsUrl) out.push({ label: 'Options', click: () => opts.openTab(s.optionsUrl!) });
    out.push(
      { label: s.pinned ? 'Unpin from toolbar' : 'Pin to toolbar', click: () => this.deps.manager.setPinned(extensionId, !s.pinned) },
      { label: 'Remove from DEX…', click: () => { void this.confirmUninstall(extensionId); } },
      { label: 'Manage extensions', click: () => opts.manage() },
    );
    return out;
  }

  async confirmUninstall(extensionId: string): Promise<boolean> {
    const name = this.nameOf(extensionId);
    const ok = await this.deps.ask(`Remove “${name}”?`, 'Its settings and data in DEX are deleted too.', 'Remove', this.iconImage(extensionId, 32));
    if (ok) await this.uninstall(extensionId);
    return ok;
  }

  async uninstall(extensionId: string): Promise<void> {
    const leaving = this.deps.manager.get(extensionId)?.uninstallUrl;
    await this.proxy.release(extensionId, true);
    this.forgetExtension(extensionId, true);
    this.dnr.unload(extensionId, true);
    this.sync.forget(extensionId);
    await this.deps.manager.uninstall(extensionId);
    if (leaving) {
      const session = this.deps.tabs.shownSessionId();
      if (session) this.deps.tabs.openTab(session, leaving, true);
    }
  }

  /** Everything DEX kept for an extension that's gone (or switched off). */
  private forgetExtension(extensionId: string, removed: boolean): void {
    if (this.popup?.extensionId === extensionId) this.closePopup();
    this.workers.delete(extensionId);
    this.workerInterest.delete(extensionId);
    this.pendingWake.delete(extensionId);
    for (const [key, l] of this.listening) if (l.extensionId === extensionId) this.listening.delete(key);
    this.activeTab.delete(extensionId);
    this.actions.forgetExtension(extensionId);
    this.menus.forgetExtension(extensionId);
    this.platform.forgetExtension(extensionId);
    if (!removed) void this.proxy.release(extensionId, false);
  }

  // ---------------------------------------------------------------------------
  // Platform pieces
  // ---------------------------------------------------------------------------

  /** Open `url` in a tab of the task the caller means (or the one on screen). */
  openInTab(ctx: CallContext | null, url: string): void {
    const session = ctx ? this.tabsApi.currentSession(ctx) : this.deps.tabs.shownSessionId();
    if (!session) throw new ApiError("There's no DEX task open to show the page in");
    this.deps.tabs.openTab(session, url, true);
  }

  private notify(extensionId: string, opts: { title: string; body: string; icon?: string; silent: boolean; requireInteraction: boolean }, on: { click(): void; close(byUser: boolean): void }) {
    let icon: Electron.NativeImage | undefined;
    if (opts.icon?.startsWith('data:image/')) icon = nativeImage.createFromDataURL(opts.icon);
    else if (opts.icon && !/^[a-z]+:/i.test(opts.icon)) {
      const url = this.iconFromFile(extensionId, opts.icon, 64);
      if (url) icon = nativeImage.createFromDataURL(url);
    }
    const n = new Notification({ title: opts.title.slice(0, 200), body: opts.body.slice(0, 1000), silent: opts.silent, icon: icon ?? this.iconImage(extensionId, 64), timeoutType: opts.requireInteraction ? 'never' : 'default' });
    let closedByUs = false;
    n.on('click', () => on.click());
    n.on('close', () => on.close(!closedByUs));
    n.show();
    return { close: () => { closedByUs = true; n.close(); } };
  }

  private setKeepAwake(extensionId: string, level: 'system' | 'display' | null): void {
    const cur = this.keepAwake.get(extensionId);
    if (cur !== undefined) { try { powerSaveBlocker.stop(cur); } catch { /* gone */ } this.keepAwake.delete(extensionId); }
    if (level) this.keepAwake.set(extensionId, powerSaveBlocker.start(level === 'display' ? 'prevent-display-sleep' : 'prevent-app-suspension'));
  }

  /** chrome.identity.launchWebAuthFlow: a sign-in window, done when it reaches the extension's redirect. */
  private authFlow(extensionId: string, url: string, interactive: boolean): Promise<string> {
    const redirect = `https://${extensionId}.chromiumapp.org/`;
    return new Promise((resolve, reject) => {
      const parent = this.deps.hubWindow();
      const win = new BrowserWindow({
        width: 500, height: 680, show: false, autoHideMenuBar: true, title: `Sign in — ${this.nameOf(extensionId)}`,
        ...(parent && !parent.isDestroyed() ? { parent } : {}),
        webPreferences: { session: this.deps.session, sandbox: true, contextIsolation: true },
      });
      let done = false;
      const finish = (result: string | null, error?: string) => {
        if (done) return;
        done = true;
        if (!win.isDestroyed()) win.destroy();
        if (result) resolve(result); else reject(new ApiError(error ?? 'The user did not approve access.'));
      };
      const check = (target: string) => { if (target.startsWith(redirect)) finish(target); };
      win.webContents.on('will-redirect', (e, target) => { if (target.startsWith(redirect)) { e.preventDefault(); check(target); } });
      win.webContents.on('will-navigate', (e, target) => { if (target.startsWith(redirect)) { e.preventDefault(); check(target); } });
      win.webContents.on('did-navigate', (_e, target) => check(target));
      win.on('closed', () => finish(null));
      if (interactive) win.once('ready-to-show', () => win.show());
      else setTimeout(() => finish(null, 'User interaction required.'), 8000);
      win.loadURL(url).catch(() => finish(null, 'Authorization page could not be loaded.'));
    });
  }

  private async createOffscreen(extensionId: string, url: string): Promise<void> {
    const win = new BrowserWindow({
      show: false, skipTaskbar: true, width: 800, height: 600,
      webPreferences: { session: this.deps.session, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    this.offscreenDocs.set(extensionId, win);
    win.on('closed', () => { if (this.offscreenDocs.get(extensionId) === win) this.offscreenDocs.delete(extensionId); });
    await win.loadURL(url);
  }

  private closeOffscreen(extensionId: string): void {
    const win = this.offscreenDocs.get(extensionId);
    this.offscreenDocs.delete(extensionId);
    if (win && !win.isDestroyed()) win.destroy();
  }

  private contexts(extensionId: string): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const origin = `chrome-extension://${extensionId}`;
    const worker = this.workers.get(extensionId);
    if (worker) out.push({ contextType: 'BACKGROUND', contextId: `bg-${extensionId}`, tabId: -1, windowId: -1, frameId: -1, documentUrl: worker.sw.scriptURL, documentOrigin: origin, incognito: false });
    const off = this.offscreenDocs.get(extensionId);
    if (off && !off.isDestroyed()) out.push({ contextType: 'OFFSCREEN_DOCUMENT', contextId: `off-${extensionId}`, tabId: -1, windowId: -1, frameId: 0, documentUrl: off.webContents.getURL(), documentOrigin: origin, incognito: false });
    if (this.popup?.extensionId === extensionId) {
      out.push({ contextType: this.popup.kind === 'side_panel' ? 'SIDE_PANEL' : 'POPUP', contextId: `popup-${extensionId}`, tabId: -1, windowId: this.tabsApi.windowIds.of(this.popup.sessionId), frameId: 0, documentUrl: this.popup.view.webContents.getURL(), documentOrigin: origin, incognito: false });
    }
    for (const w of this.deps.tabs.windows()) {
      for (const t of w.tabs) {
        const url = t.wc.isDestroyed() ? '' : t.wc.getURL();
        if (extensionOf(url) === extensionId) out.push({ contextType: 'TAB', contextId: `tab-${t.wc.id}`, tabId: t.wc.id, windowId: this.tabsApi.windowIds.of(w.sessionId), frameId: 0, documentUrl: url, documentOrigin: origin, incognito: false });
      }
    }
    return out;
  }

  /** May the agent drive this extension page? Not a password manager's, nor a crypto wallet's. */
  static agentMayUse(url: string, name: string): boolean {
    if (!url.startsWith('chrome-extension://')) return true;
    return ExtensionHost.offLimits(name) === null;
  }

  /**
   * Extensions that stay in the user's hands: a password manager holds their
   * passwords, a wallet signs payments. The agent never reaches their pages
   * or presses their buttons.
   */
  static offLimits(name: string): 'password manager' | 'wallet' | null {
    if (/(bitwarden|1password|lastpass|dashlane|keeper|nordpass|roboform|proton pass|enpass|keepass|zoho vault|norton password|password manager)/i.test(name)) return 'password manager';
    if (/(metamask|phantom|coinbase wallet|trust wallet|rabby|okx wallet|keplr|solflare|backpack|ronin|exodus|rainbow|zerion|tronlink|brave wallet|crypto wallet|\bwallet\b)/i.test(name)) return 'wallet';
    return null;
  }

  // ---------------------------------------------------------------------------
  // The agent's side (dex-ext): what's installed, its button, its menu items
  // ---------------------------------------------------------------------------

  /** The extensions the agent can use in this task, as `dex-ext list` shows them. */
  agentList(sessionId: string): AgentExtension[] {
    const tabId = this.activeTabIdOf(sessionId);
    const page = this.activePageUrl(sessionId);
    return this.deps.manager.list().filter((s) => s.enabled && s.loaded).map((s) => {
      const off = ExtensionHost.offLimits(s.name);
      const st = this.actions.stateFor(s.id, tabId ?? undefined);
      const panel = this.platform.sidePanelFor(s.id);
      const opens: AgentExtension['button']['opens'] = panel.openOnAction && panel.path && panel.enabled ? 'side panel' : st.popup ? 'popup' : 'acts on the page';
      const hosts = s.hostPermissions;
      const everywhere = hosts.some((h) => h === '<all_urls>' || /^(\*|https?):\/\/\*\/\*$/.test(h));
      const sites = everywhere ? ['every site'] : [...new Set(hosts.map((h) => h.replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '')))].slice(0, 6);
      const menu = page && !off ? flatMenu(this.menus.entriesFor({ pageUrl: page, frameId: 0, editable: false }, (id) => this.nameOf(id), s.id)).map((m) => m.path) : [];
      return {
        id: s.id,
        name: s.name,
        description: s.description.length > 180 ? `${s.description.slice(0, 179)}…` : s.description,
        offLimits: off,
        button: { title: st.title || s.name, badge: st.badgeText || undefined, enabled: st.enabled !== false, opens },
        runsOn: sites,
        options: s.optionsUrl,
        menu,
      };
    });
  }

  /**
   * The agent presses an extension's button on the task's page. A popup or
   * side panel comes back as the page to open (DEX opens it as a background
   * tab, so the page stays the extension's current tab); a button without
   * one acts on the page right away.
   */
  agentPress(extensionId: string, sessionId: string): { kind: 'popup' | 'side_panel' | 'clicked' | 'disabled'; url?: string } {
    const tabId = this.activeTabIdOf(sessionId);
    if (tabId !== null) {
      const set = this.activeTab.get(extensionId) ?? new Set<number>();
      set.add(tabId);
      this.activeTab.set(extensionId, set);
    }
    const st = this.actions.stateFor(extensionId, tabId ?? undefined);
    if (st.enabled === false) return { kind: 'disabled' };
    const page = (p: string) => new URL(p.replace(/^\/+/, ''), `chrome-extension://${extensionId}/`).href;
    const panel = this.platform.sidePanelFor(extensionId);
    if (panel.openOnAction && panel.path && panel.enabled) return { kind: 'side_panel', url: page(panel.path) };
    if (st.popup) return { kind: 'popup', url: page(st.popup) };
    const tab = tabId !== null ? this.tabsApi.tabFor(extensionId, tabId) : null;
    this.emit(extensionId, 'action.onClicked', [tab], { wake: true });
    return { kind: 'clicked' };
  }

  /** Extensions' right-click items for the task's page (or a link, picture or selection on it). */
  agentMenu(sessionId: string, at: { linkUrl?: string; srcUrl?: string; selectionText?: string } = {}): Array<{ extensionId: string; extension: string; path: string; id: string; enabled: boolean }> {
    const target = this.agentTarget(sessionId, at);
    if (!target) return [];
    return flatMenu(this.menus.entriesFor(target, (id) => this.nameOf(id)))
      .filter((m) => ExtensionHost.offLimits(this.nameOf(m.entry.extensionId)) === null)
      .map((m) => ({ extensionId: m.entry.extensionId, extension: this.nameOf(m.entry.extensionId), path: m.path, id: m.entry.id as string, enabled: m.entry.enabled }));
  }

  /** Pick one of them, as the user would from the right-click menu. */
  agentMenuClick(sessionId: string, extensionId: string, itemId: string, at: { linkUrl?: string; srcUrl?: string; selectionText?: string } = {}): boolean {
    const target = this.agentTarget(sessionId, at);
    if (!target) return false;
    const hit = flatMenu(this.menus.entriesFor(target, (id) => this.nameOf(id), extensionId)).find((m) => m.entry.id === itemId);
    if (!hit || !hit.entry.enabled) return false;
    this.menuClicked(hit.entry, target, this.activeTabIdOf(sessionId));
    return true;
  }

  private agentTarget(sessionId: string, at: { linkUrl?: string; srcUrl?: string; selectionText?: string }): MenuTarget | null {
    const pageUrl = this.activePageUrl(sessionId);
    if (!pageUrl) return null;
    return {
      pageUrl,
      frameId: 0,
      editable: false,
      ...(at.linkUrl ? { linkUrl: at.linkUrl } : {}),
      ...(at.srcUrl ? { srcUrl: at.srcUrl, mediaType: 'image' } : {}),
      ...(at.selectionText ? { selectionText: at.selectionText } : {}),
    };
  }

  private activePageUrl(sessionId: string): string | null {
    const win = this.deps.tabs.windows().find((w) => w.sessionId === sessionId);
    const wc = win?.tabs.find((t) => t.active)?.wc;
    try { return wc && !wc.isDestroyed() ? wc.getURL() || null : null; } catch { return null; }
  }

  hasHostAccess(extensionId: string, url: string): boolean {
    return matchesAny(this.permissions.hosts(extensionId, true), url);
  }

  dispose(): void {
    this.closePopup();
    for (const id of [...this.offscreenDocs.keys()]) this.closeOffscreen(id);
    for (const id of [...this.keepAwake.keys()]) this.setKeepAwake(id, null);
    if (this.idleTimer) clearInterval(this.idleTimer);
  }
}
