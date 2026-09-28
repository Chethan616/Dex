import { describe, expect, it } from 'vitest';
import { codexMcpOverrides, openCodeMcpConfig, servicesBriefing } from '../../../src/main/hl/engines/services';
import type { SpawnContext } from '../../../src/main/hl/engines/types';

const base = {
  prompt: 'check my latest mail',
  harnessDir: 'C:\\Users\\me\\AppData\\Roaming\\DEX\\harness',
  sessionId: 's1',
  targetId: 't1',
  cdpPort: 9223,
  attachmentRefs: [] as SpawnContext['attachmentRefs'],
} satisfies Partial<SpawnContext>;

const connected: SpawnContext = {
  ...base,
  mcpConfigPath: 'C:\\Users\\me\\AppData\\Roaming\\DEX\\harness\\mcp.json',
  mcpLauncherPath: 'C:\\Program Files\\DEX\\mcp-servers\\launch.mjs',
  mcpServers: [{ id: 'google', displayName: 'Google', identity: 'me@gmail.com', toolNames: ['gmail_search'] }],
};

describe('connected services for Codex / BrowserCode', () => {
  it('registers each server with Codex via the launcher — paths only, no tokens', () => {
    const args = codexMcpOverrides(connected);
    expect(args).toContain(`mcp_servers.dex_google.args=['C:\\Program Files\\DEX\\mcp-servers\\launch.mjs','C:\\Users\\me\\AppData\\Roaming\\DEX\\harness\\mcp.json','google']`);
    expect(args).toContain(`mcp_servers.dex_google.env={ELECTRON_RUN_AS_NODE='1'}`);
    expect(args.join(' ')).not.toMatch(/TOKEN|SECRET/);
  });

  it('gives OpenCode the same servers', () => {
    const mcp = openCodeMcpConfig(connected) as Record<string, { type: string; command: string[] }>;
    expect(mcp.dex_google.type).toBe('local');
    expect(mcp.dex_google.command.slice(1)).toEqual([connected.mcpLauncherPath, connected.mcpConfigPath, 'google']);
  });

  it('briefs the agent to use the tools, not the website', () => {
    const text = servicesBriefing(connected).join('\n');
    expect(text).toContain('dex_google');
    expect(text).toContain('me@gmail.com');
    expect(text).toMatch(/not gmail\.com/);
  });

  it('adds nothing when no service is connected', () => {
    expect(codexMcpOverrides(base as SpawnContext)).toEqual([]);
    expect(openCodeMcpConfig(base as SpawnContext)).toBeUndefined();
    expect(servicesBriefing(base as SpawnContext)).toEqual([]);
  });
});
