/**
 * Triage — "reply to my unread mail" (or WhatsApp, Telegram, Slack…) as a
 * picture instead of a list: every message a point on two axes, urgency
 * across and importance up, the way an Eisenhower matrix sorts a to-do list.
 * Tap a point and the message opens, neatly, with the reply DEX drafted and
 * three answers: Yes (send it), No (leave it), Specify (say what to change).
 *
 * The agent sends the widget (`dex-ui triage`, dex-tools/ui.md) with a score
 * and a draft per message. Five or fewer read better as a list, so the chat
 * draws a list then and the plot only above that. Each answer is a short
 * command (`/triage yes w1 i3`) that main turns into the instruction the
 * agent needs — the draft to send, the thread it belongs to — while the chat
 * shows what the user did: "Yes, send my reply to Priya". No needs no agent
 * at all. Where each message stands (sending, sent, skipped) rides in the
 * widget itself, updated by `widget_update` events, so the phone sees it too.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

/** Where the messages came from; each platform draws its own mark. */
export const TRIAGE_SOURCES = ['email', 'gmail', 'outlook', 'whatsapp', 'telegram', 'slack', 'teams', 'discord', 'sms', 'messages'] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/**
 * What a message is about — each quadrant is split into a lane per category
 * present (three or four), so "Reply now" shows its academics apart from its
 * personal messages. Canonical order, left to right.
 */
export const TRIAGE_CATEGORIES = ['academics', 'work', 'personal', 'other'] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<TriageCategory, string> = { academics: 'Academics', work: 'Work', personal: 'Personal', other: 'Other' };

/** Where a message stands once the user has answered; `open` is back to undecided (a redraft). */
export const TRIAGE_STATES = ['open', 'sending', 'sent', 'skipped', 'changing', 'failed'] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

const ITEM_ID = /^[A-Za-z0-9][\w.:-]{0,63}$/;
const score = z.number().min(0).max(10);

export const TriageItemSchema = z.object({
  id: z.string().regex(ITEM_ID).optional(),
  from: text(80),
  /** Their address or handle: "priya@acme.com", "+91 98…", "@priya". */
  address: text(200).optional(),
  subject: text(160).optional(),
  /** The first lines, for the point's label and the list. */
  preview: text(300).optional(),
  /** The message itself, for the open card. */
  body: text(4000).optional(),
  /** When it came: "9:42 am", "Yesterday". */
  at: text(40).optional(),
  urgency: score,
  importance: score,
  /** One line on why it sits there: "Deadline today", "Your manager". */
  why: text(140).optional(),
  /** The reply DEX would send. None: no reply needed (a receipt, a newsletter). */
  draft: text(3000).optional(),
  source: z.enum(TRIAGE_SOURCES).optional(),
  /** What it's about: its lane within the quadrant. None: other. */
  category: z.enum(TRIAGE_CATEGORIES).optional(),
  state: z.enum(TRIAGE_STATES).optional(),
  /** What happened, when it didn't go to plan: "Gmail refused: quota". */
  note: text(200).optional(),
});
export type TriageItem = z.infer<typeof TriageItemSchema> & { id: string };

export const TriageWidgetSchema = z.object({
  type: z.literal('triage'),
  title: text(120).optional(),
  source: z.enum(TRIAGE_SOURCES).optional(),
  items: z.array(TriageItemSchema).min(1).max(40),
});
export type TriageWidget = Omit<z.infer<typeof TriageWidgetSchema>, 'items'> & { items: TriageItem[] };

/** More than this many messages: the plot. This many or fewer: a list. */
export const PLOT_ABOVE = 5;

export const categoryOf = (item: Pick<TriageItem, 'category'>): TriageCategory => item.category ?? 'other';

/**
 * The lanes a card's quadrants split into: the categories its messages have,
 * in canonical order. One category (or none given): no lanes, the whole
 * quadrant is one plot.
 */
export function lanesOf(items: Array<Pick<TriageItem, 'category'>>): TriageCategory[] {
  const present = new Set(items.map(categoryOf));
  return TRIAGE_CATEGORIES.filter((c) => present.has(c));
}

