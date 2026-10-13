/**
 * declarativeNetRequest's `urlFilter` syntax, and the n-grams the index
 * uses to find candidate rules quickly.
 * https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-urlFilter
 *
 *   *   any run of characters
 *   |   at the start or end: the URL starts / ends here
 *   ||  at the start: the start of the host, or of one of its subdomains
 *   ^   a separator: anything but a letter, digit, _ - . %  — or the URL's end
 */

const SEPARATOR = '(?:[^A-Za-z0-9_\\-.%]|$)';
const DOMAIN_ANCHOR = '^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/(?:[^/?#@]*@)?(?:[^/?#]*\\.)?';

function escape(text: string): string {
  return text.replace(/[.+?${}()|[\]\\/]/g, '\\$&');
}

/** The urlFilter as a RegExp (compiled lazily by the index: most rules never meet a URL they could match). */
export function urlFilterToRegExp(filter: string, caseSensitive: boolean): RegExp {
  let f = filter;
  let prefix = '';
  let suffix = '';
  if (f.startsWith('||')) { prefix = DOMAIN_ANCHOR; f = f.slice(2); }
  else if (f.startsWith('|')) { prefix = '^'; f = f.slice(1); }
  if (f.endsWith('|') && !f.endsWith('\\|')) { suffix = '$'; f = f.slice(0, -1); }
  let body = '';
  for (const ch of f) {
    if (ch === '*') body += '.*';
    else if (ch === '^') body += SEPARATOR;
    else body += escape(ch);
  }
  return new RegExp(prefix + body + suffix, caseSensitive ? '' : 'i');
}

/** Literal stretches of a urlFilter (between *, ^ and the anchors), as the URL must contain them. */
export function literalRuns(filter: string): string[] {
  return filter.replace(/^\|\|?/, '').replace(/\|$/, '').split(/[*^]/).filter(Boolean);
}

/**
 * Literal stretches a regexFilter requires, for prefiltering. Conservative:
 * any alternation or anything unusual and it gives up (the rule is then
 * checked against every URL, which is fine for the few regex rules).
 */
export function regexLiteralRuns(source: string): string[] {
  if (/\|/.test(source.replace(/\\\|/g, ''))) return [];
  const runs: string[] = [];
  let cur = '';
  let i = 0;
  const flush = () => { if (cur) runs.push(cur); cur = ''; };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      if (/[.\-/?*+()[\]{}|^$\\:=]/.test(next)) {
        const optional = /[*?{]/.test(source[i + 2] ?? '');
        if (optional) { flush(); i += 3; continue; }
        cur += next;
        i += 2;
        continue;
      }
      flush();
      i += 2;
      continue;
    }
    if (ch === '[') {
      flush();
      const end = source.indexOf(']', i + 1);
      i = end < 0 ? source.length : end + 1;
      if (/[*?{]/.test(source[i] ?? '')) i += 1;
      continue;
    }
    if (ch === '(') {
      // A group may be optional or repeated as a whole: nothing in it counts.
      flush();
      let depth = 0;
      for (; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '(') depth++;
        else if (source[i] === ')' && --depth === 0) { i++; break; }
      }
      if (/[*?{+]/.test(source[i] ?? '')) i += 1;
      continue;
    }
    if (').^$+*?{}'.includes(ch)) {
      // A quantifier makes the previous character optional or repeatable.
      if (ch === '*' || ch === '?' || ch === '{') cur = cur.slice(0, -1);
      flush();
      if (ch === '{') { const end = source.indexOf('}', i); i = end < 0 ? source.length : end + 1; continue; }
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  flush();
  return runs;
}

export const NGRAM = 5;

/** A cheap hash of `s[i..i+NGRAM)`, lower-cased. */
export function ngramAt(s: string, i: number): number {
  let h = 0;
  for (let k = 0; k < NGRAM; k++) {
    let c = s.charCodeAt(i + k);
    if (c >= 65 && c <= 90) c += 32;
    h = (Math.imul(h, 31) + c) | 0;
  }
  return h;
}

/** Every n-gram of a literal run. */
export function ngramsOf(run: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + NGRAM <= run.length; i++) out.push(ngramAt(run, i));
  return out;
}
