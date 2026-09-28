/**
 * Turn a query into ranked results.
 *
 * Still two phases: find a broad candidate set, then judge it. What changed
 * is only where candidates come from — the Windows Search index, queried
 * out of process, rather than an FTS5 index DEX maintained itself. The
 * judging half (`rankCandidates`, and the alias/initialism expansion that
 * feeds it) is untouched, so relevance behaves exactly as before.
 */
import { parseQuery } from './aliases';
import { winSearchCandidates } from './winSearch';
import { rankCandidates, type RankedResult } from './rank';

const CANDIDATE_CAP = 300;

export interface LocalSearchOutcome {
  results: RankedResult[];
  /** Which backend answered, and why it came back thin — surfaced to the agent. */
  note?: string;
}

/**
 * Candidate discovery now comes from the Windows Search index rather than
 * an index DEX maintains itself (see winSearch.ts for why). Everything
 * after that point is unchanged: the same alias/initialism expansion feeds
 * it, and the same `rankCandidates` does the relevance judgment, so result
 * quality and the shape callers consume are identical.
 */
export async function searchLocal(query: string, limit = 20): Promise<LocalSearchOutcome> {
  const groups = parseQuery(query);
  if (groups.length === 0) return { results: [] };
  const terms = [...new Set(groups.flatMap((group) => group.variants))];

  const outcome = await winSearchCandidates(terms, CANDIDATE_CAP);
  if (outcome.ok && outcome.candidates.length > 0) {
    return { results: rankCandidates(query, outcome.candidates, limit) };
  }

  // Nothing from Windows Search: either it genuinely has no match, or it
  // isn't indexing the folders that matter. Fall back to walking the
  // document folders by filename, off the main thread.
  const { filenameFallback } = await import('./fallbackScan');
  const fallback = await filenameFallback(groups, CANDIDATE_CAP);
  const results = rankCandidates(query, fallback, limit);

  if (!outcome.ok) {
    return { results, note: `Windows Search unavailable (${outcome.error ?? 'unknown'}) — filename-only fallback used` };
  }
  if (results.length > 0) {
    return { results, note: 'Windows Search returned nothing — filename-only fallback used. Add your Documents/Downloads folders in Windows "Searching Windows" settings to search inside file contents.' };
  }
  return { results };
}

export interface DriveSearchOutcome {
  ok: boolean;
  items: Array<{ label: string; reasons: string[] }>;
  error?: string;
}

export interface CombinedSearchResult {
  local: RankedResult[];
  /** Which local backend answered, when that is worth reporting. */
  localNote?: string;
  /** Present only when `--drive` was requested. */
  drive?: DriveSearchOutcome;
}

/**
 * `@drive`, exactly as specified: local and Drive run through one
 * `Promise.all`, not one after the other. The local side is now genuinely
 * async (an out-of-process Windows Search query), which is exactly the
 * case this shape was written to accommodate — no change needed here.
 */
export async function searchCombined(
  query: string,
  limit: number,
  wantDrive: boolean,
  driveFn: (query: string, limit: number) => Promise<DriveSearchOutcome>,
): Promise<CombinedSearchResult> {
  const localPromise = searchLocal(query, limit);
  const drivePromise = wantDrive ? driveFn(query, limit) : Promise.resolve(undefined);
  const [local, drive] = await Promise.all([localPromise, drivePromise]);
  return { local: local.results, localNote: local.note, drive };
}
