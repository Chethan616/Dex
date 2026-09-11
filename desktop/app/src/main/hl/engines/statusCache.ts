/**
 * Cached engine install/auth status.
 *
 * Probing an engine is not cheap: `probeInstalled` runs `<engine> --version`
 * and `probeAuthed` runs `<engine> auth status`, so a picker listing three
 * engines spawns six processes every time it opens. On Windows, where process
 * creation is expensive and each spawn also pays for PATH enrichment, that is
 * the entire reason the engine picker feels sluggish next to the model picker
 * — which lists models straight from the adapter and spawns nothing.
 *
 * None of that information changes second to second. An engine is installed or
 * it is not; a login lasts for weeks. So: serve what we know immediately, and
 * refresh in the background when it is old.
 *
 * The cache is deliberately not invalidated on a timer. A stale entry costs
 * nothing until somebody asks, and asking is exactly when we want to refresh.
 */
import { engineLogger } from '../../logger';

export interface EngineStatus {
  id: string;
  displayName: string;
  installed: { installed: boolean; version?: string; error?: string };
  authed: { authed: boolean; error?: string };
}

interface CacheEntry {
  value: EngineStatus;
  at: number;
}

/** Older than this and we refresh — but still answer from cache first. */
const FRESH_MS = 60_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<EngineStatus>>();

/**
 * Read status, preferring speed over currency.
 *
 * A cached value is returned even when stale, with a refresh started behind
 * it. The picker therefore opens instantly and corrects itself a moment later,
 * which is the right trade: a menu that takes a second to appear is worse than
 * one whose badge updates just after it does.
 */
export async function getEngineStatus(
  engineId: string,
  probe: () => Promise<EngineStatus>,
): Promise<EngineStatus> {
  const entry = cache.get(engineId);

  if (entry) {
    if (Date.now() - entry.at > FRESH_MS) void refresh(engineId, probe);
    return entry.value;
  }

  return refresh(engineId, probe);
}

/** Run the real probe, collapsing concurrent callers onto one run. */
function refresh(engineId: string, probe: () => Promise<EngineStatus>): Promise<EngineStatus> {
  const existing = inFlight.get(engineId);
  if (existing) return existing;

  const run = probe()
    .then((value) => {
      cache.set(engineId, { value, at: Date.now() });
      return value;
    })
    .catch((err) => {
      // A failed probe must not poison the cache: the next open should try
      // again rather than inherit a transient failure for a minute.
      engineLogger.warn('engineStatus.probe.failed', { engineId, error: (err as Error).message });
      throw err;
    })
    .finally(() => {
      inFlight.delete(engineId);
    });

  inFlight.set(engineId, run);
  return run;
}

/**
 * Drop what we know about an engine.
 *
 * Called after logging in or installing, where the whole point of the action
 * was to change the answer — showing the pre-action state until the next
 * refresh would make a successful login look like it failed.
 */
export function invalidateEngineStatus(engineId?: string): void {
  if (engineId) cache.delete(engineId);
  else cache.clear();
}

/**
 * Fill the cache ahead of the first menu open.
 *
 * Runs at startup, off the critical path — the first picker open is otherwise
 * the one that pays full price, and first impressions of speed are the ones
 * that stick. Failures are ignored; this is an optimisation, not a dependency.
 */
export function prewarmEngineStatus(
  engineIds: string[],
  probe: (id: string) => Promise<EngineStatus>,
): void {
  for (const id of engineIds) {
    void refresh(id, () => probe(id)).catch(() => {});
  }
}
