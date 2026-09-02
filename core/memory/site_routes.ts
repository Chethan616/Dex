import { db } from './db';

/**
 * How to get somewhere on a site whose pages do not say what they are.
 *
 * A university portal is the case this was built for. Nothing on it is labelled
 * "curriculum"; the thing that leads there is called something else, sits inside
 * a menu called something else again, and no amount of reasoning about the word
 * "curriculum" finds it reliably on the first try. But it is in the same place
 * every time, and a person who has been shown once never has to think about it
 * again.
 *
 * That is what this stores: not a URL, but the *path* — the actual visible text
 * of each thing that was clicked, in order, and where each click landed.
 *
 * **Click paths rather than deep links, deliberately.** The obvious design is to
 * save the final URL and navigate straight to it. It does not work on the sites
 * that need it most: portals built on server-side session state navigate by POST
 * and answer a bare GET of an inner page with a session-timeout screen. The path
 * survives that; a saved URL does not.
 *
 * A route is a hint, never a cage. `run_task` follows it while each step still
 * matches and falls back to reading the page and reasoning the moment one does
 * not — so a site that gets redesigned degrades to the behaviour there was
 * before routes existed, rather than breaking.
 */

export interface RouteStep {
  /** What the owner clicked, as it appeared on screen. The durable part. */
  text: string;
  /** A selector for it, as a second way to find the same thing. */
  selector?: string;
  /** Where that click ended up — for recognising a wrong turn, not for jumping. */
  url?: string;
}

export interface SiteRoute {
  origin: string;
  /** What it gets you: "course curriculum", "attendance", "exam timetable". */
  goal: string;
  steps: RouteStep[];
  createdAt: number;
  lastWorkedAt?: number;
  runCount: number;
  failCount: number;
}

/** Two failures in a row and a route is forgotten. Same rule as workflows. */
const FORGET_AFTER_FAILURES = 2;

export class SiteRouteStore {
  /**
   * Remember how to get somewhere.
   *
   * Replaces any existing route for the same origin and goal: a second
   * recording is a correction, not a rival. Nobody wants two answers to "where
   * is the curriculum".
   */
  save(input: { origin: string; goal: string; steps: RouteStep[] }): SiteRoute {
    const origin = normaliseOrigin(input.origin);
    const goal = normaliseGoal(input.goal);

    if (!origin) throw new Error('A route needs an origin');
    if (!goal) throw new Error('A route needs a goal — what does it get you?');
    if (input.steps.length === 0) {
      throw new Error('A route with no steps is not a route');
    }

    const route: SiteRoute = {
      origin,
      goal,
      steps: input.steps,
      createdAt: Date.now(),
      runCount: 0,
      failCount: 0,
    };

    db()
      .prepare(
        `INSERT OR REPLACE INTO site_routes
           (origin, goal, steps, created_at, last_worked_at, run_count, fail_count)
         VALUES (?, ?, ?, ?, NULL,
                 COALESCE((SELECT run_count FROM site_routes
                           WHERE origin = ? AND goal = ?), 0),
                 0)`,
      )
      .run(origin, goal, JSON.stringify(route.steps), route.createdAt, origin, goal);

    return route;
  }

  /**
   * The best route for what is being asked, or undefined.
   *
   * Matched on the origin plus overlapping words in the goal, rather than on an
   * exact goal string. The owner recorded "course curriculum" and later asks for
   * "my RL syllabus"; requiring those to be equal would make the memory useless
   * the moment they phrased it differently, which is most of the time.
   */
  find(origin: string, goal: string): SiteRoute | undefined {
    const host = normaliseOrigin(origin);
    if (!host) return undefined;

    const wanted = words(goal);
    const candidates = this.forOrigin(host);
    if (candidates.length === 0) return undefined;

    let best: SiteRoute | undefined;
    let bestScore = 0;

    for (const route of candidates) {
      const score = overlap(wanted, words(route.goal));
      if (score > bestScore) {
        best = route;
        bestScore = score;
      }
    }

    // One shared word is a coincidence — "my page" and "course page" overlap on
    // nothing that means anything. Replaying the wrong route wastes more time
    // than not having one.
    return bestScore >= 2 || (bestScore === 1 && wanted.size <= 2) ? best : undefined;
  }

