/**
 * File-search candidates, sourced from the Windows Search index.
 *
 * DEX used to build and maintain its own SQLite FTS5 index of the user's
 * files. That index reached 3.4 GB in real use and — because better-sqlite3
 * is synchronous and the indexer ran in the Electron main process — its
 * writes competed directly with the one thread serving every IPC call the
 * UI makes. Windows already maintains exactly this index, continuously,
 * out of our process, including text extracted from PDFs and Office
 * documents. Querying it costs nothing until someone actually searches.
 *
 * The query runs in a short-lived PowerShell child rather than in-process:
 * the OLE DB provider (`Search.CollatorDSO`) has no Node binding, and
 * shelling out is what keeps the zero-cost claim structural — the main
 * thread only reads a JSON file, it never touches a database. Same pattern
 * the codebase already uses for dex-sh and chrome-import.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SearchCandidate } from './rank';
import { mainLogger } from '../logger';

const QUERY_TIMEOUT_MS = 8_000;
/** Per-file snippet cap — see the note on buildScript() for why this matters. */
const SNIPPET_CHARS = 2_000;

export interface WinSearchOutcome {
  ok: boolean;
  candidates: SearchCandidate[];
  /** Why the search produced nothing useful, when it did not simply match nothing. */
  error?: string;
}

/**
 * Quote a term for an AQS/CONTAINS predicate.
 *
 * Terms reach here from a user's query string, so they are data and are
 * never concatenated raw. Doubling an embedded single quote is the
 * documented escape for this dialect; anything that still cannot be
 * represented is dropped rather than passed through half-escaped.
 */
function quoteTerm(term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  // Control characters and backslashes have no meaning in a content match
  // and can confuse the parser — strip rather than escape.
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[\u0000-\u001F]/g, '').replace(/\\/g, ' ').trim();
  if (!cleaned) return null;
  // CONTAINS's second argument is itself a search expression, not a plain
  // string: bare whitespace in it is parsed as boolean operators, so a
  // multi-word alias like "cryptography and network security" is a syntax
  // error (verified — the provider returns DB_E_ERRORSINCOMMAND on it).
  // Wrapping in inner double quotes makes it a literal phrase instead.
  // The outer single quotes are the SQL string delimiter; an embedded
  // single quote is escaped by doubling it.
  const phrase = /\s/.test(cleaned) ? `"${cleaned.replace(/"/g, '')}"` : cleaned;
  return `'${phrase.replace(/'/g, "''")}'`;
}

export function buildQuery(terms: string[], cap: number): string | null {
  const quoted = terms.map(quoteTerm).filter((t): t is string => t !== null);
  if (quoted.length === 0) return null;

  // Match either the file's extracted text or its name — the same "any
  // term, anywhere" broad-candidate step ftsCandidates did, with the
  // relevance judgment left to rank.ts exactly as before.
  const contents = quoted.map((t) => `CONTAINS(System.Search.Contents, ${t})`).join(' OR ');
  const names = quoted.map((t) => `CONTAINS(System.ItemNameDisplay, ${t})`).join(' OR ');

  return (
    `SELECT TOP ${Math.max(1, Math.min(cap, 500))} `
    + 'System.ItemPathDisplay, System.ItemNameDisplay, System.Size, '
    + 'System.DateModified, System.Search.AutoSummary '
    + 'FROM SYSTEMINDEX '
    + `WHERE System.Kind <> 'folder' AND (${contents} OR ${names})`
  );
}

/**
 * PowerShell that runs one query and writes one JSON array to `outPath`.
 *
 * Writes a file rather than stdout on purpose: PowerShell truncated a large
 * result set partway through a string value when writing one long line to a
 * redirected stdout (observed at ~16 KB, leaving unparseable JSON).
 * `[IO.File]::WriteAllText` has no such limit and pins the encoding to
 * UTF-8, which also avoids the console codepage mangling non-ASCII names.
 *
 * The per-row snippet is capped too: AutoSummary is occasionally enormous
 * (one Windows settings-index entry returned tens of KB of nested JSON).
 * Only a snippet is ever needed — rank.ts uses it for the excerpt and match
 * reasons, and Windows Search has already done the content matching that
 * made the row a candidate in the first place.
 */
