/**
 * What the user has told DEX about themselves and wants kept: their name,
 * what they do, how they like answers, what a phrase of theirs means. One
 * short fact per note, filed under a topic (shared/memoryTopics.ts), in
 * `<userData>/memory/notes.json`.
 *
 * It's DEX's memory, not an engine's: Claude Code, Codex and BrowserCode are
 * all briefed from it (main/memory/recall.ts picks what bears on each task)
 * and all add to it with `dex-remember note`; the user sees, adds and removes
 * notes in Settings › Memory, and answers the questions in About you, which
 * land here too (`qid` ties a note to its question, so answering again
 * replaces it).
 *
 * Never a secret. A password, key or card number goes to the keychain as a
 * login (siteStore.ts) or nowhere: a note is plain text in a file, and it's
 * read into prompts.
 */
import crypto from 'node:crypto';
import { isTopic, looksSecret, topicOf, wordsOf, type Topic } from '../../shared/memoryTopics';
import { memoryFile, readJson, writeJson } from './files';

export { looksSecret };

export interface MemoryNote {
  id: string;
  text: string;
  /** Saved or last confirmed, ms since epoch. */
  at: number;
  /** Who added it: the user (Settings, About you, an import), or DEX during a task. */
  by: 'user' | 'dex';
  topic: Topic;
  /** Told to every task, not only the ones it bears on: their name, what they do. */
  core?: boolean;
  /** The About-you question it answers. */
  qid?: string;
}

export const MAX_NOTES = 300;
export const MAX_NOTE_CHARS = 400;
const NOTES_FILE = 'notes.json';
const ANSWERS_FILE = 'answers.json';

interface NotesFile { version: 1; notes: MemoryNote[] }

export type NoteResult = { note: MemoryNote; replaced?: MemoryNote } | { error: string };

export interface NoteOptions {
  replaces?: string;
  topic?: Topic;
  core?: boolean;
  qid?: string;
  now?: number;
}

const SECRET_REFUSAL =
  'That looks like a password, key or card number, which DEX never keeps as a note (notes are plain text, and they go into tasks). ' +
  'Save a site login with `dex-remember login <site> --user … --pass …`, which goes to the keychain; anything else, leave unsaved.';

let cached: MemoryNote[] | null = null;

function isNote(n: unknown): n is MemoryNote {
  const v = n as MemoryNote;
  return Boolean(v) && typeof v.id === 'string' && typeof v.text === 'string' && typeof v.at === 'number';
}

function load(): MemoryNote[] {
  if (cached) return cached;
  const raw = readJson<NotesFile>(memoryFile(NOTES_FILE));
  // One bad entry (an edit by hand) mustn't lose the others.
  cached = (Array.isArray(raw?.notes) ? raw.notes : []).filter(isNote).map((n) => ({
    id: n.id,
    text: n.text,
    at: n.at,
    by: n.by === 'user' ? 'user' : 'dex',
    topic: isTopic(n.topic) ? n.topic : topicOf(n.text),
    ...(n.core ? { core: true } : {}),
    ...(typeof n.qid === 'string' ? { qid: n.qid } : {}),
  }));
  return cached;
}

function save(notes: MemoryNote[]): void {
  writeJson(memoryFile(NOTES_FILE), { version: 1, notes } satisfies NotesFile);
  cached = notes;
}

/** Lowercase words only, so "Call me Chet." and "call me chet" are one note. */
const norm = (s: string): string => wordsOf(s).join(' ');

function newId(taken: Set<string>): string {
  for (;;) {
    const id = `m${crypto.randomBytes(3).toString('hex').slice(0, 4)}`;
    if (!taken.has(id)) return id;
  }
}

/** Newest first. */
export function listNotes(): MemoryNote[] {
  return [...load()].sort((a, b) => b.at - a.at);
}

/** A note by its id, or by words in it — when exactly one note has them all. */
export function findNote(ref: string): { note: MemoryNote } | { error: string } {
  const notes = load();
  const byId = notes.find((n) => n.id === ref.trim());
  if (byId) return { note: byId };
  const want = wordsOf(ref);
  if (want.length === 0) return { error: 'Say which note: its id, or words from it.' };
  const hits = notes.filter((n) => { const have = ` ${norm(n.text)} `; return want.every((w) => have.includes(` ${w}`)); });
  if (hits.length === 1) return { note: hits[0] };
  if (hits.length === 0) return { error: `No note matches “${ref.trim()}”.` };
  return { error: `Several notes match — say which by its id: ${hits.slice(0, 6).map((n) => `[${n.id}] ${n.text}`).join('; ')}` };
}

