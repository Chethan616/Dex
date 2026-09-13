/**
 * Remembered sites and logins.
 *
 * Two properties matter most and both are about the password. It must survive
 * a round trip so a login can actually be filled later, and it must never leave
 * the module through any of the reader functions the agent can reach — only
 * getSecret, which the fill handler uses, ever returns it.
 *
 * keytar is mocked with an in-memory blob, exactly as the real store would
 * serialise it, so the round trip is genuine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const store = new Map<string, string>();
vi.mock('keytar', () => ({
  getPassword: async (s: string, a: string) => store.get(`${s}:${a}`) ?? null,
  setPassword: async (s: string, a: string, p: string) => { store.set(`${s}:${a}`, p); },
  deletePassword: async (s: string, a: string) => store.delete(`${s}:${a}`),
}));

const mem = await import('../../../src/main/memory/siteStore');

beforeEach(() => {
  store.clear();
  mem._resetCache();
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
