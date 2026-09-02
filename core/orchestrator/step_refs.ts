/**
 * Passing a value from one step to the next.
 *
 * A plan is a dependency graph, and until now only *control* flowed along its
 * edges. A step could be told to wait for another, but never to use what it
 * found. What earlier steps produced reached an agent as one prose sentence —
 * "SystemAgent verified it: The command completed" — with the actual data
 * thrown away.
 *
 * The model already knew this was wrong. Asked to test several DNS servers and
 * switch to the fastest, it planned:
 *
 *     step_1  run_command   (measure every resolver, print the winner)
 *     step_2  set_dns       primary: "{{step_1.output.best_primary}}"
 *
 * which is exactly right, and exactly what a person would write. Nothing
 * resolved it, so `set_dns` was handed those twenty-nine characters and
 * answered "Invalid IP: {{step_1.output.best_primary}}" — the only honest thing
 * it could have said.
 *
 * So the syntax the model reached for is the syntax, and this is what makes it
 * real:
 *
 *     {{step_1.output}}                 everything that step returned
 *     {{step_1.output.plan}}            one field
 *     {{step_1.output.adapters.Wi-Fi}}  nested, dots all the way down
 *     {{step_1.output.modes[0].width}}  array indices
 *
 * Two rules that matter more than the syntax:
 *
 * **A lone reference keeps its type.** `{{step_1.output.level}}` as an entire
 * value substitutes the number 70, not the string "70". Embedded in a longer
 * string it is stringified, because that is what the surrounding text needs.
 *
 * **An unresolvable reference is a failure, never a literal.** The bug this
 * file fixes was a placeholder reaching a real action as text. Passing through
 * what could not be resolved is how that happens, so nothing here does it: the
 * caller gets the list of what failed, and the message says which steps existed
 * and what they actually returned.
 */

/** `{{step_1.output.a.b[0]}}` — anchored on `step`, so ordinary braces survive. */
const REFERENCE = /\{\{\s*(step_[A-Za-z0-9_]+)\.output((?:\.[A-Za-z0-9_$-]+|\[\d+\])*)\s*\}\}/g;

export interface Resolution {
  /** The params with every reference replaced. */
  params: Record<string, unknown>;
  /** References that pointed at nothing. Empty means the step can run. */
  unresolved: string[];
}

/**
 * Replace every `{{step_N.output...}}` in `params` with the real value.
 *
 * `outputs` is keyed by step id and holds whatever that step's agent returned —
 * `AgentResult.data`, unchanged and unflattened.
 */
export function resolveStepRefs(
  params: Record<string, unknown>,
  outputs: ReadonlyMap<string, unknown>,
): Resolution {
  const unresolved: string[] = [];
  const resolved = walk(params, outputs, unresolved) as Record<string, unknown>;
  return { params: resolved, unresolved };
}

/** True if anything anywhere in `params` is a reference. Cheap pre-check. */
export function hasStepRefs(params: Record<string, unknown>): boolean {
  return findRefs(params).length > 0;
}

/** Every reference in `params`, in the order they appear. For error messages. */
export function findRefs(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(REFERENCE)) found.push(match[0]);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) findRefs(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findRefs(item, found);
  }
  return found;
}

/**
 * Say what went wrong in a way that can be acted on.
 *
 * "Unresolved reference" alone sends whoever reads it — the owner, or the Brain
 * during a repair — looking for a step that may never have existed. Naming the
 * steps that did run, and the fields they returned, is usually enough to see
 * the mistake immediately: a typo'd step id, or a field the command did not
 * actually print.
 */
export function describeUnresolved(
  unresolved: string[],
  outputs: ReadonlyMap<string, unknown>,
): string {
  const wanted = unresolved.join(', ');

  if (outputs.size === 0) {
    return `${wanted} refers to a step that has not produced anything. ` +
      'No earlier step in this plan returned data — check `dependsOn`.';
  }

  const available = [...outputs.entries()]
    .map(([id, data]) => `${id}.output${describeShape(data)}`)
    .join('; ');

  return `${wanted} could not be resolved. Available: ${available}`;
}

