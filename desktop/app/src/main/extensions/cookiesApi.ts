/**
 * chrome.cookies, on the web profile's cookie jar. As in Chrome, an
 * extension reaches only cookies of sites its host permissions cover — for
 * every read, every write, and every change it hears about.
 */
import { ApiError, type CallContext, type Handler } from './types';

export interface CookieJarLike {
  get(filter: Electron.CookiesGetFilter): Promise<Electron.Cookie[]>;
  set(details: Electron.CookiesSetDetails): Promise<void>;
  remove(url: string, name: string): Promise<void>;
}

/** A URL a cookie belongs to, to check host access against. */
export function cookieUrl(c: { domain?: string; path?: string; secure?: boolean }): string {
  const host = (c.domain ?? '').replace(/^\./, '');
  return `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`;
}

export function chromeCookie(c: Electron.Cookie): Record<string, unknown> {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain ?? '',
    hostOnly: c.hostOnly ?? false,
    path: c.path ?? '/',
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
    sameSite: c.sameSite ?? 'unspecified',
    session: c.session ?? false,
    ...(typeof c.expirationDate === 'number' ? { expirationDate: c.expirationDate } : {}),
    storeId: '0',
  };
}

export function cookiesHandlers(deps: {
  jar: CookieJarLike;
  canReach(extensionId: string, url: string): boolean;
  allTabIds(): number[];
}): Record<string, Handler> {
  const needUrl = (ctx: CallContext, url: unknown): string => {
    if (typeof url !== 'string') throw new ApiError('A url is required');
    try { new URL(url); } catch { throw new ApiError(`Invalid url: ${url}`); }
    if (!deps.canReach(ctx.extensionId, url)) throw new ApiError(`No host permissions for cookies at url: "${url}".`);
    return url;
  };
  return {
    'cookies.get': async (ctx, [details]) => {
      const d = (details ?? {}) as { url?: string; name?: string };
      const url = needUrl(ctx, d.url);
      if (typeof d.name !== 'string') throw new ApiError('A cookie name is required');
      const found = await deps.jar.get({ url, name: d.name });
      // Chrome returns the one with the longest path.
      found.sort((a, b) => (b.path ?? '').length - (a.path ?? '').length);
      return found[0] ? chromeCookie(found[0]) : null;
    },
    'cookies.getAll': async (ctx, [details]) => {
      const d = (details ?? {}) as Record<string, unknown>;
      const filter: Electron.CookiesGetFilter = {};
      if (typeof d.url === 'string') filter.url = needUrl(ctx, d.url);
      if (typeof d.name === 'string') filter.name = d.name;
      if (typeof d.domain === 'string') filter.domain = d.domain;
      if (typeof d.path === 'string') filter.path = d.path;
      if (typeof d.secure === 'boolean') filter.secure = d.secure;
      if (typeof d.session === 'boolean') filter.session = d.session;
      const all = await deps.jar.get(filter);
      return all.filter((c) => deps.canReach(ctx.extensionId, cookieUrl(c))).map(chromeCookie);
    },
    'cookies.set': async (ctx, [details]) => {
      const d = (details ?? {}) as Record<string, unknown>;
      const url = needUrl(ctx, d.url);
      const set: Electron.CookiesSetDetails = { url };
      if (typeof d.name === 'string') set.name = d.name;
      if (typeof d.value === 'string') set.value = d.value;
      if (typeof d.domain === 'string') set.domain = d.domain;
      if (typeof d.path === 'string') set.path = d.path;
      if (typeof d.secure === 'boolean') set.secure = d.secure;
      if (typeof d.httpOnly === 'boolean') set.httpOnly = d.httpOnly;
      if (typeof d.expirationDate === 'number') set.expirationDate = d.expirationDate;
      if (d.sameSite === 'no_restriction' || d.sameSite === 'lax' || d.sameSite === 'strict' || d.sameSite === 'unspecified') set.sameSite = d.sameSite;
      await deps.jar.set(set);
      const back = await deps.jar.get({ url, name: set.name ?? '' });
      return back[0] ? chromeCookie(back[0]) : null;
    },
    'cookies.remove': async (ctx, [details]) => {
      const d = (details ?? {}) as { url?: string; name?: string };
      const url = needUrl(ctx, d.url);
      if (typeof d.name !== 'string') throw new ApiError('A cookie name is required');
      await deps.jar.remove(url, d.name);
      return { url, name: d.name, storeId: '0' };
    },
    'cookies.getAllCookieStores': () => [{ id: '0', tabIds: deps.allTabIds() }],
    'cookies.getPartitionKey': () => ({ partitionKey: {} }),
  };
}
