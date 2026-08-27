import { Artifact, ArtifactKind, ArtifactStore } from './artifacts';

/**
 * Working out what "the report" refers to.
 *
 * The owner starts something on their phone and follows it up an hour later
 * from the desktop. "Send me the report" has to reach the file that was
 * actually produced, not a file with a similar name, and not a guess.
 *
 * The rule that shapes everything here: **when two artifacts fit equally well,
 * ask.** A reference resolver that picks the more recent one is right most of
 * the time and silently wrong the rest, and the owner has no way to tell which
 * happened — they asked for "the report" and got *a* report. Being unable to
 * decide is information worth surfacing, not an inconvenience to smooth over.
 */

/**
 * Definite references worth resolving. Bare "it" is too weak to act on.
 *
 * Captures the few words after the determiner rather than trying to delimit the
 * phrase with one pattern. A single regex has to decide whether the dot in
 * "the q4_report.pdf" ends the sentence or the filename, and it cannot.
 */
const REFERENCE = /\b(?:the|that|those|this)\s+((?:[\w.\-]+\s*){1,3})/gi;

/** Words that follow "the" without naming a thing Dex produced. */
const NOT_A_THING = new Set([
  'same', 'other', 'first', 'last', 'next', 'previous', 'current', 'latest',
  'following', 'above', 'below', 'right', 'left', 'top', 'bottom', 'best',
  'system', 'computer', 'machine', 'screen', 'desktop', 'volume', 'sound',
  'brightness', 'wifi', 'network', 'internet', 'time', 'date', 'way',
]);

/** Words that name a *kind* of artifact rather than a specific one. */
const KIND_WORDS: Record<string, ArtifactKind> = {
  file: 'file', document: 'file', doc: 'file', report: 'file', note: 'file',
  spreadsheet: 'file', pdf: 'file', screenshot: 'file',
  email: 'email', mail: 'email', message: 'email',
  event: 'event', meeting: 'event', appointment: 'event',
  page: 'page', site: 'page', website: 'page', link: 'page', tab: 'page',
  app: 'app', application: 'app', program: 'app', window: 'app',
  setting: 'setting',
};

export interface Resolution {
  /** The phrase from the request, e.g. "report". */
  phrase: string;
  match: Artifact;
  /** Why this one — shown to the owner so a wrong resolution is visible. */
  reason: string;
}

export interface Ambiguity {
  phrase: string;
  candidates: Artifact[];
}

export interface ReferenceOutcome {
  resolved: Resolution[];
  /** Non-empty means Dex must ask before doing anything. */
  ambiguous: Ambiguity[];
}

/** Beyond this, "the report" almost certainly means something newer. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export class ReferenceResolver {
  constructor(private artifacts = new ArtifactStore()) {}

  /**
   * Find definite references in a request and resolve each to one artifact.
   *
   * Scoring, in order of how much it actually tells us:
   *   exact name match          the owner said what it is called
   *   name contains the phrase  "the invoice" -> "Amazon_Invoice.pdf"
   *   kind match                "the report" -> the most recent file
   *
   * Recency breaks ties only *within* the same score band. It never promotes a
   * weaker match over a stronger one, because "most recent" is a guess and
   * "you said its name" is not.
   */
  resolve(text: string, sinceMs = LOOKBACK_MS): ReferenceOutcome {
    const pool = this.artifacts.recent(60, sinceMs);
    const resolved: Resolution[] = [];
    const ambiguous: Ambiguity[] = [];

    if (pool.length === 0) return { resolved, ambiguous };

    for (const phrase of phrasesIn(text)) {
      const scored = pool
        .map((artifact) => ({ artifact, ...score(artifact, phrase) }))
        .filter((entry) => entry.points > 0)
        .sort((a, b) => b.points - a.points || b.artifact.createdAt - a.artifact.createdAt);

      if (scored.length === 0) continue;

      const best = scored[0];

      // Two records of the same thing are not a choice. Running an app twice
      // leaves two artifacts, and asking "which Calculator do you mean?" when
      // both are the same Calculator is noise — the kind of question that
      // teaches the owner to stop reading them.
      const tied = dedupe(scored.filter((entry) => entry.points === best.points));

      // The production gate. Two artifacts fitting equally well is not a
      // tie-break problem — it is a question only the owner can answer.
      if (tied.length > 1 && !clearlyNewer(tied)) {
        ambiguous.push({ phrase, candidates: tied.map((entry) => entry.artifact) });
        continue;
      }

      resolved.push({ phrase, match: best.artifact, reason: best.reason });
    }

    return { resolved, ambiguous };
  }

  /**
   * Rewrite a request so the agents receive something concrete.
   * "email me the report" -> "email me the report (C:\\Users\\...\\Q3.pdf)"
   */
  substitute(text: string, resolutions: Resolution[]): string {
    let out = text;
    for (const { phrase, match } of resolutions) {
      const re = new RegExp(`\\b((?:the|that|this)\\s+${escape(phrase)})\\b`, 'i');
      out = out.replace(re, `$1 (${match.locator})`);
    }
    return out;
  }

  /** The question to put to the owner when a reference will not resolve. */
  static question(ambiguity: Ambiguity): string {
    const options = ambiguity.candidates
      .slice(0, 5)
      .map((a, i) => `  ${i + 1}. ${a.name} — ${a.locator}`)
      .join('\n');
    return `Which "${ambiguity.phrase}" do you mean?\n${options}`;
  }
}