export function buildScript(outPath: string, snippetChars: number = SNIPPET_CHARS): string {
  const escapedPath = outPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    '$sql = [Console]::In.ReadToEnd()',
    'try {',
    '  $conn = New-Object -ComObject ADODB.Connection',
    '  $conn.Open("Provider=Search.CollatorDSO;Extended Properties=\'Application=Windows\'")',
    '  $rs = $conn.Execute($sql)',
    '  $rows = New-Object System.Collections.ArrayList',
    '  while (-not $rs.EOF) {',
    '    $c = $rs.Fields.Item(4).Value',
    "    if ($c -isnot [string]) { $c = '' }",
    `    if ($c.Length -gt ${snippetChars}) { $c = $c.Substring(0, ${snippetChars}) }`,
    '    $null = $rows.Add([ordered]@{',
    '      path    = $rs.Fields.Item(0).Value',
    '      name    = $rs.Fields.Item(1).Value',
    '      size    = $rs.Fields.Item(2).Value',
    '      mtime   = $rs.Fields.Item(3).Value',
    '      content = $c',
    '    })',
    '    $rs.MoveNext()',
    '  }',
    '  $conn.Close()',
    '  $json = $rows | ConvertTo-Json -Compress -Depth 3',
    `  [IO.File]::WriteAllText('${escapedPath}', $json, [Text.Encoding]::UTF8)`,
    '} catch {',
    '  $msg = ConvertTo-Json $_.Exception.Message',
    `  [IO.File]::WriteAllText('${escapedPath}', ('{"__error":' + $msg + '}'), [Text.Encoding]::UTF8)`,
    '}',
  ].join('\n');
}

interface RawRow {
  path?: unknown;
  name?: unknown;
  size?: unknown;
  mtime?: unknown;
  content?: unknown;
}

/** PowerShell serialises DateTime as "/Date(ms)/" or an ISO string depending on version. */
function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const dotnet = value.match(/\/Date\((-?\d+)\)\//);
    if (dotnet) return Number(dotnet[1]);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function parseRows(payload: string): { rows: SearchCandidate[]; error?: string } {
  const text = payload.trim();
  if (!text) return { rows: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], error: 'could not parse the Windows Search response' };
  }

  if (parsed && typeof parsed === 'object' && '__error' in (parsed as Record<string, unknown>)) {
    return { rows: [], error: String((parsed as { __error: unknown }).__error) };
  }

  // ConvertTo-Json emits a bare object (not an array) for a single row.
  const list: RawRow[] = Array.isArray(parsed) ? (parsed as RawRow[]) : [parsed as RawRow];

  const rows: SearchCandidate[] = [];
  for (const raw of list) {
    const filePath = typeof raw?.path === 'string' ? raw.path : '';
    if (!filePath) continue;
    rows.push({
      path: filePath,
      name: typeof raw.name === 'string' && raw.name ? raw.name : (filePath.split(/[\\/]/).pop() ?? filePath),
      content: typeof raw.content === 'string' ? raw.content : '',
      size: typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : 0,
      mtime: toEpochMs(raw.mtime),
    });
  }
  return { rows };
}

export async function winSearchCandidates(terms: string[], cap: number): Promise<WinSearchOutcome> {
  if (process.platform !== 'win32') {
    return { ok: false, candidates: [], error: 'Windows Search is only available on Windows' };
  }
  const sql = buildQuery(terms, cap);
  if (!sql) return { ok: true, candidates: [] };

  const outPath = path.join(os.tmpdir(), `dex-winsearch-${randomUUID()}.json`);

  return new Promise<WinSearchOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: WinSearchOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.rmSync(outPath, { force: true }); } catch { /* best effort */ }
      resolve(outcome);
    };

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildScript(outPath)],
      { windowsHide: true },
    );

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, candidates: [], error: 'Windows Search query timed out' });
    }, QUERY_TIMEOUT_MS);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (err) => {
      finish({ ok: false, candidates: [], error: `could not run the Windows Search query: ${err.message}` });
    });

    child.on('close', () => {
      let payload = '';
      try {
        payload = fs.readFileSync(outPath, 'utf8');
      } catch {
        finish({
          ok: false,
          candidates: [],
          error: `Windows Search produced no result${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
        });
        return;
      }
      const { rows, error } = parseRows(payload);
      if (error) {
        mainLogger.warn('search.winSearch.failed', { error, stderr: stderr.slice(0, 300) });
        finish({ ok: false, candidates: [], error });
        return;
      }
      finish({ ok: true, candidates: rows });
    });

    // The query goes over stdin so no amount of quoting in a term can
    // reach the PowerShell command line itself.
    child.stdin.end(sql, 'utf8');
  });
}
