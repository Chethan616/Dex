#!/usr/bin/env node
/**
 * launch.mjs <mcp.json> <server-id>
 *
 * Starts one of DEX's connected MCP servers for an engine that can't read
 * Claude's mcp.json itself (Codex, BrowserCode). Their config then names only
 * this launcher, a file path and a server id — the tokens stay in DEX's
 * private mcp.json (userData, mode 0600) instead of on a command line, in a
 * process listing, or in DEX's own spawn log.
 *
 * Runs under Electron's Node (ELECTRON_RUN_AS_NODE=1), like the built-in
 * servers, so nothing needs installing. stdio is passed straight through:
 * the server speaks MCP to the engine directly.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [configPath, serverId] = process.argv.slice(2);
if (!configPath || !serverId) {
  process.stderr.write('usage: launch.mjs <mcp.json> <server-id>\n');
  process.exit(2);
}

let server;
try {
  server = JSON.parse(fs.readFileSync(configPath, 'utf-8')).mcpServers?.[serverId];
} catch (err) {
  process.stderr.write(`dex mcp launcher: cannot read ${configPath}: ${err.message}\n`);
  process.exit(1);
}
if (!server?.command) {
  process.stderr.write(`dex mcp launcher: no server "${serverId}" in ${configPath}\n`);
  process.exit(1);
}

// npx is a .cmd shim on Windows and needs a shell; an .exe path must not get one.
const needsShell = process.platform === 'win32' && !/\.exe$/i.test(server.command);
// With a shell, pass one command line: Node deprecates separate args + shell.
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const child = spawn(
  needsShell ? [server.command, ...(server.args ?? [])].map(quote).join(' ') : server.command,
  needsShell ? [] : server.args ?? [],
  {
  stdio: 'inherit',
  env: { ...process.env, ...(server.env ?? {}) },
  shell: needsShell,
  windowsHide: true,
  },
);
child.on('error', (err) => {
  process.stderr.write(`dex mcp launcher: ${serverId} failed to start: ${err.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
