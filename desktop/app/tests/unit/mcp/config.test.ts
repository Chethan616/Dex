/**
 * MCP config generation.
 *
 * The failure this guards against is the quiet one: a connection the user
 * switched on in Settings that never reaches the agent, so the task falls back
 * to driving a website and nobody can see why. A server must therefore either
 * appear in the config completely, or be dropped with a logged reason — never
 * be written out half-formed for the engine to choke on mid-task.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/main/accounts/oauthClients', () => ({
  oauthClient: (provider: string) => provider === 'reddit' ? { clientId: 'reddit-client-id' } : null,
}));

const { buildClaudeMcpConfig, usableServers, writeClaudeMcpConfig, clearMcpConfig } = await import(
  '../../../src/main/mcp/config'
);
const { findServerDefinition } = await import('../../../src/main/mcp/catalog');

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mcp-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const GITHUB_OK = { id: 'github', values: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' } };

describe('usableServers', () => {
  it('keeps a fully configured server', () => {
    const usable = usableServers([GITHUB_OK]);
    expect(usable).toHaveLength(1);
    expect(usable[0].definition.id).toBe('github');
  });

  // Half-configured is worse than absent: the engine starts, the server fails,
  // and the user finds out as a broken tool in the middle of a task.
  it('drops a server whose required credential is missing', () => {
    expect(usableServers([{ id: 'github', values: {} }])).toHaveLength(0);
  });

  it('treats blank and whitespace-only credentials as missing', () => {
    expect(usableServers([{ id: 'github', values: { GITHUB_PERSONAL_ACCESS_TOKEN: '   ' } }])).toHaveLength(0);
  });

  it('drops a server id that is not in the catalogue', () => {
    expect(usableServers([{ id: 'not-a-real-server', values: {} }])).toHaveLength(0);
  });

  it('requires every credential, not just the first', () => {
    const slack = findServerDefinition('slack');
    expect(slack?.credentials.length).toBeGreaterThan(1);
    expect(usableServers([{ id: 'slack', values: { SLACK_BOT_TOKEN: 'xoxb-1' } }])).toHaveLength(0);
    expect(
      usableServers([{ id: 'slack', values: { SLACK_BOT_TOKEN: 'xoxb-1', SLACK_TEAM_ID: 'T1' } }]),
    ).toHaveLength(1);
  });
});

describe('buildClaudeMcpConfig', () => {
  it('produces the mcpServers shape Claude Code reads', () => {
    const config = buildClaudeMcpConfig(usableServers([GITHUB_OK]));
    expect(config.mcpServers.github.command).toBe('npx');
    expect(config.mcpServers.github.args).toContain('@modelcontextprotocol/server-github');
    expect(config.mcpServers.github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_example');
  });

  it('is empty when nothing is enabled', () => {
    expect(Object.keys(buildClaudeMcpConfig([]).mcpServers)).toHaveLength(0);
  });

  it('keeps Reddit refresh tokens out of MCP config and the npx launch environment', () => {
    const server = usableServers([{
      id: 'reddit',
      values: { REDDIT_REFRESH_TOKEN: 'long-lived-refresh-token', REDDIT_USERNAME: 'reddit-user' },
    }])[0];
    const { command, args, env } = buildClaudeMcpConfig([server]).mcpServers.reddit;
    expect(command).not.toBe('npx');
    expect(args.at(-1)).toMatch(/mcp-servers[\\/]reddit[\\/]server\.mjs$/);
    expect(env).toMatchObject({ DEX_REDDIT_CLIENT_ID: 'reddit-client-id', DEX_REDDIT_USERNAME: 'reddit-user' });
    expect(env).not.toHaveProperty('REDDIT_REFRESH_TOKEN');
    expect(env).not.toHaveProperty('DEX_REDDIT_REFRESH_TOKEN');
    expect(env).not.toHaveProperty('REDDIT_CLIENT_SECRET');
    expect(env).not.toHaveProperty('REDDIT_PASSWORD');
    expect(JSON.stringify({ command, args, env })).not.toContain('long-lived-refresh-token');
  });
});

describe('Reddit credential bridge', () => {
  it('installs without Reddit credentials, then gives only the MCP process the refresh token', async () => {
    const { cleanRedditInstallerEnvironment, redditMcpEnvironment } = await import('../../../mcp-servers/reddit/server.mjs');
    const source = {
      PATH: 'path',
      DEX_REDDIT_CLIENT_ID: 'reddit-client-id',
      DEX_REDDIT_USERNAME: 'reddit-user',
      DEX_REDDIT_REFRESH_TOKEN: 'long-lived-refresh-token',
      REDDIT_REFRESH_TOKEN: 'long-lived-refresh-token',
      REDDIT_CLIENT_SECRET: 'old-secret',
      REDDIT_PASSWORD: 'should-never-exist',
      NODE_OPTIONS: '--trace-warnings',
    };
    const installer = cleanRedditInstallerEnvironment(source);
    expect(installer).not.toHaveProperty('DEX_REDDIT_REFRESH_TOKEN');
    expect(installer).not.toHaveProperty('REDDIT_REFRESH_TOKEN');
    expect(installer).not.toHaveProperty('REDDIT_CLIENT_SECRET');
    expect(installer).not.toHaveProperty('REDDIT_PASSWORD');

    const mcp = redditMcpEnvironment(source, {
      token: 'long-lived-refresh-token',
      username: 'reddit-user',
      bridgePath: 'C:\\DEX\\oauth-bridge.mjs',
    });
    expect(mcp.DEX_REDDIT_REFRESH_TOKEN).toBe('long-lived-refresh-token');
    expect(mcp).not.toHaveProperty('REDDIT_REFRESH_TOKEN');
    expect(mcp).not.toHaveProperty('REDDIT_PASSWORD');
    expect(mcp.REDDIT_CLIENT_SECRET).toBe('dex-installed-public-client');
    expect(mcp.REDDIT_CLIENT_ID).toBe('reddit-client-id');
    expect(mcp.REDDIT_USERNAME).toBe('reddit-user');
  });

  it('overrides upstream password-grant requests with the saved OAuth refresh token', async () => {
    const { installRedditOAuthBridge } = await import('../../../mcp-servers/reddit/oauth-bridge.mjs');
    const originalFetch = globalThis.fetch;
    let request: { url: string; init?: RequestInit } | undefined;
    try {
      installRedditOAuthBridge({
        fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
          request = { url: String(input), init };
          return new Response('{}', { status: 200 });
        },
        refreshToken: 'long-lived-refresh-token',
        clientId: 'reddit-client-id',
      });
      await globalThis.fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'password', username: 'ignored', password: 'ignored' }),
      });
      expect(request?.url).toBe('https://www.reddit.com/api/v1/access_token');
      expect(new Headers(request?.init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('reddit-client-id:').toString('base64')}`);
      expect(new URLSearchParams(String(request?.init?.body))).toEqual(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'long-lived-refresh-token' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('writeClaudeMcpConfig', () => {
  it('writes valid JSON that round-trips', () => {
    const dir = tempDir();
    const target = writeClaudeMcpConfig(dir, usableServers([GITHUB_OK]));

    expect(target).toBe(path.join(dir, 'mcp.json'));
    const parsed = JSON.parse(fs.readFileSync(target as string, 'utf-8'));
    expect(parsed.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_example');
  });

  // Null is the adapters' signal to omit --mcp-config entirely. An empty
  // config would work but makes the spawn command lie about what is loaded.
  it('returns null and writes nothing when there is nothing to write', () => {
    const dir = tempDir();
    expect(writeClaudeMcpConfig(dir, [])).toBeNull();
    expect(fs.existsSync(path.join(dir, 'mcp.json'))).toBe(false);
  });

  it('clears a stale config when every connection is switched off', () => {
    const dir = tempDir();
    writeClaudeMcpConfig(dir, usableServers([GITHUB_OK]));
    expect(fs.existsSync(path.join(dir, 'mcp.json'))).toBe(true);

    clearMcpConfig(dir);
    expect(fs.existsSync(path.join(dir, 'mcp.json'))).toBe(false);
  });

  it('does not throw when the directory does not exist', () => {
    const missing = path.join(tempDir(), 'nope', 'deeper');
    expect(() => writeClaudeMcpConfig(missing, usableServers([GITHUB_OK]))).not.toThrow();
  });
});
