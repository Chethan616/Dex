/**
 * chrome.webNavigation, from each tab's own navigation events, with Chrome's
 * URL filters (`{url: [{hostSuffix: '.example.com'}]}`) applied here, so an
 * extension is only woken for the pages it asked about.
 *
 * Frame ids follow Chromium's extension APIs: 0 for the top frame, the
 * frame-tree node id for the others — the ids scripting.executeScript takes.
 */
import { ApiError, type Handler } from './types';

export interface UrlFilter {
  hostContains?: string; hostEquals?: string; hostPrefix?: string; hostSuffix?: string;
  pathContains?: string; pathEquals?: string; pathPrefix?: string; pathSuffix?: string;
  queryContains?: string; queryEquals?: string; queryPrefix?: string; querySuffix?: string;
  urlContains?: string; urlEquals?: string; urlMatches?: string; originAndPathMatches?: string;
  urlPrefix?: string; urlSuffix?: string;
  schemes?: string[];
  ports?: Array<number | [number, number]>;
}

const regexCache = new Map<string, RegExp | null>();
function regex(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    let re: RegExp | null;
    try { re = new RegExp(src); } catch { re = null; }
    regexCache.set(src, re);
  }
  return regexCache.get(src) ?? null;
}

/** Whether `url` passes one UrlFilter (every condition in it). */
export function urlFilterMatches(f: UrlFilter, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = `.${u.hostname}`;
  const path = u.pathname;
  const query = u.search.replace(/^\?/, '');
  const noFragment = url.split('#')[0];
  const str = (v: unknown) => typeof v === 'string';
  if (str(f.hostContains) && !host.includes(f.hostContains!)) return false;
  if (str(f.hostEquals) && u.hostname !== f.hostEquals) return false;
  if (str(f.hostPrefix) && !u.hostname.startsWith(f.hostPrefix!)) return false;
  if (str(f.hostSuffix) && !host.endsWith(f.hostSuffix!)) return false;
  if (str(f.pathContains) && !path.includes(f.pathContains!)) return false;
  if (str(f.pathEquals) && path !== f.pathEquals) return false;
  if (str(f.pathPrefix) && !path.startsWith(f.pathPrefix!)) return false;
  if (str(f.pathSuffix) && !path.endsWith(f.pathSuffix!)) return false;
  if (str(f.queryContains) && !query.includes(f.queryContains!)) return false;
  if (str(f.queryEquals) && query !== f.queryEquals) return false;
  if (str(f.queryPrefix) && !query.startsWith(f.queryPrefix!)) return false;
  if (str(f.querySuffix) && !query.endsWith(f.querySuffix!)) return false;
  if (str(f.urlContains) && !noFragment.includes(f.urlContains!)) return false;
  if (str(f.urlEquals) && noFragment !== f.urlEquals) return false;
  if (str(f.urlPrefix) && !noFragment.startsWith(f.urlPrefix!)) return false;
  if (str(f.urlSuffix) && !noFragment.endsWith(f.urlSuffix!)) return false;
  if (str(f.urlMatches) && !regex(f.urlMatches!)?.test(noFragment)) return false;
  if (str(f.originAndPathMatches) && !regex(f.originAndPathMatches!)?.test(`${u.origin}${u.pathname}`)) return false;
  if (Array.isArray(f.schemes) && !f.schemes.includes(u.protocol.replace(/:$/, ''))) return false;
  if (Array.isArray(f.ports)) {
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : 0));
    if (!f.ports.some((p) => (Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p))) return false;
  }
  return true;
}

/** A webNavigation listener's filter: `{url: UrlFilter[]}`, or none (everything). */
export function navigationFilterMatches(filter: unknown, url: string): boolean {
  const list = (filter as { url?: UrlFilter[] } | null | undefined)?.url;
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.some((f) => urlFilterMatches(f ?? {}, url));
}

interface FrameLike {
  frameTreeNodeId: number;
  url: string;
  parent: FrameLike | null;
  processId: number;
  routingId: number;
  framesInSubtree?: FrameLike[];
  isDestroyed?(): boolean;
}

export function frameIdOf(frame: FrameLike | null | undefined, top: FrameLike | null | undefined): number {
  if (!frame || !top || frame === top || frame.frameTreeNodeId === top.frameTreeNodeId) return 0;
  return frame.frameTreeNodeId;
}

export type NavEvent = 'onBeforeNavigate' | 'onCommitted' | 'onDOMContentLoaded' | 'onCompleted' | 'onErrorOccurred' | 'onReferenceFragmentUpdated' | 'onHistoryStateUpdated';

