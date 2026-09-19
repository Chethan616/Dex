/**
 * The read side of the index: turn a query into ranked results.
 *
 * Two phases, both cheap. `ftsCandidates` asks SQLite for a broad set of
 * files that mention any query term or alias at all — fast, because it uses
 * the FTS index. `rankCandidates` then does the actual relevance judgment in
 * JS, where the alias table and initialism check can run against full text.
 */
import { parseQuery } from './aliases';
import { ftsCandidates } from './db';
import { rankCandidates, type RankedResult } from './rank';

const CANDIDATE_CAP = 300;

export function searchLocal(query: string, limit = 20): RankedResult[] {
  const groups = parseQuery(query);
  if (groups.length === 0) return [];
  const terms = [...new Set(groups.flatMap((group) => group.variants))];
  const candidates = ftsCandidates(terms, CANDIDATE_CAP);
  return rankCandidates(query, candidates, limit);
}

export interface DriveSearchOutcome {
  ok: boolean;
  items: Array<{ label: string; reasons: string[] }>;
  error?: string;
}

export interface CombinedSearchResult {
  local: RankedResult[];
  /** Present only when `--drive` was requested. */
  drive?: DriveSearchOutcome;
}

/**
 * `@drive`, exactly as specified: local and Drive run through one
 * `Promise.all`, not one after the other. The local search is synchronous
 * SQLite today, so wrapping it in `Promise.resolve().then(...)` costs nothing
 * now — but it means that if the local side ever moves onto a worker (the
 * plan's stated follow-up if cold-index CPU cost proves an issue), this
 * function's shape does not need to change to stay genuinely concurrent.
 */
export async function searchCombined(
  query: string,
  limit: number,
  wantDrive: boolean,
  driveFn: (query: string, limit: number) => Promise<DriveSearchOutcome>,
): Promise<CombinedSearchResult> {
  const localPromise = Promise.resolve().then(() => searchLocal(query, limit));
  const drivePromise = wantDrive ? driveFn(query, limit) : Promise.resolve(undefined);
  const [local, drive] = await Promise.all([localPromise, drivePromise]);
  return { local, drive };
}