/**
 * What makes two artifacts the same thing — which depends on what kind of
 * thing it is.
 *
 * An application *is* its name: Calculator opened three times is one
 * Calculator, and its locator has varied across versions of Dex (it was once
 * the launcher stub `calc.exe`, now the friendly name). A file, page or message
 * *is* its locator: two files can share a name in different folders and are
 * genuinely different things.
 *
 * Getting this wrong in either direction is visible to the owner — collapse too
 * eagerly and a real choice disappears; collapse too little and Dex asks which
 * Calculator you meant.
 */
function identityOf(artifact: Artifact): string {
  const byName = artifact.kind === 'app' || artifact.kind === 'setting';
  const key = byName ? artifact.name : artifact.locator;
  return `${artifact.kind}:${key.trim().toLowerCase()}`;
}

/** Collapse candidates that point at the same thing, newest kept. */
function dedupe<T extends { artifact: Artifact }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const identity = identityOf(entry.artifact);
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(entry);
  }
  return out;
}

/**
 * The candidate phrases in a request, longest first.
 *
 * "the Q3 report" should be tried before "the Q3", so each determiner yields
 * every prefix of the words after it and the longest usable one wins. The
 * alternative — one pattern that decides where the phrase ends — cannot tell a
 * sentence-ending dot from a file extension.
 */
function phrasesIn(text: string): string[] {
  const seen = new Set<string>();

  for (const match of text.matchAll(REFERENCE)) {
    const words = match[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    const head = words[0]?.replace(/[.,?!]+$/, '');
    if (!head || NOT_A_THING.has(head)) continue;

    for (let n = words.length; n >= 1; n -= 1) {
      const phrase = words.slice(0, n).join(' ').replace(/[,?!]+$/, '').trim();
      // A trailing dot ends a sentence unless it is an extension.
      const cleaned = /\.\w{1,6}$/.test(phrase) ? phrase : phrase.replace(/\.+$/, '');
      if (!cleaned) continue;

      // Only phrases that could name something Dex produces. Without this,
      // "the volume" and "the internet" become references to resolve.
      if (!KIND_WORDS[cleaned.split(' ')[0]] && !/\.\w{1,6}$/.test(cleaned)) continue;
      seen.add(cleaned);
      break;
    }
  }

  return [...seen];
}

function score(artifact: Artifact, phrase: string): { points: number; reason: string } {
  const name = artifact.name.toLowerCase();
  const head = phrase.split(/\s+/)[0];

  if (name === phrase) return { points: 100, reason: 'name matches exactly' };
  if (stem(name) === stem(phrase)) return { points: 90, reason: 'name matches' };
  if (name.includes(phrase)) return { points: 70, reason: `"${phrase}" appears in the name` };

  const kind = KIND_WORDS[head];
  if (kind && artifact.kind === kind) {
    return { points: 40, reason: `most recent ${kind}` };
  }
  return { points: 0, reason: '' };
}

/** `Q3-report.pdf` and `report` should compare equal on the stem. */
function stem(value: string): string {
  return value.replace(/\.\w{1,6}$/, '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

/**
 * A tie is only genuine if the candidates are close in time.
 *
 * "The report" said a minute after producing one, when the other is from
 * yesterday, is not really ambiguous — treating it as such would make Dex ask
 * about things nobody is confused by, and an assistant that asks constantly
 * gets its questions clicked through without being read.
 */
function clearlyNewer(tied: Array<{ artifact: Artifact }>): boolean {
  const [first, second] = tied;
  return first.artifact.createdAt - second.artifact.createdAt > 30 * 60 * 1000;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