interface WatchedContents {
  id: number;
  mainFrame: FrameLike;
  on(event: string, listener: (...args: never[]) => void): unknown;
  isDestroyed(): boolean;
}

/**
 * Follow one tab's navigations and report them as webNavigation events.
 * `fromId` finds a frame by process and routing id (Electron's webFrameMain).
 */
export function watchNavigation(
  wc: WatchedContents,
  emit: (event: NavEvent, details: Record<string, unknown>) => void,
  fromId: (processId: number, routingId: number) => FrameLike | null | undefined,
): void {
  const base = (frame: FrameLike | null | undefined, url: string): Record<string, unknown> => {
    const top = wc.isDestroyed() ? null : wc.mainFrame;
    const frameId = frameIdOf(frame, top);
    const parent = frame?.parent ?? null;
    return {
      tabId: wc.id,
      url,
      processId: frame?.processId ?? -1,
      frameId,
      parentFrameId: frameId === 0 ? -1 : frameIdOf(parent, top),
      timeStamp: Date.now(),
      frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame',
      documentLifecycle: 'active',
    };
  };
  const byIds = (processId: number, routingId: number) => {
    try { return fromId(processId, routingId); } catch { return null; }
  };

  wc.on('did-start-navigation', (details: { url: string; isSameDocument: boolean; frame?: FrameLike | null }) => {
    if (details.isSameDocument) return;
    emit('onBeforeNavigate', base(details.frame, details.url));
  });
  wc.on('did-frame-navigate', (_e: unknown, url: string, _code: number, _status: string, _isMain: boolean, processId: number, routingId: number) => {
    emit('onCommitted', { ...base(byIds(processId, routingId), url), transitionType: 'link', transitionQualifiers: [] });
  });
  wc.on('did-navigate-in-page', (_e: unknown, url: string, _isMain: boolean, processId: number, routingId: number) => {
    const frame = byIds(processId, routingId);
    const hashOnly = (() => {
      try { return url.split('#')[0] === (frame?.url ?? '').split('#')[0] && url.includes('#'); } catch { return false; }
    })();
    emit(hashOnly ? 'onReferenceFragmentUpdated' : 'onHistoryStateUpdated', { ...base(frame, url), transitionType: 'link', transitionQualifiers: [] });
  });
  wc.on('dom-ready', () => {
    if (wc.isDestroyed()) return;
    emit('onDOMContentLoaded', base(wc.mainFrame, wc.mainFrame.url));
  });
  wc.on('did-frame-finish-load', (_e: unknown, isMain: boolean, processId: number, routingId: number) => {
    const frame = isMain && !wc.isDestroyed() ? wc.mainFrame : byIds(processId, routingId);
    if (!frame) return;
    if (!isMain) emit('onDOMContentLoaded', base(frame, frame.url));
    emit('onCompleted', base(frame, frame.url));
  });
  wc.on('did-fail-load', (_e: unknown, code: number, description: string, url: string, _isMain: boolean, processId: number, routingId: number) => {
    emit('onErrorOccurred', { ...base(byIds(processId, routingId), url), error: `net::${description || code}` });
  });
}

export function webNavigationHandlers(findTab: (tabId: number) => WatchedContents | null): Record<string, Handler> {
  const frames = (wc: WatchedContents): FrameLike[] => {
    const top = wc.mainFrame;
    return [top, ...(top.framesInSubtree ?? []).filter((f) => f !== top && f.frameTreeNodeId !== top.frameTreeNodeId)];
  };
  const describe = (wc: WatchedContents, f: FrameLike) => {
    const top = wc.mainFrame;
    const frameId = frameIdOf(f, top);
    return {
      errorOccurred: false, url: f.url, frameId, processId: f.processId,
      parentFrameId: frameId === 0 ? -1 : frameIdOf(f.parent, top),
      frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active',
    };
  };
  return {
    'webNavigation.getFrame': (_ctx, [details]) => {
      const d = (details ?? {}) as { tabId?: number; frameId?: number };
      const wc = typeof d.tabId === 'number' ? findTab(d.tabId) : null;
      if (!wc || wc.isDestroyed()) throw new ApiError(`No tab with id: ${String(d.tabId)}.`);
      const f = frames(wc).find((x) => frameIdOf(x, wc.mainFrame) === (d.frameId ?? 0));
      return f ? describe(wc, f) : null;
    },
    'webNavigation.getAllFrames': (_ctx, [details]) => {
      const d = (details ?? {}) as { tabId?: number };
      const wc = typeof d.tabId === 'number' ? findTab(d.tabId) : null;
      if (!wc || wc.isDestroyed()) return null;
      return frames(wc).map((f) => describe(wc, f));
    },
  };
}
