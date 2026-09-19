/**
 * The Drive half of `@drive` search. Local search (query.ts) reads its own
 * SQLite index synchronously; this is the one side of a `dex-find --drive`
 * call that is actually slow, and the reason the route runs both through
 * `Promise.all` rather than one after the other.
 */
import { findServerDefinition } from '../mcp/catalog';
import { enabledConnections } from '../mcp/store';
import { callServerTool } from '../mcp/toolCall';

export interface DriveItem {
  label: string;
  reasons: string[];
}

export interface DriveSearchResult {
  ok: boolean;
  items: DriveItem[];
  error?: string;
}

/**
 * The reference `@modelcontextprotocol/server-gdrive` package returns search
 * hits as freeform text, one file per line, rather than structured JSON —
 * so parsing here is intentionally undemanding: a non-empty line is a result.
 * Good enough to merge into the artifact card; the agent can always ask Drive
 * directly through its own MCP tools for anything more detailed.
 */
function parseDriveText(text: string): DriveItem[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ label: line, reasons: ['from Google Drive'] }));
}

export async function searchDrive(query: string, limit: number): Promise<DriveSearchResult> {
  const connections = await enabledConnections();
  const drive = connections.find((c) => c.id === 'google-drive');
  if (!drive) return { ok: false, items: [], error: 'Google Drive is not connected.' };

  const definition = findServerDefinition('google-drive');
  if (!definition) return { ok: false, items: [], error: 'Google Drive is not in the server catalogue.' };

  // Verification (mcp/client.ts) already recorded the server's real tool
  // names; prefer whichever one looks like a search rather than hard-coding a
  // name that could drift with the upstream package.
  const toolName = drive.toolNames?.find((name) => /search/i.test(name)) ?? drive.toolNames?.[0];
  if (!toolName) return { ok: false, items: [], error: 'Google Drive has not been verified yet — no known tools.' };

  const result = await callServerTool(definition, drive.values, toolName, { query });
  if (!result.ok) return { ok: false, items: [], error: result.error };

  return { ok: true, items: parseDriveText(result.text ?? '').slice(0, limit) };
}