  forOrigin(origin: string): SiteRoute[] {
    return (db()
      .prepare('SELECT * FROM site_routes WHERE origin = ? ORDER BY run_count DESC')
      .all(normaliseOrigin(origin)) as Array<Record<string, unknown>>).map(hydrate);
  }

  list(): SiteRoute[] {
    return (db()
      .prepare('SELECT * FROM site_routes ORDER BY origin, run_count DESC')
      .all() as Array<Record<string, unknown>>).map(hydrate);
  }

  markWorked(origin: string, goal: string): void {
    db()
      .prepare(
        `UPDATE site_routes
         SET run_count = run_count + 1, last_worked_at = ?, fail_count = 0
         WHERE origin = ? AND goal = ?`,
      )
      .run(Date.now(), normaliseOrigin(origin), normaliseGoal(goal));
  }

  /**
   * The route did not work. Twice in a row and it is forgotten.
   *
   * Two rather than one because a route can fail for reasons that have nothing
   * to do with the route — the session expired, the site was down, the network
   * dropped — and discarding what was learned over one bad afternoon is its own
   * kind of wrong. `markWorked` resets the count, so it takes two failures with
   * no success between them.
   */
  markFailed(origin: string, goal: string): boolean {
    const host = normaliseOrigin(origin);
    const key = normaliseGoal(goal);

    db()
      .prepare(
        'UPDATE site_routes SET fail_count = fail_count + 1 WHERE origin = ? AND goal = ?',
      )
      .run(host, key);

    const row = db()
      .prepare('SELECT fail_count FROM site_routes WHERE origin = ? AND goal = ?')
      .get(host, key) as { fail_count?: number } | undefined;

    if (row && Number(row.fail_count ?? 0) >= FORGET_AFTER_FAILURES) {
      this.delete(host, key);
      return true;
    }
    return false;
  }

  delete(origin: string, goal: string): boolean {
    return (
      db()
        .prepare('DELETE FROM site_routes WHERE origin = ? AND goal = ?')
        .run(normaliseOrigin(origin), normaliseGoal(goal)).changes > 0
    );
  }
}

/**
 * A route, written for a model to follow.
 *
 * Deliberately phrased as directions rather than as a command: the agent is
 * told what worked last time and told to check as it goes, because the whole
 * value of falling back is lost if it follows a stale route off a cliff.
 */
export function describeRoute(route: SiteRoute): string {
  const steps = route.steps
    .map((step, i) => `  ${i + 1}. click "${step.text}"`)
    .join('\n');

  return (
    `You have been here before. Last time, "${route.goal}" on ${route.origin} was ` +
    `reached like this:\n${steps}\n` +
    'Follow that path. Check each step actually appears before clicking it — if ' +
    'something has moved or is named differently now, stop following this and ' +
    'find it yourself by reading the page.'
  );
}

/** Hostname only, lowercased. The same shape both sides of every comparison. */
export function normaliseOrigin(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withScheme = raw.includes('://') ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase().split('/')[0];
  }
}

function normaliseGoal(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Words worth matching on — the short ones carry no meaning. */
function words(value: string): Set<string> {
  return new Set(
    normaliseGoal(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'get', 'from', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'with', 'into', 'onto', 'please', 'find', 'open', 'show',
  'download', 'fetch', 'give',
]);

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

function hydrate(row: Record<string, unknown>): SiteRoute {
  return {
    origin: String(row.origin),
    goal: String(row.goal),
    steps: JSON.parse(String(row.steps ?? '[]')) as RouteStep[],
    createdAt: Number(row.created_at ?? 0),
    lastWorkedAt: row.last_worked_at == null ? undefined : Number(row.last_worked_at),
    runCount: Number(row.run_count ?? 0),
    failCount: Number(row.fail_count ?? 0),
  };
}
