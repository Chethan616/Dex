type OrderedSession = {
  id?: string;
  createdAt: number;
  lastActivityAt?: number;
};

function sortByActivity<T extends OrderedSession>(a: T, b: T): number {
  return (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt);
}

/**
 * Before the user creates a manual order, pinned sessions stay at the top.
 * Once a manual order exists, it controls the whole list independently of pin
 * state; pinning remains an action on the session rather than a sorting tool.
 */
export function orderSessionsForSidebar<T extends OrderedSession>(
  sessions: readonly T[],
  pinnedIds: ReadonlySet<string> = new Set(),
  manualOrderIds: readonly string[] = [],
): T[] {
  const manualIndex = new Map(manualOrderIds.map((id, index) => [id, index]));
  return [...sessions].sort((a, b) => {
    if (manualIndex.size === 0) {
      const ap = a.id !== undefined && pinnedIds.has(a.id) ? 1 : 0;
      const bp = b.id !== undefined && pinnedIds.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
    }
    const ai = a.id === undefined ? undefined : manualIndex.get(a.id);
    const bi = b.id === undefined ? undefined : manualIndex.get(b.id);
    // Newly created sessions have no saved position yet, so keep them ahead
    // of the manually arranged history until the user next reorders a row.
    if (ai === undefined && bi !== undefined) return -1;
    if (ai !== undefined && bi === undefined) return 1;
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi;
    return sortByActivity(a, b);
  });
}
