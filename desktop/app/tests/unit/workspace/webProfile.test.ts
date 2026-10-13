import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanUserAgent, cookieToSet, copyCookies, migrateCookiesOnce, type CookieJar } from '../../../src/main/workspace/webProfile';

function cookie(over: Partial<Electron.Cookie>): Electron.Cookie {
  return {
    name: 'sid', value: 'v', domain: '.example.com', hostOnly: false, path: '/',
    secure: true, httpOnly: true, session: false, expirationDate: Date.now() / 1000 + 3600, sameSite: 'lax',
    ...over,
  } as Electron.Cookie;
}

function jar(initial: Electron.Cookie[] = []): CookieJar & { written: Electron.CookiesSetDetails[] } {
  const written: Electron.CookiesSetDetails[] = [];
  return {
    written,
    get: async () => initial,
    set: async (d) => {
      if (d.name === 'boom') throw new Error('refused');
      written.push(d);
    },
    flushStore: async () => undefined,
  };
}

describe('cookieToSet', () => {
  it('keeps a domain cookie a domain cookie', () => {
    const d = cookieToSet(cookie({}))!;
    expect(d.url).toBe('https://example.com/');
    expect(d.domain).toBe('.example.com');
    expect(d.httpOnly).toBe(true);
    expect(d.sameSite).toBe('lax');
  });

  it('writes a host-only cookie without a domain, so it stays host-only', () => {
    const d = cookieToSet(cookie({ domain: 'mail.example.com', hostOnly: true }))!;
    expect(d.url).toBe('https://mail.example.com/');
    expect(d.domain).toBeUndefined();
  });

  it('keeps __Host- cookies host-only, and skips ones that break their rules', () => {
    expect(cookieToSet(cookie({ name: '__Host-id', domain: 'example.com', hostOnly: false }))!.domain).toBeUndefined();
    expect(cookieToSet(cookie({ name: '__Host-id', path: '/app' }))).toBeNull();
    expect(cookieToSet(cookie({ name: '__Host-id', secure: false }))).toBeNull();
  });

  it('uses http for a cookie that is not secure, and keeps its path', () => {
    expect(cookieToSet(cookie({ secure: false, path: '/a' }))!.url).toBe('http://example.com/a');
  });

  it('leaves session cookies without an expiry, and skips expired ones', () => {
    expect(cookieToSet(cookie({ session: true, expirationDate: undefined }))!.expirationDate).toBeUndefined();
    expect(cookieToSet(cookie({ expirationDate: Date.now() / 1000 - 5 }))).toBeNull();
  });
});

describe('copyCookies', () => {
  it('copies every live cookie and counts what it skipped and what failed', async () => {
    const from = jar([cookie({ name: 'a' }), cookie({ name: 'b', expirationDate: 1 }), cookie({ name: 'boom' })]);
    const to = jar();
    const result = await copyCookies(from, to, 2);
    expect(result).toEqual({ copied: 1, skipped: 1, failed: 1 });
    expect(to.written.map((d) => d.name)).toEqual(['a']);
  });
});

describe('migrateCookiesOnce', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-webprofile-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('copies on the first start and never again', async () => {
    const from = jar([cookie({ name: 'a' }), cookie({ name: 'b' })]);
    const to = jar();
    expect(await migrateCookiesOnce({ userDataPath: dir, from, to })).toEqual({ copied: 2, skipped: 0, failed: 0 });
    expect(fs.existsSync(path.join(dir, 'web-profile.json'))).toBe(true);
    expect(await migrateCookiesOnce({ userDataPath: dir, from, to })).toBeNull();
    expect(to.written).toHaveLength(2);
  });

  it('copies again when the marker is unreadable', async () => {
    fs.writeFileSync(path.join(dir, 'web-profile.json'), '{not json');
    const to = jar();
    await migrateCookiesOnce({ userDataPath: dir, from: jar([cookie({})]), to });
    expect(to.written).toHaveLength(1);
  });
});

describe('cleanUserAgent', () => {
  it("drops Electron's token and the app's own", () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dex/1.0.0 Chrome/146.0.0.0 Electron/41.2.1 Safari/537.36';
    expect(cleanUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');
  });
});