/** `{plan, guid}` or `[3 items]` or `= "Balanced"` — enough to spot the typo. */
function describeShape(data: unknown): string {
  if (Array.isArray(data)) return `[${data.length} item${data.length === 1 ? '' : 's'}]`;
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    return keys.length > 0 ? ` {${keys.join(', ')}}` : ' {}';
  }
  return ` = ${JSON.stringify(data)}`;
}

function walk(
  value: unknown,
  outputs: ReadonlyMap<string, unknown>,
  unresolved: string[],
): unknown {
  if (typeof value === 'string') return resolveString(value, outputs, unresolved);
  if (Array.isArray(value)) return value.map((item) => walk(item, outputs, unresolved));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = walk(item, outputs, unresolved);
    }
    return out;
  }
  return value;
}

function resolveString(
  text: string,
  outputs: ReadonlyMap<string, unknown>,
  unresolved: string[],
): unknown {
  // A value that is exactly one reference keeps the referenced type. A port
  // number has to arrive as a number, and a list of adapters as a list.
  const whole = text.trim().match(new RegExp(`^${REFERENCE.source}$`));
  if (whole) {
    const found = lookup(whole[1], whole[2], outputs);
    if (found.ok) return found.value;
    unresolved.push(whole[0]);
    return text;
  }

  if (!REFERENCE.test(text)) {
    REFERENCE.lastIndex = 0;
    return text;
  }
  REFERENCE.lastIndex = 0;

  // Embedded in a longer string: stringify, because the surrounding text is
  // a sentence or a command line and needs characters, not a value.
  return text.replace(REFERENCE, (match, stepId: string, path: string) => {
    const found = lookup(stepId, path, outputs);
    if (!found.ok) {
      unresolved.push(match);
      return match;
    }
    return typeof found.value === 'string'
      ? found.value
      : JSON.stringify(found.value);
  });
}

function lookup(
  stepId: string,
  path: string,
  outputs: ReadonlyMap<string, unknown>,
): { ok: true; value: unknown } | { ok: false } {
  if (!outputs.has(stepId)) return { ok: false };

  const root = outputs.get(stepId);
  const direct = descend(root, path);
  if (direct.ok) return direct;

  // Fall through to what the command printed.
  //
  // `run_command` returns an envelope — command, band, stdout, returncode, ok —
  // and when the output was JSON, that parsed object as `json`. A model writing
  // a plan does not think in envelopes: told to have step_1 print the winner
  // and step_2 use it, it writes `{{step_1.output.best_primary}}`, which is the
  // obvious thing and the right thing.
  //
  // So a path that misses on the envelope is tried against the payload. The
  // envelope is checked first, so a command's own field can never shadow one
  // Dex owns — `{{step_1.output.ok}}` still means the exit status.
  if (root && typeof root === 'object' && 'json' in (root as Record<string, unknown>)) {
    return descend((root as Record<string, unknown>).json, path);
  }
  return { ok: false };
}

function descend(
  root: unknown,
  path: string,
): { ok: true; value: unknown } | { ok: false } {
  let current = root;
  // `.a`, `.b-c`, `[0]` — the same three shapes the regex accepts.
  for (const segment of path.match(/\.[A-Za-z0-9_$-]+|\[\d+\]/g) ?? []) {
    if (current === null || current === undefined) return { ok: false };

    if (segment.startsWith('[')) {
      const index = Number(segment.slice(1, -1));
      if (!Array.isArray(current) || index >= current.length) return { ok: false };
      current = current[index];
      continue;
    }

    const key = segment.slice(1);
    if (typeof current !== 'object') return { ok: false };
    if (!(key in (current as Record<string, unknown>))) return { ok: false };
    current = (current as Record<string, unknown>)[key];
  }

  // A reference that resolves to nothing is not resolved. `undefined` reaching
  // an action is the same class of bug as the placeholder reaching it.
  if (current === undefined) return { ok: false };
  return { ok: true, value: current };
}
