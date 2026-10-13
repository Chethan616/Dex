/**
 * The web profile's network hooks, in one place. Electron allows one
 * listener per webRequest event per session, and its own chrome.webRequest
 * never reaches extensions (checked on Electron 41: listeners never fire), so
 * DEX owns the hooks and serves both:
 * - declarativeNetRequest (dnr/engine.ts): block, redirect, upgrade, headers;
 * - extensions' chrome.webRequest listeners: told about requests their
 *   filters and host permissions cover (observing, as MV3 allows);
 * - proxy and site sign-ins: extensions' onAuthRequired answers them (a
 *   library-proxy extension supplies its login this way).
 *
 * The hooks are installed only while something needs them; otherwise pages
 * load without any detour through DEX.
 */
import type { DnrEngine } from './dnr/engine';
import { applyRequestHeaders, applyResponseHeaders } from './dnr/engine';
import type { DnrRequest, Rule } from './dnr/rules';
import { matchesAny } from './matchPattern';

type WebRequest = Electron.WebRequest;

const TYPE: Record<string, string> = {
  mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image',
  font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report', media: 'media',
  webSocket: 'websocket', other: 'other',
};

/** What a listener asked for: `{urls, types, tabId, windowId}`. */
export interface RequestFilter { urls?: string[]; types?: string[]; tabId?: number; windowId?: number }

export function requestFilterMatches(filter: unknown, d: { url: string; type: string; tabId: number; windowId: number }): boolean {
  const f = (filter ?? {}) as RequestFilter;
  if (!Array.isArray(f.urls) || f.urls.length === 0 || !matchesAny(f.urls, d.url)) return false;
  if (Array.isArray(f.types) && !f.types.includes(d.type)) return false;
  if (typeof f.tabId === 'number' && f.tabId !== d.tabId) return false;
  if (typeof f.windowId === 'number' && f.windowId !== d.windowId) return false;
  return true;
}

const hostOf = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase() || null; } catch { return null; }
};

interface FrameRef { frameTreeNodeId: number; origin?: string; parent: FrameRef | null; url?: string }

export interface HubDeps {
  session: Electron.Session;
  dnr: DnrEngine;
  /** Is this WebContents one of DEX's tabs? Gives its window (task) id. */
  tabOf(webContentsId: number | undefined): { tabId: number; windowId: number } | null;
  /** Who listens to a webRequest event right now: each worker or page on its own (listener ids are per context). */
  listeners(event: string): Array<{ context: string; extensionId: string; filters: Array<{ id: number; filter: unknown; extra: unknown }> }>;
  canObserve(extensionId: string, url: string, initiator: string | undefined): boolean;
  deliver(context: string, event: string, details: Record<string, unknown>, ids: number[], reply: boolean): Promise<unknown[]>;
  log?(event: string, data: Record<string, unknown>): void;
}

interface Pending { headerRules: Rule[] }

export class WebRequestHub {
  private installed = false;
  private pending = new Map<number, Pending>();

  constructor(private readonly deps: HubDeps) {}

  /** Install or drop the hooks: call when rules or listeners change. */
  refresh(): void {
    const wanted = this.deps.dnr.hasRules() || this.anyListeners();
    if (wanted === this.installed) return;
    this.installed = wanted;
    const wr: WebRequest = this.deps.session.webRequest;
    if (!wanted) {
      for (const k of ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'] as const) {
        (wr[k] as (listener: null) => void)(null);
      }
      this.pending.clear();
      this.deps.log?.('extensions.webRequest.hooks', { on: false });
      return;
    }
    const all = { urls: ['<all_urls>'] };
    wr.onBeforeRequest(all, (d, cb) => cb(this.beforeRequest(d)));
    wr.onBeforeSendHeaders(all, (d, cb) => cb(this.beforeSendHeaders(d)));
    wr.onSendHeaders(all, (d) => this.observe('onSendHeaders', d));
    wr.onHeadersReceived(all, (d, cb) => cb(this.headersReceived(d)));
    wr.onResponseStarted(all, (d) => this.observe('onResponseStarted', d));
    wr.onBeforeRedirect(all, (d) => this.observe('onBeforeRedirect', d));
    wr.onCompleted(all, (d) => { this.pending.delete(d.id); this.observe('onCompleted', d); });
    wr.onErrorOccurred(all, (d) => { this.pending.delete(d.id); this.observe('onErrorOccurred', d); });
    this.deps.log?.('extensions.webRequest.hooks', { on: true });
  }

