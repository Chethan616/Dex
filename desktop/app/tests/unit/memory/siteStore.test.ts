/**
 * Remembered sites and logins.
 *
 * Two properties matter most and both are about the password. It must survive
 * a round trip so a login can actually be filled later, and it must never leave
 * the module through any of the reader functions the agent can reach — only
 * getSecret, which the fill handler uses, ever returns it.
 *
 * keytar is mocked with an in-memory map, exactly as the real store would
 * serialise into it, and the sites file goes to a scratch folder, so the round
 * trip is genuine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// tests/fixtures/keytar-guard.ts: what `require('keytar')` gets under vitest.
const store = (globalThis as unknown as { __dexTestKeytar: { store: Map<string, string> } }).__dexTestKeytar.store;

const mem = await import('../../../src/main/memory/siteStore');
const { setMemoryDir } = await import('../../../src/main/memory/files');

let dir: string;
beforeEach(() => {
  store.clear();
  mem._resetCache();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-sites-'));
  setMemoryDir(dir);
});
afterEach(() => vi.clearAllMocks());

describe('site aliases', () => {
  it('resolves an exact nickname to the site', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['university portal', 'vtop']);
    const site = await mem.recallSite('university portal');
    expect(site?.host).toBe('vtop.vit.ac.in');
  });

  it('resolves loosely, so "open my uni portal" finds "uni portal"', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['uni portal']);
    const site = await mem.recallSite('open my uni portal please');
    expect(site?.host).toBe('vtop.vit.ac.in');
  });

  it('strips www and a scheme when keying by host, and keeps the full url', async () => {
    const saved = await mem.rememberSite('https://www.vtop.vit.ac.in/login', ['portal']);
    expect(saved.host).toBe('vtop.vit.ac.in');
    expect(saved.url).toBe('https://www.vtop.vit.ac.in/login');
  });

  it('merges new nicknames into an existing site rather than replacing them', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['uni portal']);
    await mem.rememberSite('vtop.vit.ac.in', ['college portal']);
    const site = await mem.recallSite('college portal');
    expect(site?.aliases).toEqual(expect.arrayContaining(['uni portal', 'college portal']));
  });

  it('returns null for a nickname it was never told', async () => {
    expect(await mem.recallSite('the tax website')).toBeNull();
  });

  it('survives a restart', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['portal']);
    mem._resetCache(); // simulate a fresh process reading the same keychain
    expect((await mem.recallSite('portal'))?.host).toBe('vtop.vit.ac.in');
  });
});

describe('logins', () => {
  it('reports that a login exists without ever returning the password', async () => {
    await mem.rememberLogin('vtop.vit.ac.in', { username: '23BXX', password: 'hunter2' });

    const recalled = await mem.recallSite('vtop.vit.ac.in');
    expect(recalled?.hasUsername).toBe(true);
    expect(recalled?.hasPassword).toBe(true);
    expect(recalled?.username).toBe('23BXX');
    // The password must not be anywhere in what the agent can read.
    expect(JSON.stringify(recalled)).not.toContain('hunter2');

    const listed = await mem.listSites();
    expect(JSON.stringify(listed)).not.toContain('hunter2');
  });

  it('hands the password only to getSecret, and only round-trips it there', async () => {
    await mem.rememberLogin('vtop.vit.ac.in', { username: '23BXX', password: 'hunter2' });
    expect(await mem.getSecret('vtop.vit.ac.in', 'password')).toBe('hunter2');
    expect(await mem.getSecret('vtop.vit.ac.in', 'username')).toBe('23BXX');
  });

  it('resolves getSecret through a nickname too, so fill works from what the user said', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['uni portal']);
    await mem.rememberLogin('vtop.vit.ac.in', { password: 'hunter2' });
    expect(await mem.getSecret('uni portal', 'password')).toBe('hunter2');
  });

  it('updates one field without wiping the other', async () => {
    await mem.rememberLogin('vtop.vit.ac.in', { username: '23BXX', password: 'old' });
    await mem.rememberLogin('vtop.vit.ac.in', { password: 'new' });
    expect(await mem.getSecret('vtop.vit.ac.in', 'username')).toBe('23BXX');
    expect(await mem.getSecret('vtop.vit.ac.in', 'password')).toBe('new');
  });

  it('returns null secret for a site with no stored login', async () => {
    await mem.rememberSite('example.com', ['example']);
    expect(await mem.getSecret('example.com', 'password')).toBeNull();
  });
});

describe('where it is kept', () => {
  const SERVICE = 'com.chethan616.dex.sites';

  it('keeps logins out of the file, one keychain entry per site', async () => {
    await mem.rememberSite('vtop.vit.ac.in', ['uni portal']);
    await mem.rememberLogin('vtop.vit.ac.in', { username: '23BXX', password: 'hunter2' });
    const file = fs.readFileSync(path.join(dir, 'sites.json'), 'utf-8');
    expect(file).toContain('uni portal');
    expect(file).not.toContain('hunter2');
    expect(file).not.toContain('23BXX');
    expect(JSON.parse(store.get(`${SERVICE}:login:vtop.vit.ac.in`)!)).toEqual({ username: '23BXX', password: 'hunter2' });
  });

  it('holds far more sites than one keychain entry could (Windows caps one at 2,560 bytes)', async () => {
    for (let i = 0; i < 60; i += 1) await mem.rememberSite(`site${i}.example.com`, [`portal number ${i}`, `the ${i}th site`]);
    await mem.rememberLogin('site59.example.com', { password: 'p' });
    mem._resetCache();
    expect(await mem.listSites()).toHaveLength(60);
    expect(await mem.getSecret('the 59th site', 'password')).toBe('p');
    for (const v of store.values()) expect(Buffer.byteLength(v)).toBeLessThan(2560);
  });

  it('moves the old single entry over once, logins and all, then drops it', async () => {
    store.set(`${SERVICE}:sites`, JSON.stringify({
      'vtop.vit.ac.in': { host: 'vtop.vit.ac.in', url: 'https://vtop.vit.ac.in', aliases: ['vtop'], credential: { username: '23BXX', password: 'hunter2' } },
      'example.com': { host: 'example.com', aliases: ['example'] },
    }));
    expect((await mem.listSites()).map((s) => s.host).sort()).toEqual(['example.com', 'vtop.vit.ac.in']);
    expect(store.has(`${SERVICE}:sites`)).toBe(false);
    mem._resetCache();
    expect((await mem.recallSite('vtop'))?.url).toBe('https://vtop.vit.ac.in');
    expect(await mem.getSecret('vtop', 'password')).toBe('hunter2');
  });

  it('forgets a site and its login together', async () => {
    await mem.rememberLogin('vtop.vit.ac.in', { password: 'hunter2' });
    await mem.forgetSite('vtop.vit.ac.in');
    mem._resetCache();
    expect(await mem.listSites()).toEqual([]);
    expect([...store.keys()]).toEqual([]);
  });
});
