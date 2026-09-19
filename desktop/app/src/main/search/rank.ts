/**
 * Turns FTS candidate rows into ordered results.
 *
 * The property that makes the hard cases work is the coverage bonus: matching
 * every distinct term the user typed beats matching one of them repeatedly.
 * `BCSE_CNS_syllabus.pdf` wins a query for "cryptography syllabus" not because
 * either word appears often, but because the filename supplies one term and
 * the content supplies the other — two out of two, which nothing else in a
 * folder of course PDFs also manages.
 */
import { groupSatisfied, literalMatch, parseQuery, type QueryGroup } from './aliases';

export interface SearchCandidate {
  path: string;
  name: string;
  content: string;
  size: number;
  mtime: number;
}

export interface RankedResult {
  label: string;
  detail: string;
  reasons: string[];
  excerpt?: string;
  bytes: number;
  modified: number;
  score: number;
}

const RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function recencyBonus(mtime: number, now: number): number {
  const age = now - mtime;
  if (age <= 0) return 3;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return 3 * (1 - age / RECENCY_WINDOW_MS);
}

function excerptAround(content: string, groups: QueryGroup[]): string | undefined {
  const lower = content.toLowerCase();
  let hitAt = -1;
  for (const group of groups) {
    for (const variant of group.variants) {
      const at = lower.indexOf(variant);
      if (at >= 0 && (hitAt < 0 || at < hitAt)) hitAt = at;
    }
  }
  if (hitAt < 0) return undefined;
  const start = Math.max(0, hitAt - 60);
  const end = Math.min(content.length, hitAt + 100);
  const slice = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < content.length ? '…' : ''}`;
}

/**
 * Score and order a candidate set for one query.
 *
 * Candidates with zero satisfied term-groups are dropped — an FTS match on
 * one OR'd term is not the same as being relevant to what was actually asked.
 */
export function rankCandidates(query: string, candidates: SearchCandidate[], limit = 20): RankedResult[] {
  const groups = parseQuery(query);
  if (groups.length === 0) return [];
  const now = Date.now();

  const scored = candidates.map((candidate) => {
    const nameSatisfied = groups.filter((group) => groupSatisfied(candidate.name, group));
    const contentSatisfied = groups.filter((group) => groupSatisfied(candidate.content, group));
    const coveredGroups = new Set([...nameSatisfied, ...contentSatisfied]);
    const coverage = coveredGroups.size / groups.length;

    const reasons: string[] = [];
    for (const group of nameSatisfied) reasons.push(`"${group.original}" in filename`);
    for (const group of contentSatisfied) {
      if (nameSatisfied.includes(group)) continue;
      const isLiteral = literalMatch(candidate.content, group);
      reasons.push(isLiteral ? `"${group.original}" in contents` : `"${group.original}" matches initials in contents`);
    }

    const score =
      coverage * 1000 +
      nameSatisfied.length * 100 +
      contentSatisfied.length * 10 +
      recencyBonus(candidate.mtime, now);

    return {
      label: candidate.name,
      detail: candidate.path,
      reasons,
      excerpt: excerptAround(candidate.content, groups),
      bytes: candidate.size,
      modified: candidate.mtime,
      score,
      coveredCount: coveredGroups.size,
    };
  });

  return scored
    .filter((result) => result.coveredCount > 0)
    .sort((a, b) => b.score - a.score || b.modified - a.modified)
    .slice(0, limit)
    .map(({ coveredCount: _coveredCount, ...result }) => result);
}
