/**
 * Query-term equivalence for file search.
 *
 * A person searching their own files uses whatever word they associate with a
 * thing, not necessarily the word the file — or its content — actually
 * contains. "da", "assessment" and "ast" are the same university requirement;
 * "slp" is never spelled out in a filename but is exactly what the course is
 * called inside the PDF itself. This closes that gap in two ways: a table of
 * known equivalent terms, and a check for a short term matching the initials
 * of consecutive words ("slp" -> "Speech Language Processing").
 */

/** Bidirectional term groups: any member found is as good as any other. */
const ALIAS_GROUPS: string[][] = [
  ['da', 'assessment', 'assignment', 'ast'],
  ['syllabus', 'curriculum', 'course outline', 'course plan'],
  ['slp', 'speech and language processing'],
  ['cns', 'cryptography and network security', 'cryptography'],
  ['os', 'operating systems'],
  ['dbms', 'database management systems', 'database'],
  ['oops', 'object oriented programming', 'oop'],
  ['ai', 'artificial intelligence'],
  ['ml', 'machine learning'],
  ['cn', 'computer networks'],
  ['toc', 'theory of computation'],
  ['ds', 'data structures'],
  ['cd', 'compiler design'],
  ['se', 'software engineering'],
];

/**
 * Words that describe a file's *kind* rather than what it is about. Kept out
 * of the match set — a PDF's own text almost never contains the literal word
 * "pdf", so treating it as a required term only hurts recall.
 */
const TYPE_WORDS = new Set([
  'pdf', 'doc', 'docx', 'sheet', 'xlsx', 'ppt', 'pptx', 'file', 'files',
  'document', 'documents', 'slide', 'slides', 'txt', 'the', 'a', 'an', 'of',
  'for', 'my', 'in', 'on',
]);

/** Filler words skipped when checking whether a term matches consecutive initials. */
const INITIALISM_FILLERS = new Set(['and', 'of', 'the', 'for', 'a', 'an', 'in', 'to', '&']);

export interface QueryGroup {
  /** The term as the user typed it, lowercase. */
  original: string;
  /** original + every known alias, lowercase, for literal substring matching. */
  variants: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

const ALIAS_LOOKUP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of ALIAS_GROUPS) {
    for (const term of group) map.set(term, group);
  }
  return map;
})();

function groupsFromTokens(tokens: string[]): QueryGroup[] {
  const seen = new Set<string>();
  const groups: QueryGroup[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const alias = ALIAS_LOOKUP.get(token);
    groups.push({ original: token, variants: alias ? [...new Set([token, ...alias])] : [token] });
  }
  return groups;
}

/**
 * Turn a raw query into term-groups worth matching independently.
 *
 * Type words are dropped first because they dilute coverage scoring; if that
 * strips the query down to nothing (a query that was only "pdf files"), fall
 * back to the untouched tokens so a deliberately bare query still searches
 * for something.
 */
export function parseQuery(query: string): QueryGroup[] {
  const allTokens = tokenize(query);
  const meaningful = allTokens.filter((token) => !TYPE_WORDS.has(token));
  return groupsFromTokens(meaningful.length > 0 ? meaningful : allTokens);
}

/** True if `haystack` contains any variant of the group as a substring. */
export function literalMatch(haystack: string, group: QueryGroup): boolean {
  const lower = haystack.toLowerCase();
  return group.variants.some((variant) => lower.includes(variant));
}

/**
 * True if a short, all-letters term matches the initials of some run of
 * consecutive words in `haystack` (fillers like "and"/"of" skipped first) —
 * e.g. "slp" against "...this unit covers Speech and Language Processing...".
 */
export function initialismMatch(haystack: string, term: string): boolean {
  if (!/^[a-z]{2,6}$/.test(term)) return false;
  const words = tokenize(haystack).filter((word) => !INITIALISM_FILLERS.has(word));
  const n = term.length;
  for (let i = 0; i + n <= words.length; i++) {
    let initials = '';
    for (let j = 0; j < n; j++) initials += words[i + j][0] ?? '';
    if (initials === term) return true;
  }
  return false;
}

/** Whether a query group is satisfied anywhere in the given text — the coverage check. */
export function groupSatisfied(haystack: string, group: QueryGroup): boolean {
  return literalMatch(haystack, group) || initialismMatch(haystack, group.original);
}

export { tokenize };
