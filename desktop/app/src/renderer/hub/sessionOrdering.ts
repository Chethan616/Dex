type OrderedSession = {
  id?: string;
  createdAt: number;
  lastActivityAt?: number;
};

function sortByActivity<T extends OrderedSession>(a: T, b: T): number {
  return (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt);
}

/**
 * Pinned sessions first, then everything else, each group still ordered by
 * most-recent activity. Pinning is a UI affordance for "keep this where I can
 * find it", so it has to beat recency — otherwise a pinned row still slides
 * down the list the moment anything else runs, which defeats the point.
 */
export function orderSessionsForSidebar<T extends OrderedSession>(
  sessions: readonly T[],
  pinnedIds: ReadonlySet<string> = new Set(),
): T[] {
  return [...sessions].sort((a, b) => {
    const ap = a.id !== undefined && pinnedIds.has(a.id) ? 1 : 0;
    const bp = b.id !== undefined && pinnedIds.has(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return sortByActivity(a, b);
  });
}
