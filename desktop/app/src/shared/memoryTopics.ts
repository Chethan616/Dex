/**
 * The words DEX's memory is organised by — shared by main (the index that
 * picks what a task is told) and the hub (Settings › Memory, About you).
 *
 * A note, a site and a routine each sit under one topic. A task is told only
 * what touches it: the words it shares with a note, and the topics its words
 * point at. "Fetch my attendance" names no site and no university, but
 * "attendance" points at study, and study is where the user's college and
 * their student portal sit — whichever ones they are. Nothing in here is about
 * any one user.
 */

export const TOPICS = {
  about: { label: 'About you', words: ['name', 'call', 'called', 'nickname', 'pronouns', 'age', 'birthday', 'born', 'language', 'languages', 'speak', 'occupation', 'student', 'retired'] },
  home: { label: 'Home', words: ['live', 'lives', 'living', 'city', 'home', 'address', 'based', 'timezone', 'country', 'neighbourhood', 'neighborhood', 'pincode', 'zip', 'weather', 'local'] },
  study: { label: 'Studies', words: ['study', 'studies', 'studying', 'student', 'college', 'university', 'uni', 'school', 'course', 'degree', 'semester', 'sem', 'year', 'exam', 'exams', 'attendance', 'timetable', 'marks', 'grades', 'grade', 'cgpa', 'gpa', 'assignment', 'assignments', 'lecture', 'lectures', 'professor', 'faculty', 'campus', 'class', 'classes', 'syllabus', 'portal', 'hostel', 'results', 'registration'] },
  work: { label: 'Work', words: ['work', 'works', 'job', 'company', 'office', 'role', 'team', 'manager', 'boss', 'colleague', 'client', 'clients', 'meeting', 'meetings', 'project', 'projects', 'salary', 'startup', 'business', 'freelance', 'shift', 'standup', 'deadline'] },
  prefs: { label: 'Preferences', words: ['prefer', 'prefers', 'preference', 'dislike', 'dislikes', 'hate', 'favourite', 'favorite', 'answers', 'replies', 'disturb', 'quiet'] },
  writing: { label: 'Writing', words: ['tone', 'email', 'emails', 'mail', 'message', 'messages', 'write', 'writing', 'formal', 'casual', 'signature', 'sign', 'draft'] },
  food: { label: 'Food', words: ['food', 'eat', 'eats', 'diet', 'vegetarian', 'vegan', 'eggetarian', 'halal', 'jain', 'allergy', 'allergic', 'restaurant', 'restaurants', 'cuisine', 'order', 'dinner', 'lunch', 'breakfast', 'swiggy', 'zomato', 'groceries'] },
  travel: { label: 'Travel', words: ['flight', 'flights', 'fly', 'train', 'trains', 'bus', 'airline', 'airport', 'station', 'seat', 'window', 'aisle', 'hotel', 'hotels', 'trip', 'travel', 'travels', 'visa', 'passport', 'booking', 'book', 'cab', 'uber'] },
  money: { label: 'Money', words: ['bank', 'upi', 'budget', 'pay', 'payment', 'payments', 'bill', 'bills', 'spend', 'cheapest', 'price', 'prices', 'buy', 'buying', 'shopping', 'shop', 'amazon', 'flipkart', 'deal', 'deals'] },
  health: { label: 'Health', words: ['health', 'doctor', 'medicine', 'medicines', 'gym', 'workout', 'fitness', 'sleep', 'diet', 'run', 'running', 'yoga', 'appointment'] },
  people: { label: 'People', words: ['mom', 'mother', 'dad', 'father', 'wife', 'husband', 'partner', 'friend', 'friends', 'brother', 'sister', 'son', 'daughter', 'family', 'girlfriend', 'boyfriend', 'roommate', 'contact'] },
  tech: { label: 'Tech', words: ['laptop', 'pc', 'computer', 'phone', 'windows', 'mac', 'linux', 'android', 'iphone', 'browser', 'chrome', 'editor', 'code', 'coding', 'github', 'programming', 'gpu', 'apps', 'startup', 'bloatware', 'temp', 'cleanup'] },
  fun: { label: 'Free time', words: ['music', 'spotify', 'movie', 'movies', 'show', 'shows', 'netflix', 'game', 'games', 'gaming', 'sport', 'sports', 'cricket', 'football', 'book', 'books', 'reading', 'hobby', 'hobbies', 'anime'] },
  routines: { label: 'Routines', words: ['routine', 'routines', 'workflow', 'workflows', 'automate', 'automation', 'schedule', 'scheduled', 'daily', 'weekly', 'remind', 'reminder', 'trigger'] },
  other: { label: 'Other', words: [] as string[] },
} as const;