/* ── The four corners ──────────────────────────────────────────────── */

export type Quadrant = 'now' | 'quick' | 'plan' | 'later';

export const QUADRANTS: Record<Quadrant, { label: string; hint: string }> = {
  now: { label: 'Reply now', hint: 'Urgent and important' },
  quick: { label: 'Quick reply', hint: 'Urgent, less important' },
  plan: { label: 'Plan a reply', hint: 'Important, not urgent' },
  later: { label: 'Later', hint: 'Neither — or no reply needed' },
};

/** Scores split at the middle: 5 and up is high. */
export function quadrantOf(item: Pick<TriageItem, 'urgency' | 'importance'>): Quadrant {
  const urgent = item.urgency >= 5;
  const important = item.importance >= 5;
  if (urgent && important) return 'now';
  if (urgent) return 'quick';
  if (important) return 'plan';
  return 'later';
}

const RANK: Record<Quadrant, number> = { now: 0, quick: 1, plan: 2, later: 3 };

/** The order to go through them: reply now first, then quick ones, then the rest; within each, highest first. */
export function triageOrder<T extends Pick<TriageItem, 'urgency' | 'importance'>>(items: T[]): T[] {
  return [...items].sort((a, b) => RANK[quadrantOf(a)] - RANK[quadrantOf(b)] || (b.urgency + b.importance) - (a.urgency + a.importance));
}

/** Answered already: nothing left for the user to do on it. */
export const isSettled = (item: Pick<TriageItem, 'state'>): boolean => item.state === 'sent' || item.state === 'skipped' || item.state === 'sending';

