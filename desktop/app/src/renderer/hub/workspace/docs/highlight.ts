/**
 * Syntax colours for the text viewer (docs/unify/PLAN.md §3.9): a small
 * tokenizer of DEX's own — comments, strings, numbers, keywords, and a few
 * per-language extras (JSON keys, HTML tags and attributes, CSS properties,
 * shell variables). No dependency, so nothing to vet or keep up to date; it
 * colours, it doesn't parse, and a file it doesn't know stays plain.
 */

export type TokenKind = 'k' | 's' | 'c' | 'n' | 'p' | 't' | 'a' | 'v';
export interface Token { kind: TokenKind | null; text: string }

type Lang = 'js' | 'json' | 'py' | 'css' | 'html' | 'sh' | 'ps' | 'yaml' | 'c';

/** Past this, the text stays plain: colouring a huge file isn't worth the wait. */
export const MAX_HIGHLIGHT_CHARS = 150_000;

const LANG_BY_EXT: Record<string, Lang> = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  py: 'py', pyw: 'py',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  ps1: 'ps', psm1: 'ps',
  yml: 'yaml', yaml: 'yaml',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', hpp: 'c', cs: 'c', java: 'c', kt: 'c', go: 'c', rs: 'c', swift: 'c', php: 'c', rb: 'c', dart: 'c', scala: 'c',
};

export function langFor(name: string): Lang | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return LANG_BY_EXT[ext] ?? null;
}

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const KEYWORDS: Record<'js' | 'py' | 'sh' | 'ps' | 'c', Set<string>> = {
  js: words(`abstract as async await break case catch class const continue debugger declare default delete do else enum export extends
    false finally for from function get if implements import in instanceof interface keyof let new null of private protected public
    readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield`),
  py: words(`False None True and as assert async await break class continue def del elif else except finally for from global if import
    in is lambda match case nonlocal not or pass raise return self try while with yield`),
  sh: words(`if then else elif fi for while until do done case esac in function return local export readonly echo exit set unset source`),
  ps: words(`begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in
    param process return switch throw trap try until using var while $true $false $null`),
  c: words(`abstract auto bool break case catch char class const continue default delete do double else enum extern false final float
    for fn func go goto if impl import int interface let long match mod mut namespace new nil null object override package private
    protected pub public return self short signed sizeof static struct super switch this throw true try type typedef union unsigned
    use using val var virtual void volatile when where while yield string`),
};

/** One step of a scanner: a sticky regex and what it makes. */
type Rule = [RegExp, TokenKind | null | ((m: string, rest: string) => TokenKind | null)];

const NUM = /-?(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy;
const DQ = /"(?:[^"\\\n]|\\.)*"?/y;
const SQ = /'(?:[^'\\\n]|\\.)*'?/y;
const BT = /`(?:[^`\\]|\\.)*`?/y;
const WORD = /[A-Za-z_$][\w$]*/y;
const SPACE = /\s+/y;
const OTHER = /[^\sA-Za-z_$\d"'`#/<>-]+|./y;

function keywordOr(set: Set<string>, call = true): (m: string, rest: string) => TokenKind | null {
  return (m, rest) => (set.has(m) ? 'k' : call && /^\s*\(/.test(rest) ? 'p' : /^[A-Z]/.test(m) ? 't' : null);
}

const RULES: Record<Lang, Rule[]> = {
  js: [[SPACE, null], [/\/\/[^\n]*/y, 'c'], [/\/\*[\s\S]*?(?:\*\/|$)/y, 'c'], [DQ, 's'], [SQ, 's'], [BT, 's'], [NUM, 'n'], [WORD, keywordOr(KEYWORDS.js)], [OTHER, null]],
  c: [[SPACE, null], [/\/\/[^\n]*/y, 'c'], [/\/\*[\s\S]*?(?:\*\/|$)/y, 'c'], [/#\s*\w+/y, 'k'], [DQ, 's'], [SQ, 's'], [NUM, 'n'], [WORD, keywordOr(KEYWORDS.c)], [OTHER, null]],
  py: [[SPACE, null], [/#[^\n]*/y, 'c'], [/(?:[rbfu]{0,2})"""[\s\S]*?(?:"""|$)/iy, 's'], [/(?:[rbfu]{0,2})'''[\s\S]*?(?:'''|$)/iy, 's'], [/[rbfu]{0,2}(?="|')/iy, 's'], [DQ, 's'], [SQ, 's'], [/@[\w.]+/y, 'a'], [NUM, 'n'], [WORD, keywordOr(KEYWORDS.py)], [OTHER, null]],
  json: [[SPACE, null], [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, 'p'], [DQ, 's'], [/\/\/[^\n]*/y, 'c'], [NUM, 'n'], [/\b(?:true|false|null)\b/y, 'k'], [OTHER, null]],
  css: [[SPACE, null], [/\/\*[\s\S]*?(?:\*\/|$)/y, 'c'], [DQ, 's'], [SQ, 's'], [/#[\da-f]{3,8}\b/iy, 'n'], [/-?\d[\d.]*(?:[a-z%]+)?/iy, 'n'], [/@[\w-]+/y, 'k'], [/--?[\w-]+(?=\s*:)|[a-z-]+(?=\s*:[^:{]*[;}\n])/iy, 'p'], [/[\w-]+/y, null], [OTHER, null]],
  html: [[SPACE, null], [/<!--[\s\S]*?(?:-->|$)/y, 'c'], [/<\/?[\w:-]+/y, 't'], [/\/?>/y, 't'], [/[\w:-]+(?==)/y, 'a'], [DQ, 's'], [SQ, 's'], [/[^<\s"']+/y, null], [OTHER, null]],
  sh: [[SPACE, null], [/#[^\n]*/y, 'c'], [DQ, 's'], [SQ, 's'], [/\$\{[^}\n]*\}?|\$[\w@#?*!$-]/y, 'v'], [NUM, 'n'], [/[A-Za-z_][\w-]*/y, keywordOr(KEYWORDS.sh, false)], [OTHER, null]],
  ps: [[SPACE, null], [/<#[\s\S]*?(?:#>|$)/y, 'c'], [/#[^\n]*/y, 'c'], [DQ, 's'], [SQ, 's'], [/\$[\w:]+/y, (m) => (KEYWORDS.ps.has(m.toLowerCase()) ? 'k' : 'v')], [/-[A-Za-z]+/y, 'a'], [NUM, 'n'], [/[A-Za-z_][\w-]*/y, (m) => (KEYWORDS.ps.has(m.toLowerCase()) ? 'k' : /-/.test(m) ? 'p' : null)], [OTHER, null]],
  yaml: [[SPACE, null], [/#[^\n]*/y, 'c'], [/[\w.-]+(?=\s*:(?:\s|$))/y, 'p'], [DQ, 's'], [SQ, 's'], [NUM, 'n'], [/\b(?:true|false|null|yes|no)\b/iy, 'k'], [/[^\s#"']+/y, null], [OTHER, null]],
};

/** The text as tokens; plain (one token) for a language it doesn't know or a huge file. */
export function tokenize(text: string, name: string): Token[] {
  const lang = langFor(name);
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return [{ kind: null, text }];
  const rules = RULES[lang];
  const out: Token[] = [];
  const push = (kind: TokenKind | null, s: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += s;
    else out.push({ kind, text: s });
  };
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m || m[0].length === 0) continue;
      const k = typeof kind === 'function' ? kind(m[0], text.slice(i + m[0].length, i + m[0].length + 3)) : kind;
      push(k, m[0]);
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) { push(null, text[i]); i += 1; }
  }
  return out;
}
