/**
 * The web profile: one browser profile every task's tabs share
 * (docs/unify/PLAN.md §4.1).
 *
 * Task tabs used to live in Electron's default session, next to DEX's own
 * windows (the hub, Logs, the pill). Giving them their own persistent
 * partition does two things:
 * - your logins, history and site data are one profile, the way a browser
 *   works, and DEX's own windows aren't part of it;
 * - Chrome extensions (P3) load into this profile only, so no extension can
 *   ever run inside the hub or read its pages.
 *
 * Moving to a new partition would sign you out of every site, so the first
 * run after the upgrade copies the default session's cookies across once.
 * The default session keeps its copy: nothing reads it any more, and a copy
 * that went wrong could then be redone instead of being lost.
 */
import fs from 'node:fs';
import path from 'node:path';

export const WEB_PARTITION = 'persist:dex-web';

/** Bump to copy again on the next start (only if a copy was ever wrong). */
const MIGRATION_VERSION = 1;
const MARKER_FILE = 'web-profile.json';

/** What a cookie jar needs to offer here: Electron's `session.cookies`. */
export interface CookieJar {
  get(filter: Record<string, never>): Promise<Electron.Cookie[]>;
  set(details: Electron.CookiesSetDetails): Promise<void>;
  flushStore?(): Promise<void>;
}

export interface CopyResult { copied: number; skipped: number; failed: number }

/**
 * How to write `c` into another jar so it comes out the same: host-only
 * cookies stay host-only (no `domain`), `__Host-` ones keep their rules, and
 * the URL's scheme matches `secure`. Null for a cookie not worth copying.
 */
export function cookieToSet(c: Electron.Cookie, nowSec = Date.now() / 1000): Electron.CookiesSetDetails | null {
  if (!c.name) return null;
  if (!c.session && typeof c.expirationDate === 'number' && c.expirationDate <= nowSec) return null;
  const host = (c.domain ?? '').replace(/^\./, '');
  if (!host) return null;
  const cookiePath = c.path || '/';
  // __Host- cookies must be secure, host-only and on "/"; Chromium refuses
  // anything else, so one that isn't can't be recreated faithfully.
  if (c.name.startsWith('__Host-') && (cookiePath !== '/' || !c.secure)) return null;
  const hostOnly = c.hostOnly === true || c.name.startsWith('__Host-');
  return {
    url: `${c.secure ? 'https' : 'http'}://${host}${cookiePath}`,
    name: c.name,
    value: c.value,
    ...(hostOnly ? {} : { domain: c.domain }),
    path: cookiePath,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(c.session || typeof c.expirationDate !== 'number' ? {} : { expirationDate: c.expirationDate }),
  };
}

/** Copy every live cookie from one jar to the other, a batch at a time. */
export async function copyCookies(from: CookieJar, to: CookieJar, batch = 50): Promise<CopyResult> {
  const all = await from.get({});
  const result: CopyResult = { copied: 0, skipped: 0, failed: 0 };
  const sets: Electron.CookiesSetDetails[] = [];
  for (const c of all) {
    const details = cookieToSet(c);
    if (details) sets.push(details);
    else result.skipped++;
  }
  for (let i = 0; i < sets.length; i += batch) {
    const outcomes = await Promise.allSettled(sets.slice(i, i + batch).map((d) => to.set(d)));
    for (const o of outcomes) {
      if (o.status === 'fulfilled') result.copied++;
      else result.failed++;
    }
  }
  await to.flushStore?.().catch(() => undefined);
  return result;
}

/**
 * Copy the default session's cookies into the web profile, once per
 * install. The marker is written only after the copy finished, so a start
 * that was killed halfway copies again (setting a cookie twice is harmless).
 */
export async function migrateCookiesOnce(opts: {
  userDataPath: string;
  from: CookieJar;
  to: CookieJar;
  log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<CopyResult | null> {
  const marker = path.join(opts.userDataPath, MARKER_FILE);
  try {
    const done = JSON.parse(fs.readFileSync(marker, 'utf8')) as { version?: number };
    if ((done.version ?? 0) >= MIGRATION_VERSION) return null;
  } catch { /* no marker yet: copy */ }
  const started = Date.now();
  const result = await copyCookies(opts.from, opts.to);
  try {
    fs.mkdirSync(opts.userDataPath, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ version: MIGRATION_VERSION, migratedAt: new Date().toISOString(), ...result }, null, 2));
  } catch (err) {
    opts.log?.('webProfile.marker.writeFailed', { error: (err as Error).message });
  }
  opts.log?.('webProfile.cookies.migrated', { ...result, ms: Date.now() - started });
  return result;
}

/** Chrome's UA without Electron's two tells (the app token and `Electron/x`). */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/\sElectron\/\S+/, '')
    .replace(/\s[A-Za-z][\w-]*\/\d+\.\d+\.\d+(?=\sChrome\/)/, '');
}

let webSessionRef: Electron.Session | null = null;

/** The web profile's session, once `prepareWebProfile` has run. */
export function webSession(): Electron.Session | null {
  return webSessionRef;
}

/**
 * Open the web profile: the session, its clean user agent, and the one-time
 * cookie copy. Call once, after `app` is ready and before any tab exists.
 */
export async function prepareWebProfile(opts: {
  userDataPath: string;
  log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<Electron.Session> {
  const { session } = await import('electron');
  const web = session.fromPartition(WEB_PARTITION);
  // Requests a page's scripts and service workers make carry the session's
  // UA, not the tab's, so clean it here too.
  try { web.setUserAgent(cleanUserAgent(web.getUserAgent())); } catch { /* keep Chromium's */ }
  try {
    await migrateCookiesOnce({ userDataPath: opts.userDataPath, from: session.defaultSession.cookies, to: web.cookies, log: opts.log });
  } catch (err) {
    opts.log?.('webProfile.cookies.migrateFailed', { error: (err as Error).message });
  }
  webSessionRef = web;
  return web;
}