/* ── Reading what agents write ─────────────────────────────────────── */

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const firstOf = (o: Loose, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');

const WORD_SCORES: Record<string, number> = {
  critical: 10, urgent: 9, asap: 9, 'very high': 9, high: 8, important: 8, medium: 5, moderate: 5, normal: 5, mid: 5,
  low: 2, 'very low': 1, minor: 2, none: 0,
};

/** A score as a number: "7" → 7, "high" → 8. The scale is settled for the whole card (scaleScores). */
export function normalizeScore(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') return n;
  return WORD_SCORES[raw.trim().toLowerCase()] ?? raw;
}

/**
 * Every score on 0–10, from the scale the agent used for the card as a whole:
 * all of them 1 or under means 0–1, any over 10 means 0–100. One card, one
 * scale: a single 0.5 on a 0–10 card is a near-zero score, not a half.
 */
export function scaleScores(items: Loose[]): void {
  const scores = items.flatMap((it) => [it.urgency, it.importance]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (scores.length === 0) return;
  const max = Math.max(...scores);
  const factor = max <= 1 ? 10 : max > 10 ? 0.1 : 1;
  for (const it of items) {
    for (const k of ['urgency', 'importance'] as const) {
      const v = it[k];
      if (typeof v === 'number' && !Number.isNaN(v)) it[k] = Math.max(0, Math.min(10, Math.round(v * factor * 10) / 10));
    }
  }
}

const SOURCE_WORDS: Record<string, TriageSource> = {
  email: 'email', mail: 'email', emails: 'email', gmail: 'gmail', google: 'gmail', outlook: 'outlook', microsoft: 'outlook', office: 'outlook',
  whatsapp: 'whatsapp', wa: 'whatsapp', telegram: 'telegram', tg: 'telegram', slack: 'slack', teams: 'teams', discord: 'discord',
  sms: 'sms', text: 'sms', messages: 'messages', imessage: 'messages',
};
const sourceOf = (v: unknown): unknown => (typeof v === 'string' ? SOURCE_WORDS[v.trim().toLowerCase()] ?? v : v);

const CATEGORY_WORDS: Record<string, TriageCategory> = {
  academics: 'academics', academic: 'academics', study: 'academics', studies: 'academics', school: 'academics', college: 'academics',
  university: 'academics', uni: 'academics', class: 'academics', course: 'academics', education: 'academics', exam: 'academics', exams: 'academics',
  work: 'work', job: 'work', office: 'work', professional: 'work', business: 'work', career: 'work', client: 'work', clients: 'work', team: 'work',
  personal: 'personal', family: 'personal', friends: 'personal', friend: 'personal', social: 'personal', home: 'personal', life: 'personal',
  other: 'other', others: 'other', misc: 'other', promotions: 'other', promotion: 'other', newsletter: 'other', newsletters: 'other',
  notification: 'other', notifications: 'other', automated: 'other', updates: 'other', finance: 'other', shopping: 'other',
};
/** "Studies", "Family", "Job" → its category; anything unknown is other. */
export function categoryFrom(v: unknown): TriageCategory | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  return CATEGORY_WORDS[v.trim().toLowerCase()] ?? 'other';
}

function normItem(raw: unknown, i: number): unknown {
  if (!isObj(raw)) return raw;
  const from = firstOf(raw, 'from', 'sender', 'name', 'who', 'author', 'contact');
  const item: Loose = {
    id: firstOf(raw, 'id', 'messageId', 'ref', 'threadId'),
    from: isObj(from) ? firstOf(from, 'name', 'email', 'address') : from,
    address: firstOf(raw, 'address', 'email', 'handle', 'phone', 'number') ?? (isObj(from) ? firstOf(from, 'email', 'address') : undefined),
    subject: firstOf(raw, 'subject', 'title', 'topic'),
    preview: firstOf(raw, 'preview', 'snippet', 'summary', 'excerpt', 'text', 'message'),
    body: firstOf(raw, 'body', 'content', 'full', 'fullText'),
    at: firstOf(raw, 'at', 'time', 'when', 'received', 'date'),
    urgency: normalizeScore(firstOf(raw, 'urgency', 'urgent', 'u', 'x')),
    importance: normalizeScore(firstOf(raw, 'importance', 'important', 'priority', 'i', 'y')),
    why: firstOf(raw, 'why', 'reason', 'because', 'rationale'),
    draft: firstOf(raw, 'draft', 'reply', 'suggestedReply', 'response', 'answer'),
    source: sourceOf(firstOf(raw, 'source', 'channel', 'app', 'platform')),
    category: categoryFrom(firstOf(raw, 'category', 'kind', 'area', 'type', 'group', 'context')),
    state: raw.state,
    note: raw.note,
  };
  if (typeof item.id === 'number') item.id = String(item.id);
  if (typeof item.id !== 'string' || !ITEM_ID.test(item.id)) item.id = `i${i + 1}`;
  if (typeof item.at === 'number') item.at = new Date(item.at).toISOString();
  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  return item;
}

/** The spec as the kit expects it, from what an agent wrote. */
export function normalizeTriage(raw: Loose): Loose {
  const items = firstOf(raw, 'items', 'messages', 'emails', 'mails', 'chats', 'points');
  const w: Loose = { ...raw, type: 'triage', source: sourceOf(firstOf(raw, 'source', 'channel', 'app', 'platform')) };
  if (w.source === undefined) delete w.source;
  if (Array.isArray(items)) {
    w.items = items.map(normItem);
    scaleScores((w.items as unknown[]).filter(isObj));
  }
  delete w.messages; delete w.emails; delete w.mails; delete w.chats; delete w.points; delete w.channel; delete w.app; delete w.platform;
  return w;
}

/** Ids unique, so a command names one message. */
export function withItemIds(items: Array<z.infer<typeof TriageItemSchema>>): TriageItem[] {
  const used = new Set<string>();
  return items.map((it, i) => {
    let id = it.id ?? `i${i + 1}`;
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    return { ...it, id };
  });
}

export const TRIAGE_SHAPE =
  '{"title":"Today\'s unread mail","source":"gmail","items":[{"id":"<the message or thread id>","from":"Priya Shah","address":"priya@acme.com","subject":"Q3 budget sign-off","preview":"Need your sign-off by 4 pm…","body":"<the message>","at":"9:42 am","urgency":9,"importance":8,"why":"Deadline today, your manager","category":"work","draft":"Hi Priya, signed off — …"}]} — urgency and importance 0–10; category academics, work, personal or other; no "draft" when no reply is needed';

/** "12 messages · 3 to reply now". */
export function triageLine(w: { title?: string; items: Array<Pick<TriageItem, 'urgency' | 'importance' | 'state'>> }): string {
  const now = w.items.filter((i) => quadrantOf(i) === 'now' && !isSettled(i)).length;
  const count = `${w.items.length} message${w.items.length === 1 ? '' : 's'}`;
  return [w.title, count, now ? `${now} to reply now` : ''].filter(Boolean).join(' · ');
}

/* ── Answers ───────────────────────────────────────────────────────── */

export type TriageDecision = 'yes' | 'no' | 'change';

export interface TriageCommand {
  decision: TriageDecision;
  widget: string;
  item: string;
  /** Yes: the reply as the user left it (they may have edited it). Change: what to change. */
  text?: string;
}

const COMMAND = /^\/triage\s+(yes|no|change|specify)\s+(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/i;

/** `/triage yes w1 i3`, `/triage change w1 i3 make it shorter`, or null. */
export function parseTriageCommand(input: string): TriageCommand | null {
  const m = COMMAND.exec(input.trim());
  if (!m) return null;
  const decision = m[1].toLowerCase() === 'specify' ? 'change' : (m[1].toLowerCase() as TriageDecision);
  const rest = m[4]?.trim();
  return { decision, widget: m[2], item: m[3], ...(rest ? { text: rest } : {}) };
}

/** What a card's buttons send (and the phone's). */
export function triageCommand(decision: TriageDecision, widget: string, item: string, text?: string): string {
  return `/triage ${decision} ${widget} ${item}${text?.trim() ? ` ${text.trim()}` : ''}`;
}

const TAG = (widget: string, item: string): string => `[triage ${widget}/${item}]`;
const whoAbout = (item: TriageItem): string => `${item.from}${item.address ? ` <${item.address}>` : ''}${item.subject ? ` (“${item.subject}”)` : ''}`;

/**
 * What the agent is told for an answer. The first line is what the chat
 * shows as the user's message; the tag after it names the card.
 */
export function triagePrompt(cmd: TriageCommand, item: TriageItem, source?: TriageSource): string {
  const via = item.source ?? source;
  const where = via ? ` on ${via === 'email' ? 'email' : via[0].toUpperCase() + via.slice(1)}` : '';
  if (cmd.decision === 'change') {
    const ask = cmd.text ?? 'write it differently';
    return [
      `Change my reply to ${item.from}: ${ask} ${TAG(cmd.widget, item.id)}`,
      `For the message from ${whoAbout(item)}${where}, redraft the reply: ${ask}.`,
      item.draft ? `The draft so far:\n---\n${item.draft}\n---` : '',
      `Put the new draft back on its card with \`dex-ui redraft ${cmd.widget} ${item.id}\` (the new text on stdin). Don't send it: I'll say Yes on the card. Then end your turn.`,
    ].filter(Boolean).join('\n');
  }
  const reply = cmd.text ?? item.draft;
  return [
    `Yes, send my reply to ${item.from}. ${TAG(cmd.widget, item.id)}`,
    reply
      ? `Send this reply to the message from ${whoAbout(item)}${where} — in the same thread, from the same account it came to, exactly as written:\n---\n${reply}\n---`
      : `Write a short reply to the message from ${whoAbout(item)}${where} and send it, in the same thread, from the same account it came to.`,
    `Once it's sent, run \`dex-ui mark ${cmd.widget} ${item.id} sent\` (or \`dex-ui mark ${cmd.widget} ${item.id} failed "<what went wrong>"\`), say so in one line and end your turn.`,
  ].join('\n');
}

const SHOWN = /^(.*\S)\s+\[triage [^\]\s]+\/[^\]\s]+\](?:\n|$)/;

/** The line the chat shows for an answer's prompt: "Yes, send my reply to Priya Shah." Null for anything else. */
export function typedTriage(prompt: string): string | null {
  return SHOWN.exec(prompt.trim())?.[1] ?? null;
}