  private anyListeners(): boolean {
    return ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred', 'onAuthRequired']
      .some((e) => this.deps.listeners(`webRequest.${e}`).length > 0);
  }

  /** Requests DEX's rules and listeners never touch: extension pages' own, DevTools, data: and the like. */
  private skip(url: string): boolean {
    return !/^(https?|wss?):/i.test(url);
  }

  private initiatorOf(d: { resourceType: string; frame?: FrameRef | null; referrer: string }): string | undefined {
    if (d.resourceType === 'mainFrame') {
      try { return d.referrer ? new URL(d.referrer).origin : undefined; } catch { return undefined; }
    }
    const origin = d.frame?.origin;
    return origin && origin !== 'null' ? origin : undefined;
  }

  private frameIdOf(frame: FrameRef | null | undefined): number {
    if (!frame || !frame.parent) return 0;
    return frame.frameTreeNodeId;
  }

  private dnrRequest(d: { url: string; method: string; resourceType: string; webContentsId?: number; frame?: FrameRef | null; referrer: string }): { req: DnrRequest; frameKeys: string[]; frameKey?: string; tab: { tabId: number; windowId: number } | null; initiator?: string } {
    const tab = this.deps.tabOf(d.webContentsId);
    const tabId = tab?.tabId ?? -1;
    const initiator = this.initiatorOf(d);
    const type = TYPE[d.resourceType] ?? 'other';
    const req: DnrRequest = {
      url: d.url,
      host: hostOf(d.url) ?? '',
      method: d.method.toLowerCase(),
      type,
      tabId,
      initiatorHost: hostOf(initiator),
    };
    const frameKeys: string[] = [];
    let frameKey: string | undefined;
    if (tabId >= 0) {
      // The frame a document request loads is the one being navigated; a
      // subresource belongs to its frame and every frame above it.
      let f: FrameRef | null | undefined = d.frame;
      if (type === 'main_frame') frameKey = `${tabId}:0`;
      else if (type === 'sub_frame' && f) { frameKey = `${tabId}:${this.frameIdOf(f)}`; f = f.parent; }
      for (; f; f = f.parent) frameKeys.push(`${tabId}:${this.frameIdOf(f)}`);
      if (type !== 'main_frame' && !frameKeys.includes(`${tabId}:0`)) frameKeys.push(`${tabId}:0`);
    }
    return { req, frameKeys, frameKey, tab, initiator };
  }

  private chromeDetails(d: Electron.OnBeforeRequestListenerDetails | Record<string, any>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const tab = this.deps.tabOf(d.webContentsId);
    const initiator = this.initiatorOf(d as { resourceType: string; frame?: FrameRef | null; referrer: string });
    return {
      requestId: String(d.id),
      url: d.url,
      method: d.method,
      frameId: this.frameIdOf(d.frame as FrameRef | null | undefined),
      parentFrameId: d.frame && (d.frame as FrameRef).parent ? this.frameIdOf((d.frame as FrameRef).parent) : -1,
      tabId: tab?.tabId ?? -1,
      type: TYPE[d.resourceType as string] ?? 'other',
      timeStamp: d.timestamp ?? Date.now(),
      ...(initiator ? { initiator } : {}),
      frameType: d.frame && (d.frame as FrameRef).parent ? 'sub_frame' : 'outermost_frame',
      documentLifecycle: 'active',
      ...extra,
    };
  }

  /** Tell each listening extension whose filter matches; resolve their answers when asked to. */
  private notify(event: string, d: Record<string, any>, extra: (wants: (k: string) => boolean) => Record<string, unknown>, reply = false): Promise<unknown[]> {
    const list = this.deps.listeners(`webRequest.${event}`);
    if (list.length === 0 || this.skip(d.url)) return Promise.resolve([]);
    const tab = this.deps.tabOf(d.webContentsId);
    const base = { url: d.url, type: TYPE[d.resourceType] ?? 'other', tabId: tab?.tabId ?? -1, windowId: tab?.windowId ?? -1 };
    const initiator = this.initiatorOf(d as { resourceType: string; frame?: FrameRef | null; referrer: string });
    const answers: Array<Promise<unknown[]>> = [];
    for (const { context, extensionId, filters } of list) {
      if (!this.deps.canObserve(extensionId, d.url, initiator)) continue;
      const ids = filters.filter((f) => requestFilterMatches(f.filter, base)).map((f) => f.id);
      if (ids.length === 0) continue;
      const wants = (k: string) => filters.some((f) => ids.includes(f.id) && Array.isArray(f.extra) && (f.extra as string[]).includes(k));
      answers.push(this.deps.deliver(context, `webRequest.${event}`, this.chromeDetails(d, extra(wants)), ids, reply));
    }
    return Promise.all(answers).then((a) => a.flat());
  }