export type Topic = keyof typeof TOPICS;
export const TOPIC_IDS = Object.keys(TOPICS) as Topic[];

/** Lowercase words, letters and digits only. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

const WORD_TOPIC = new Map<string, Topic[]>();
for (const id of TOPIC_IDS) {
  for (const w of TOPICS[id].words) WORD_TOPIC.set(w, [...(WORD_TOPIC.get(w) ?? []), id]);
}

/** Every topic the words of a text point at, most-pointed-at first. */
export function topicsIn(text: string): Topic[] {
  const count = new Map<Topic, number>();
  for (const w of wordsOf(text)) for (const t of WORD_TOPIC.get(w) ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** The one topic a note sits under. */
export function topicOf(text: string): Topic {
  return topicsIn(text)[0] ?? 'other';
}

export const isTopic = (v: unknown): v is Topic => typeof v === 'string' && v in TOPICS;

const SECRETS: RegExp[] = [
  // "password is …", "pin: 1234", "my api key = …"
  /\b(pass(word|wd|code|phrase)?|pwd|pin|otp|cvv|api[\s_-]?key|secret|token|private[\s_-]?key)\b\s*(is|was|=|:|-)\s*\S/i,
  // Keys by their shape: OpenAI/Anthropic, GitHub, Google, Slack, AWS.
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/,
  // A card number: 15–19 digits, spaces or dashes between.
  /\b\d(?:[ -]?\d){14,18}\b/,
];

/** A password, key or card number: never kept as a note. */
export function looksSecret(text: string): boolean {
  return SECRETS.some((re) => re.test(text));
}

/**
 * What another assistant said it knows about the user (pasted from ChatGPT
 * or Claude), as facts DEX can keep: one per line, bullets and numbering
 * off, headings and chatter out, secrets out. Pure, so the hub previews it
 * before anything is saved.
 */
export function parseImported(raw: string, max = 150): { facts: string[]; skipped: number } {
  const seen = new Set<string>();
  const facts: string[] = [];
  let skipped = 0;
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const text = line
      .replace(/^\s*(?:[-*•·◦‣>]|\d{1,3}[.)])\s*/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^\s*#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    // A heading ("Work:", "## Preferences"), or the assistant talking about the list.
    if (/^[^.!?]{1,40}:$/.test(text) || /^#/.test(line.trim())) continue;
    if (/^(here('s| is| are)|sure[,!.]|of course|certainly|these are|let me know|hope (this|that)|i (don't|do not) (have|remember|know))/i.test(text)) continue;
    if (wordsOf(text).length < 2) continue;
    if (looksSecret(text)) { skipped += 1; continue; }
    const clipped = text.length > 400 ? `${text.slice(0, 397)}…` : text;
    const key = wordsOf(clipped).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(clipped);
    if (facts.length >= max) break;
  }
  return { facts, skipped };
}

/** What to ask the other assistant: everything it knows, as bullets, no secrets. */
export const IMPORT_PROMPT =
  "I'm setting up a new assistant and want it to know me. List everything you remember about me — from your memory and our past conversations — " +
  'as short bullet points, one fact per line: who I am, my work or studies, where I live, people I mention, what I like and dislike, ' +
  'how I like answers and messages written, the tools and sites I use, my routines and goals. ' +
  'Leave out passwords, card numbers and anything secret. No headings and no commentary: only the bullets.';
