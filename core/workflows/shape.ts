/**
 * Turning a request into a comparable shape.
 *
 * Two features need the same idea. Telemetry wants to know that "set volume to
 * 30" and "set volume to 80" are the *same thing asked twice*, so it can offer
 * to save it as a workflow. Workflow replay wants to know that a new request
 * matches a saved one, and which values differ — those are the parameters.
 *
 * Both fall out of masking the literals: numbers, quoted strings, paths, IPs
 * and URLs become placeholders, and what remains is the shape of the request.
 * No model involved, which is the point — a saved workflow must be runnable
 * without paying the Brain to re-read it.
 */

export interface Shaped {
  /** The request with literals replaced by <num>, <str>, <path>, <ip>, <url>. */
  shape: string;
  /** The literals that were removed, in the order they appeared. */
  literals: string[];
}

/**
 * Order matters. URLs contain dots and slashes that would otherwise be eaten by
 * the path and IP rules, and quoted strings can contain anything at all, so
 * they are lifted out first.
 */
const MASKS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'str', re: /"[^"]*"|'[^']*'/g },
  { kind: 'url', re: /\bhttps?:\/\/\S+/gi },
  { kind: 'path', re: /\b[a-zA-Z]:\\[^\s,;]*|\\\\[^\s,;]+/g },
  { kind: 'ip', re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g },
  { kind: 'num', re: /\b\d+(?:\.\d+)?%?\b/g },
];

/** Filler that changes nothing about what is being asked. */
const NOISE = /\b(please|could you|can you|would you|for me|now|just|kindly|my|the|a|an)\b/gi;

export function shapeOf(text: string): Shaped {
  const literals: string[] = [];

  // Masking runs against the ORIGINAL text so literals keep their case. Only
  // the leftover shape is lowercased for comparison. Extracting from a
  // lowercased string looks equivalent and is not: "save as 'Report Q3'" would
  // replay as "report q3", quietly renaming the owner's file.
  let working = ` ${text.trim()} `;

  for (const { kind, re } of MASKS) {
    working = working.replace(re, (match) => {
      literals.push(match.replace(/^["']|["']$/g, ''));
      return ` <${kind}> `;
    });
  }

  const shape = working
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^\w<>%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { shape, literals };
}

/**
 * Does a request match a saved workflow's shape, and with what values?
 *
 * Deliberately exact on the shape. A fuzzy match here would silently run the
 * wrong saved workflow with the owner's numbers in it, which is far worse than
 * falling through to the Brain and costing one call.
 */
export function matchShape(text: string, savedShape: string): string[] | null {
  const { shape, literals } = shapeOf(text);
  return shape === savedShape ? literals : null;
}

/**
 * Names the literals so they can be bound to a saved plan.
 *
 * A parameter is named after the step parameter it filled — `level`, `primary`,
 * `path` — because that is what the owner will see and type. Positional names
 * (`arg1`) are the fallback when a literal came from somewhere the plan does
 * not reference.
 */
export function nameParameters(
  literals: string[],
  bindings: Array<string | undefined>,
): string[] {
  const used = new Set<string>();
  return literals.map((_, i) => {
    const preferred = bindings[i];
    let name = preferred && !used.has(preferred) ? preferred : `arg${i + 1}`;
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    return name;
  });
}
