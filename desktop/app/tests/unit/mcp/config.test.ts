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
