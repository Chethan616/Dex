/**
 * Turning what a step found into something a person can read.
 *
 * There are two ways this happens. The Brain phrases it (`Brain.phrase`), which
 * reads best; and this file renders it directly, which always works. The second
 * exists because the first can fail — a rate limit on a free tier, a timeout, a
 * model that returns nothing — and a question that produced a real answer must
 * never come back blank because the prose step was unavailable.
 *
 * It is also what the scheduler uses. A job firing at 3am with nobody watching
 * should not spend a model call to phrase a line into a log.
 */

/** Values worth naming when they appear, in the order a person would say them. */
const PREFERRED_KEYS = [
  'plan', 'level', 'muted', 'enabled', 'status', 'state', 'value',
  'name', 'path', 'title', 'url', 'count', 'version', 'band',
];

/** Noise: identifiers and raw command output nobody asked to see. */
const SKIPPED_KEYS = new Set([
  'action', 'guid', 'raw', 'requested', 'found_via', 'ok', 'success',
  'truncated', 'band', 'what_it_does', 'sha256', 'relative_path',
]);

/**
 * Render the collected step data as plain text.
 *
 * Deliberately terse. This is a fallback and a log line, not prose — it should
 * be obvious at a glance that these are the values as returned, unedited.
 */
export function renderFacts(facts: Record<string, unknown>[]): string {
  const lines: string[] = [];

  for (const fact of facts) {
    const action = typeof fact.action === 'string' ? fact.action : '';
    const body = renderOne(fact);
    if (!body) continue;
    lines.push(action ? `${humanise(action)}: ${body}` : body);
  }

  return lines.join('\n');
}

function renderOne(fact: Record<string, unknown>): string {
  const entries = Object.entries(fact).filter(
    ([key, value]) =>
      !SKIPPED_KEYS.has(key) && value !== undefined && value !== null && value !== '',
  );
  if (entries.length === 0) return '';

  entries.sort(([a], [b]) => rank(a) - rank(b));

  return entries
    .map(([key, value]) => `${key} ${renderValue(value)}`)
    .join(', ');
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    // Long lists are truncated with the count kept, because "and 340 more" is
    // information and a wall of 340 filenames is not.
    const shown = value.slice(0, 8).map((v) => renderValue(v)).join(', ');
    return value.length > 8 ? `${shown} (+${value.length - 8} more)` : shown;
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 6)
      .map(([k, v]) => `${k}=${renderValue(v)}`)
      .join(' ');
  }
  return String(value);
}

function rank(key: string): number {
  const index = PREFERRED_KEYS.indexOf(key);
  return index === -1 ? PREFERRED_KEYS.length : index;
}

function humanise(action: string): string {
  return action.replace(/_/g, ' ');
}

/**
 * Should this task's result be phrased at all?
 *
 * Only when something was read. "set my volume to 35" already reports what it
 * did and was verified by reading the value back; sending it through a phrasing
 * call would spend a request to restate a sentence Dex already has.
 */
export function worthPhrasing(facts: Record<string, unknown>[]): boolean {
  return facts.length > 0 && facts.some((f) => Object.keys(f).length > 1);
}

/**
 * The facts, with the noise taken out, ready to hand to the model.
 *
 * The first version passed the raw data straight through, and the model
 * dutifully reported everything in it:
 *
 *     "Your power plan is high_performance (Power Scheme GUID:
 *      8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c)."
 *
 * The GUID is an identifier the handler returns for its own use. Nobody asked
 * for it, and a model given a field will generally use it — so the fix belongs
 * here, in what it is shown, rather than in a prompt asking it to please
 * ignore things.
 *
 * Long values are clipped as well. A `read_file` of a 2 MB source file must
 * not become a 2 MB prompt.
 */
export function factsForPhrasing(
  facts: Record<string, unknown>[],
): Record<string, unknown>[] {
  return facts.map((fact) => {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fact)) {
      if (key !== 'action' && SKIPPED_KEYS.has(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      cleaned[key] = clip(value);
    }
    return cleaned;
  });
}

const MAX_VALUE_CHARS = 1_500;

function clip(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length <= MAX_VALUE_CHARS
      ? value
      : `${value.slice(0, MAX_VALUE_CHARS)}… [${value.length} characters total]`;
  }
  if (Array.isArray(value)) {
    return value.length <= 20
      ? value.map(clip)
      : [...value.slice(0, 20).map(clip), `… and ${value.length - 20} more`];
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      out[k] = clip(v);
    }
    return out;
  }
  return value;
}
