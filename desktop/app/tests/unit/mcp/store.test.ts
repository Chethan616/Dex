/**
 * The MCP connection store (main/mcp/store.ts) against a credential store
 * that behaves like Windows Credential Manager: an entry over 2,560 bytes is
 * refused with keytar's "The stub received bad data".
 */
import Module from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const vault = new Map<string, string>();
let failWrites = false;
const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function load(request, parent, isMain) {
  if (request === 'keytar') {
    return {
      getPassword: async (s: string, a: string) => vault.get(`${s}/${a}`) ?? null,
      setPassword: async (s: string, a: string, v: string) => {
        if (failWrites) throw new Error('keychain unavailable');
        if (Buffer.byteLength(v) > 2560) throw new Error('The stub received bad data.\r\n');
        vault.set(`${s}/${a}`, v);
      },
      deletePassword: async (s: string, a: string) => vault.delete(`${s}/${a}`),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const SERVICE = 'com.chethan616.dex.mcp';
const fresh = async () => {
  vi.resetModules();
  return import('../../../src/main/mcp/store');
};

describe('MCP connection store', () => {
  beforeEach(() => {
    vault.clear();
    failWrites = false;
  });

  it('keeps more than Windows fits in one entry, and reads it back after a restart', async () => {
    const store = await fresh();
    const jwt = 'eyJ' + 'x'.repeat(1800);
    for (const id of ['remote_atlassian', 'remote_linear', 'remote_notion']) {
      await store.setConnection(id, { enabled: true, values: { ACCESS_TOKEN: `${id}-${jwt}`, REFRESH_TOKEN: 'r'.repeat(300) }, toolNames: Array.from({ length: 40 }, (_, i) => `tool_${i}`) });
    }
    for (const value of vault.values()) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(2560);

    const again = await fresh();
    const ids = (await again.listConnections()).map((c) => c.id);
    expect(ids).toEqual(['remote_atlassian', 'remote_linear', 'remote_notion']);
    expect((await again.enabledConnections())[1].values.ACCESS_TOKEN).toBe(`remote_linear-${jwt}`);
  });

  it('reads connections saved before parts existed', async () => {
    vault.set(`${SERVICE}/connections`, JSON.stringify({ github: { id: 'github', enabled: true, values: { GITHUB_TOKEN: 'gh' } } }));
    const store = await fresh();
    expect((await store.enabledConnections())[0]).toMatchObject({ id: 'github', values: { GITHUB_TOKEN: 'gh' } });
    await store.setConnection('slack', { enabled: true, values: { SLACK_BOT_TOKEN: 's' } });
    expect((await (await fresh()).listConnections()).map((c) => c.id)).toEqual(['github', 'slack']);
  });

  it('a failed save keeps what was there, and cleans up old parts after a good one', async () => {
    const store = await fresh();
    await store.setConnection('github', { enabled: true, values: { GITHUB_TOKEN: 'g'.repeat(3000) } });
    const partsBefore = [...vault.keys()].filter((k) => k.includes('#')).length;
    expect(partsBefore).toBeGreaterThan(1);

    failWrites = true;
    await expect(store.setConnection('slack', { enabled: true, values: { SLACK_BOT_TOKEN: 's' } })).rejects.toThrow(/OS credential store/);
    failWrites = false;
    expect((await (await fresh()).listConnections()).map((c) => c.id)).toEqual(['github']);

    const again = await fresh();
    await again.setConnection('github', { values: { GITHUB_TOKEN: 'short' } });
    expect([...vault.keys()].filter((k) => k.includes('#'))).toHaveLength(1);
  });

  it('never cuts a character in half', async () => {
    const { splitUtf8 } = await fresh();
    const text = '₹'.repeat(1500);
    const parts = splitUtf8(text, 2000);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(2000);
  });
});