  private observe(event: string, d: Record<string, any>): void {
    void this.notify(event, d, (wants) => {
      const out: Record<string, unknown> = {};
      if (typeof d.statusCode === 'number') out.statusCode = d.statusCode;
      if (typeof d.statusLine === 'string') out.statusLine = d.statusLine;
      if (typeof d.fromCache === 'boolean') out.fromCache = d.fromCache;
      if (typeof d.ip === 'string') out.ip = d.ip;
      if (typeof d.redirectURL === 'string') out.redirectUrl = d.redirectURL;
      if (typeof d.error === 'string') out.error = d.error;
      if (wants('requestHeaders') && d.requestHeaders) out.requestHeaders = Object.entries(d.requestHeaders).map(([name, value]) => ({ name, value: String(value) }));
      if (wants('responseHeaders') && d.responseHeaders) {
        out.responseHeaders = Object.entries(d.responseHeaders as Record<string, string[]>).flatMap(([name, values]) => values.map((value) => ({ name, value })));
      }
      return out;
    });
  }

  private beforeRequest(d: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse {
    if (this.skip(d.url)) return {};
    this.observe('onBeforeRequest', d as unknown as Record<string, any>);
    const { req, frameKeys, frameKey } = this.dnrRequest(d as never);
    let decision;
    try {
      decision = this.deps.dnr.evaluate(req, { frameKeys, frameKey });
    } catch (err) {
      this.deps.log?.('extensions.dnr.evaluateFailed', { error: (err as Error).message });
      return {};
    }
    if (decision.headerRules.length) this.pending.set(d.id, { headerRules: decision.headerRules });
    if (decision.cancel) return { cancel: true };
    if (decision.redirectUrl) return { redirectURL: decision.redirectUrl };
    return {};
  }

  private beforeSendHeaders(d: Electron.OnBeforeSendHeadersListenerDetails): Electron.BeforeSendResponse {
    this.observe('onBeforeSendHeaders', d as unknown as Record<string, any>);
    const rules = this.pending.get(d.id)?.headerRules.filter((r) => r.action.requestHeaders?.length);
    if (!rules?.length) return {};
    return { requestHeaders: applyRequestHeaders(d.requestHeaders, rules) };
  }

  private headersReceived(d: Electron.OnHeadersReceivedListenerDetails): Electron.HeadersReceivedResponse {
    this.observe('onHeadersReceived', d as unknown as Record<string, any>);
    const rules = this.pending.get(d.id)?.headerRules.filter((r) => r.action.responseHeaders?.length);
    if (!rules?.length || !d.responseHeaders) return {};
    return { responseHeaders: applyResponseHeaders(d.responseHeaders, rules) };
  }

  /**
   * A sign-in the network asked for (a proxy, or a site's basic auth). Any
   * extension listening to onAuthRequired may answer; resolves its
   * credentials, or null when none did.
   */
  async authRequired(d: { url: string; method?: string; webContentsId?: number; isProxy: boolean; host: string; port: number; realm: string; scheme: string }): Promise<{ username: string; password: string } | 'cancel' | null> {
    const answers = await this.notify('onAuthRequired', { ...d, id: Date.now(), resourceType: 'other', method: d.method ?? 'GET', referrer: '' }, () => ({
      isProxy: d.isProxy,
      scheme: d.scheme,
      realm: d.realm,
      challenger: { host: d.host, port: d.port },
    }), true);
    for (const a of answers) {
      const r = a as { authCredentials?: { username?: unknown; password?: unknown }; cancel?: unknown } | null;
      if (r?.cancel === true) return 'cancel';
      const c = r?.authCredentials;
      if (c && typeof c.username === 'string' && typeof c.password === 'string') return { username: c.username, password: c.password };
    }
    return null;
  }
}
