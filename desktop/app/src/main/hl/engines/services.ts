/**
 * Connected services (MCP servers) for engines other than Claude Code.
 *
 * Claude Code reads DEX's mcp.json directly (--mcp-config). Codex and
 * BrowserCode can't, and for a long time simply got nothing: the prompt said
 * "Gmail is connected", the engine had no such tool, and it drove
 * mail.google.com in the browser instead. Each of them now starts every
 * connected server through mcp-servers/launch.mjs, which reads the command
 * and tokens from that same mcp.json — so the engine's own config carries a
 * file path and a server id, never a token.
 */
import type { SpawnContext } from './types';

/** How an engine should start one connected server. */
export interface EngineMcpLaunch {
  /** Name the engine registers it under. Prefixed so it can't collide with the user's own servers. */
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function engineServerName(id: string): string {
  return `dex_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export function engineMcpLaunches(ctx: SpawnContext): EngineMcpLaunch[] {
  if (!ctx.mcpConfigPath || !ctx.mcpServers?.length || !ctx.mcpLauncherPath) return [];
  return ctx.mcpServers.map((server) => ({
    name: engineServerName(server.id),
    // Electron's own Node, like the built-in servers: nothing to install.
    command: process.execPath,
    args: [ctx.mcpLauncherPath!, ctx.mcpConfigPath!, server.id],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }));
}

/** A TOML string for a `codex -c key=value` override. */
function tomlString(value: string): string {
  // Literal strings keep Windows backslashes as-is and contain no double
  // quotes for a .cmd shim to mangle; fall back to a basic string otherwise.
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
}

/** `-c mcp_servers.<name>.…` overrides that register every connected server with Codex. */
export function codexMcpOverrides(ctx: SpawnContext): string[] {
  const out: string[] = [];
  for (const launch of engineMcpLaunches(ctx)) {
    const key = `mcp_servers.${launch.name}`;
    const env = Object.entries(launch.env).map(([k, v]) => `${k}=${tomlString(v)}`).join(',');
    out.push(
      '-c', `${key}.command=${tomlString(launch.command)}`,
      '-c', `${key}.args=[${launch.args.map(tomlString).join(',')}]`,
      '-c', `${key}.env={${env}}`,
      // npx fetches the GitHub server on first use; Codex's default 10s is too short for that.
      '-c', `${key}.startup_timeout_sec=90`,
      '-c', `${key}.tool_timeout_sec=120`,
    );
  }
  return out;
}

/** OpenCode's `mcp` config block (BrowserCode). */
export function openCodeMcpConfig(ctx: SpawnContext): Record<string, unknown> | undefined {
  const launches = engineMcpLaunches(ctx);
  if (launches.length === 0) return undefined;
  return Object.fromEntries(launches.map((launch) => [launch.name, {
    type: 'local',
    command: [launch.command, ...launch.args],
    environment: launch.env,
    enabled: true,
    timeout: 90_000,
  }]));
}

/** Prompt lines naming the connected services, in terms any engine understands. */
export function servicesBriefing(ctx: SpawnContext): string[] {
  const launches = engineMcpLaunches(ctx);
  if (launches.length === 0 || !ctx.mcpServers) return [];
  const lines = ctx.mcpServers.map((server) => {
    const tools = server.toolNames.length > 0 ? ` Its tools: ${server.toolNames.slice(0, 40).join(', ')}.` : '';
    const who = server.identity ? ` Signed in as ${server.identity} — use that account, never guess it.` : '';
    return `${server.displayName} is connected and authenticated, as the MCP server \`${engineServerName(server.id)}\`.${who}${tools}`;
  });
  return [
    '',
    ...lines,
    'These MCP tools are already available to you. Use them for anything involving these services — e.g. "check my latest mail" is the Gmail tools, not gmail.com. Do not open their websites or use any other browser tool for them: the API is faster and uses the account the user connected. Fall back to the browser only if a tool call actually returns an error.',
  ];
}
