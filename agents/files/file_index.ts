import { spawn, spawnSync } from 'child_process';
import * as path from 'path';
import { which } from '../../core/settings/which';

/**
 * The Node side of the file index.
 *
 * The index itself is Python (`agents/files/indexer/`) because the things that
 * make it worth having — PDF text, DOCX, and Windows OCR — have their libraries
 * there. This module is only the border crossing: it runs `indexer.cli`, which
 * prints one JSON document, and hands the result back.
 *
 * The crawl is deliberately never awaited by a request. A first pass over a
 * disk is minutes of OCR, and a prompt that blocks on it is a prompt that
 * looks hung. It runs detached, and searches answer from whatever is indexed
 * so far — an incomplete index that says so beats a spinner.
 */

const INDEXER_DIR = path.join(__dirname, 'indexer');
const CWD = path.dirname(INDEXER_DIR);

export interface IndexMatch {
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** Why this file is in the answer — 'filename', 'OCR text', 'also called "uid"'. */
  why: string[];
  snippet: string;
}

export interface IndexSearch {
  query: string;
  searched_for: string[];
  restricted_to: string[] | null;
  matches: IndexMatch[];
  total: number;
  /** Ranked too weakly to show. Counted so the answer can say so. */
  also_matched_weakly: number;
  index: IndexStats;
}

export interface IndexStats {
  files: number;
  with_text: number;
  with_ocr: number;
  not_read: number;
  failed: number;
  database: string;
  built: string | null;
  /** When the fast pass finished. Set long before `built`. */
  names_done?: string | null;
  /** Files recorded by name whose contents have not been read yet. */
  pending?: number;
  /** Seconds since a running crawl last committed a batch; null if none ever ran. */
  heartbeat_age?: number | null;
  ocr_available?: boolean;
}

function python(): string | null {
  // `python3` first on POSIX; on Windows `python` is the launcher that exists.
  for (const name of ['python', 'python3']) {
    const found = which(name);
    if (found) return found;
  }
  return null;
}

function run(args: string[], timeoutMs: number): unknown {
  const executable = python();
  if (!executable) throw new Error('Python was not found on PATH, so the file index cannot run');

  const result = spawnSync(executable, ['-m', 'indexer.cli', ...args], {
    cwd: CWD,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  const text = (result.stdout ?? '').trim();
  if (!text) {
    throw new Error(`the file index returned nothing: ${(result.stderr ?? '').trim().slice(-300)}`);
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.error === 'string') throw new Error(parsed.error);
  return parsed;
}

export function searchIndex(
  query: string,
  options: { limit?: number; under?: string; terms?: string[] } = {},
): IndexSearch {
  const args = ['search', query, '--limit', String(options.limit ?? 25)];
  if (options.under) args.push('--under', options.under);
  for (const term of options.terms ?? []) args.push('--term', term);
  return run(args, 60_000) as IndexSearch;
}

export function indexStats(): IndexStats {
  return run(['stats'], 60_000) as IndexStats;
}

/**
 * Start a crawl and do not wait for it.
 *
 * Detached and unref'd so it outlives the request that triggered it: the owner
 * asked to find a file, not to sit through the indexing of their disk. Its
 * progress goes to the log; the next search sees more than the last one did.
 */
export function startCrawl(scope = 'profile'): boolean {
  const executable = python();
  if (!executable) return false;

  const child = spawn(executable, ['-m', 'indexer.cli', 'crawl', '--scope', scope], {
    cwd: CWD,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return true;
}

let crawlStarted = false;

/**
 * Make sure an index exists, without ever blocking on building one.
 *
 * Returns what is known right now. `building` is true when a first pass has
 * just been kicked off, which is what lets the answer say "still indexing"
 * instead of "no matches" — the difference between an honest partial answer
 * and a wrong one.
 */
export function ensureIndex(scope = 'profile'): { stats: IndexStats | null; building: boolean } {
  let stats: IndexStats | null = null;
  try {
    stats = indexStats();
  } catch {
    return { stats: null, building: false };
  }

  if (crawlStarted) return { stats, building: stats.files === 0 };

  // A crawl is a detached process, so it can be killed with the machine
  // halfway through. `heartbeat_age` is how long ago the last one wrote a
  // batch: recent means it is still working and starting a second would only
  // make them fight for the write lock; stale with work outstanding means it
  // died, and nobody will finish reading those files unless we start it again.
  const working = stats.heartbeat_age !== null
    && stats.heartbeat_age !== undefined
    && stats.heartbeat_age < HEARTBEAT_STALE_S;
  if (working) return { stats, building: stats.files === 0 };

  if (stats.files === 0) {
    crawlStarted = startCrawl(scope);
    return { stats, building: crawlStarted };
  }

  // Contents left unread by a crawl that stopped, or an index gone stale.
  if ((stats.pending ?? 0) > 0 || isStale(stats.built)) {
    crawlStarted = startCrawl(scope);
  }
  return { stats, building: false };
}

/** A crawl silent for this long is not running any more. */
const HEARTBEAT_STALE_S = 300;

/** Six hours. Long enough not to churn, short enough that a search is not archaeology. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function isStale(built: string | null): boolean {
  if (!built) return false; // A crawl that has never finished is already running.
  const when = Date.parse(built.replace(' ', 'T'));
  return Number.isFinite(when) && Date.now() - when > STALE_AFTER_MS;
}
