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
 * DEX's built-in Google server returns `drive_search` hits as a JSON array
 * ({ name, mimeType, modified, link, owner }). Anything that doesn't parse is
 * treated as one result per non-empty line, so a text reply still shows up.
 */
function parseDriveResults(text: string): DriveItem[] {
  try {
    const rows = JSON.parse(text) as Array<{ name?: string; mimeType?: string; modified?: string; owner?: string }>;
    if (Array.isArray(rows)) {
      return rows.map((row) => ({
        label: row.name ?? 'Untitled',
        reasons: ['from Google Drive', ...(row.owner ? [`owner ${row.owner}`] : [])],
      }));
    }
  } catch {
    // fall through to line parsing
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ label: line, reasons: ['from Google Drive'] }));
}

export async function searchDrive(query: string, limit: number): Promise<DriveSearchResult> {
  const connections = await enabledConnections();
  const google = connections.find((c) => c.id === 'google');
  if (!google) return { ok: false, items: [], error: 'Google isn’t connected — Settings → Accounts → Continue with Google.' };

  const definition = findServerDefinition('google');
  if (!definition) return { ok: false, items: [], error: 'Google is not in the server catalogue.' };

  const result = await callServerTool(definition, google.values, 'drive_search', { query, max_results: limit });
  if (!result.ok) return { ok: false, items: [], error: result.error };

  return { ok: true, items: parseDriveResults(result.text ?? '').slice(0, limit) };
}
