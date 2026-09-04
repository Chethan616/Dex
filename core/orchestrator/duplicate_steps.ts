/**
 * The same step, twice, in one plan.
 *
 * Asked to find an Aadhaar card, the planner produced:
 *
 *     step_1_step_1  find_files  query "aadhar"    2.5s
 *     step_1_step_2  find_files  query "aadhaar"   2.5s
 *
 * Two searches of a 247,000-file index, five seconds, two identical cards on
 * screen — and the second could not find anything the first had not, because
 * the search already expands "aadhar" to "aadhaar", "uid", "uidai" and
 * "government of india" before it runs. The planner did not know that and
 * hedged, which is a reasonable thing for a model to do and a waste every time
 * it does it.
 *
 * Telling the planner not to is worth doing and is not enough on its own:
 * a prompt is a request, and this one costs the owner real seconds and real
 * tokens every time it is ignored. So the plan is also checked.
 *
 * **Only exact duplicates are dropped.** Two `find_files` steps whose queries
 * differ only by a spelling the index treats as one word are the same step.
 * Two that differ by anything else are not, and guessing would silently
 * discard work the owner asked for. When in doubt this keeps both.
 */
import { ExecutionPlan, ExecutionStep } from '../events/types';

/** Actions where running the same thing twice cannot produce more. */
const IDEMPOTENT_READS = new Set([
  'find_files',
  'read_file',
  'read_document',
  'list_dir',
  'get_volume',
  'get_power_plan',
  'get_display',
  'get_brightness',
  'get_dns',
  'get_wifi_status',
  'get_env',
  'list_processes',
]);

/**
 * How the search itself normalises a query.
 *
 * Kept deliberately small and kept *here* rather than imported from the
 * indexer: this is a claim about which pairs of queries the index cannot
 * distinguish, and it should be conservative even if the indexer's own synonym
 * table grows. A pair this does not recognise costs one duplicate search; a
 * pair it recognises wrongly loses a result.
 */
const SAME_WORD: Array<readonly string[]> = [
  ['aadhar', 'aadhaar', 'adhaar', 'aadar'],
  ['licence', 'license'],
  ['organisation', 'organization'],
  ['cv', 'resume'],
];

function canonical(word: string): string {
  const lowered = word.toLowerCase();
  for (const group of SAME_WORD) {
    if (group.includes(lowered)) return group[0];
  }
  return lowered;
}

/** A step's identity, for comparison. Params in a stable order. */
function fingerprint(step: ExecutionStep): string {
  const params = Object.keys(step.params)
    .sort()
    .map((key) => {
      const value = step.params[key];
      const text = typeof value === 'string'
        ? value.toLowerCase().split(/\s+/).map(canonical).join(' ')
        : JSON.stringify(value);
      return `${key}=${text}`;
    })
    .join('&');
  return `${step.capability}:${step.action}:${params}`;
}

/**
 * Is this repair just the failed step again?
 *
 * A repair is a fresh model call, and a model handed "this step failed" will
 * sometimes answer with the same step. Running it produces the same failure,
 * one plan repair later and with the owner watching — which is worse than
 * saying plainly that it could not be fixed.
 *
 * Compared on fingerprint, so a reworded `task` string counts as different and
 * gets its chance, while the identical call does not.
 */
export function repeatsFailedStep(
  failed: ExecutionStep,
  repaired: readonly ExecutionStep[],
): boolean {
  const before = fingerprint(failed);
  return repaired.some((step) => fingerprint(step) === before);
}

export interface Deduped {
  plan: ExecutionPlan;
  /** Ids of the steps that were dropped, for the event line. */
  dropped: string[];
}

/**
 * Drop later steps that repeat an earlier one exactly.
 *
 * Anything depending on a dropped step is pointed at the one it duplicated, so
 * `{{step_2.output}}` still resolves — to the identical result the surviving
 * step produced.
 */
export function dropDuplicateSteps(plan: ExecutionPlan): Deduped {
  const seen = new Map<string, string>();
  const rewrite = new Map<string, string>();
  const kept: ExecutionStep[] = [];
  const dropped: string[] = [];

  for (const step of plan.steps) {
    if (!IDEMPOTENT_READS.has(step.action)) {
      kept.push(step);
      seen.set(fingerprint(step), step.id);
      continue;
    }

    const print = fingerprint(step);
    const first = seen.get(print);

    if (first === undefined) {
      kept.push(step);
      seen.set(print, step.id);
      continue;
    }

    // A repeat. Everything that was waiting for it can wait for the original,
    // and everything that was going to read its output reads the same output.
    dropped.push(step.id);
    rewrite.set(step.id, first);
  }

  if (dropped.length === 0) return { plan, dropped };

  const steps = kept.map((step) => ({
    ...step,
    dependsOn: [...new Set(step.dependsOn.map((id) => rewrite.get(id) ?? id))]
      .filter((id) => id !== step.id),
  }));

  return { plan: { ...plan, steps }, dropped };
}

/** What to rewrite in the *references* of surviving steps. */
export function duplicateRenames(plan: ExecutionPlan): Map<string, string> {
  const seen = new Map<string, string>();
  const rewrite = new Map<string, string>();

  for (const step of plan.steps) {
    if (!IDEMPOTENT_READS.has(step.action)) continue;
    const print = fingerprint(step);
    const first = seen.get(print);
    if (first === undefined) {
      seen.set(print, step.id);
    } else {
      rewrite.set(step.id, first);
    }
  }
  return rewrite;
}
