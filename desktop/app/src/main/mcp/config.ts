/**
 * Turning enabled connections into something the engines understand.
 *
 * Claude Code and Codex both speak MCP, but they read their server lists from
 * different places and in different formats. Rather than teach each adapter
 * about connections, this produces the files and lets the adapters pass a
 * path — the adapters stay about spawning, and the knowledge of what an MCP
 * config looks like stays in one file.
 *
 * A server with missing credentials is deliberately omitted rather than
 * written out half-formed: an engine that fails to start a server reports it
 * as a broken tool mid-task, which is a much worse way to find out than a gap
 * in Settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';
import { findServerDefinition, missingCredentials, type McpServerDefinition } from './catalog';

export interface ResolvedMcpServer {
  definition: McpServerDefinition;
  /** Credential key/value pairs, already resolved from the secret store. */
  values: Record<string, string>;
}

/** The `mcpServers` shape Claude Code reads from --mcp-config. */
interface ClaudeMcpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

export function buildClaudeMcpConfig(servers: ResolvedMcpServer[]): ClaudeMcpConfig {
  const mcpServers: ClaudeMcpConfig['mcpServers'] = {};
  for (const { definition, values } of servers) {
    mcpServers[definition.id] = {
      command: definition.command,
      args: definition.args,
      env: { ...definition.env, ...values },
    };
  }
  return { mcpServers };
}

/**
 * Keep only servers that can actually start.
 *
 * Logs what it dropped and why: a connection the user believes is on but which
 * is silently absent from every task is precisely the class of failure this
 * codebase has spent the most time on.
 */
export function usableServers(
  enabled: Array<{ id: string; values: Record<string, string> }>,
): ResolvedMcpServer[] {
  const usable: ResolvedMcpServer[] = [];

  for (const entry of enabled) {
    const definition = findServerDefinition(entry.id);
    if (!definition) {
      mainLogger.warn('mcp.config.unknownServer', { id: entry.id });
      continue;
    }
    const missing = missingCredentials(definition, entry.values);
    if (missing.length > 0) {
      mainLogger.warn('mcp.config.incomplete', {
        id: entry.id,
        missing: missing.map((field) => field.key),
      });
      continue;
    }
    usable.push({ definition, values: entry.values });
  }

  return usable;
}

/**
 * Write the config next to the harness and return its path.
 *
 * Returns null when nothing is usable, which the adapters read as "do not pass
 * --mcp-config at all". Passing an empty config would be harmless but it makes
 * the spawn command misleading when debugging.
 */
export function writeClaudeMcpConfig(harnessDir: string, servers: ResolvedMcpServer[]): string | null {
  if (servers.length === 0) return null;

  const target = path.join(harnessDir, 'mcp.json');
  try {
    fs.writeFileSync(target, JSON.stringify(buildClaudeMcpConfig(servers), null, 2), {
      encoding: 'utf-8',
      // The file holds API tokens in plain text. It lives in userData, which
      // is already per-user, but there is no reason for it to be readable
      // beyond the account that owns it.
      mode: 0o600,
    });
    mainLogger.info('mcp.config.wrote', { target, servers: servers.map((s) => s.definition.id) });
    return target;
  } catch (err) {
    mainLogger.error('mcp.config.write.failed', { target, error: (err as Error).message });
    return null;
  }
}

/** Remove a stale config when every connection has been switched off. */
export function clearMcpConfig(harnessDir: string): void {
  const target = path.join(harnessDir, 'mcp.json');
  try {
    fs.rmSync(target, { force: true });
  } catch (err) {
    mainLogger.warn('mcp.config.clear.failed', { target, error: (err as Error).message });
  }
}