/**
 * Keep a fact. The same fact again only refreshes it; `replaces` (an id or
 * words) swaps an outdated one out — "Lives in Pune now" for the old city.
 */
export function addNote(text: string, by: MemoryNote['by'], options: NoteOptions | string = {}): NoteResult {
  const opts: NoteOptions = typeof options === 'string' ? { replaces: options } : options;
  const now = opts.now ?? Date.now();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'Nothing to remember.' };
  if (clean.length > MAX_NOTE_CHARS) return { error: `Keep a note under ${MAX_NOTE_CHARS} characters: one fact per note.` };
  if (looksSecret(clean)) return { error: SECRET_REFUSAL };

  let notes = [...load()];
  let replaced: MemoryNote | undefined;
  if (opts.replaces?.trim()) {
    const found = findNote(opts.replaces);
    if ('error' in found) return found;
    replaced = found.note;
    notes = notes.filter((n) => n.id !== replaced!.id);
  }
  if (opts.qid) {
    replaced ??= notes.find((n) => n.qid === opts.qid);
    notes = notes.filter((n) => n.qid !== opts.qid);
  }

  const topic = opts.topic ?? topicOf(clean);
  const same = notes.find((n) => norm(n.text) === norm(clean));
  if (same) {
    const note: MemoryNote = { ...same, text: clean, at: now, topic: opts.topic ?? same.topic, ...(opts.core ? { core: true } : {}), ...(opts.qid ? { qid: opts.qid } : {}) };
    save(notes.map((n) => (n.id === same.id ? note : n)));
    return { note, replaced };
  }

  const note: MemoryNote = {
    id: newId(new Set(notes.map((n) => n.id))), text: clean, at: now, by, topic,
    ...(opts.core ? { core: true } : {}),
    ...(opts.qid ? { qid: opts.qid } : {}),
  };
  notes.push(note);
  // Full: the oldest go first.
  if (notes.length > MAX_NOTES) notes = notes.sort((a, b) => a.at - b.at).slice(notes.length - MAX_NOTES);
  save(notes);
  return { note, replaced };
}

export function forgetNote(ref: string): { forgotten: MemoryNote } | { error: string } {
  const found = findNote(ref);
  if ('error' in found) return found;
  save(load().filter((n) => n.id !== found.note.id));
  if (found.note.qid) setAnswerValue(found.note.qid, null);
  return { forgotten: found.note };
}

/** Facts pasted in from another assistant: each kept as the user's own. */
export function importFacts(facts: string[]): { saved: number; skipped: number } {
  let saved = 0;
  let skipped = 0;
  const now = Date.now();
  facts.forEach((f, i) => {
    // Oldest-first timestamps keep the list in the order it was pasted.
    const r = addNote(f, 'user', { now: now - facts.length + i });
    if ('error' in r) skipped += 1; else saved += 1;
  });
  return { saved, skipped };
}

/* ── About you: the raw answers, so the questions show what was said ── */

export function getAnswers(): Record<string, string> {
  const raw = readJson<{ answers?: Record<string, unknown> }>(memoryFile(ANSWERS_FILE));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw?.answers ?? {})) if (typeof v === 'string') out[k] = v;
  return out;
}

function setAnswerValue(qid: string, value: string | null): void {
  const answers = getAnswers();
  if (value === null) delete answers[qid]; else answers[qid] = value;
  writeJson(memoryFile(ANSWERS_FILE), { version: 1, answers });
}

/**
 * One About-you answer: kept as given, and as the note it makes (which
 * replaces the last one). An empty answer clears both.
 */
export function answerQuestion(qid: string, value: string, note: { text: string; topic: Topic; core?: boolean } | null): NoteResult | { cleared: true } {
  const clean = value.trim();
  if (!clean || !note) {
    const old = load().find((n) => n.qid === qid);
    if (old) save(load().filter((n) => n.id !== old.id));
    setAnswerValue(qid, null);
    return { cleared: true };
  }
  const r = addNote(note.text, 'user', { qid, topic: note.topic, core: note.core });
  if (!('error' in r)) setAnswerValue(qid, clean);
  return r;
}

/** Test seam. */
export function _resetNotes(): void {
  cached = null;
}
