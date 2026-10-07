/**
 * DEX's reactions on your messages, like a person's in a chat (Grok's,
 * WhatsApp's): only when one says it better than words — 👍 to "ok go on"
 * after it asked you something, ❤️ to a thank-you — never on every message.
 * You don't react (the owner found it off); DEX does, sparingly: by rule
 * (autoReaction, below) and, rarely, by choice (`dex-react`).
 *
 * A reaction is an event in the task's log, so it survives restarts and
 * reaches the phone. It names its message by a key both sides can work out
 * from the transcript alone:
 *   'u:prompt'  the task's first message
 *   'u:<at>'    a later message of yours (its user_input event's time)
 *   'a:<at>'    a reply of DEX's (the time its first words arrived)
 */
export type ReactionBy = 'user' | 'agent';

export interface ReactionEvent {
  type: 'reaction';
  target: string;
  emoji: string;
  by: ReactionBy;
  /** false takes it back. */
  on: boolean;
  at?: number;
}

export interface Reaction {
  emoji: string;
  by: ReactionBy;
}

/** message key → its reactions, in the order they were added. */
export type Reactions = Record<string, Reaction[]>;

export function userMessageKey(at: number | undefined, isPrompt: boolean): string | null {
  if (isPrompt) return 'u:prompt';
  return typeof at === 'number' ? `u:${at}` : null;
}

export function agentMessageKey(at: number | undefined): string | null {
  return typeof at === 'number' ? `a:${at}` : null;
}

const TARGET = /^(u:prompt|[ua]:\d{1,16})$/;

/** A reaction an outside party (the phone, the agent) may record. */
export function validReaction(target: unknown, emoji: unknown): { target: string; emoji: string } | null {
  if (typeof target !== 'string' || !TARGET.test(target)) return null;
  if (typeof emoji !== 'string') return null;
  const e = emoji.trim();
  // One emoji, however many code points it takes (skin tones, ZWJ families,
  // flags, keycaps) — not a sentence.
  if (!e || e.length > 32) return null;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(e)) return null;
  const rest = e
    .replace(/[#*0-9]\ufe0f?\u20e3/gu, '')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|[\u{e0020}-\u{e007f}]/gu, '');
  if (rest.length > 0) return null;
  return { target, emoji: e };
}

/** Everyone's reactions now, from the log in order. */
export function foldReactions(events: ReadonlyArray<{ type?: string } & Record<string, unknown>>): Reactions {
  const out: Reactions = {};
  for (const e of events) {
    if (e.type !== 'reaction') continue;
    const target = String(e.target ?? '');
    const emoji = String(e.emoji ?? '');
    const by: ReactionBy = e.by === 'agent' ? 'agent' : 'user';
    if (!target || !emoji) continue;
    const list = (out[target] ?? []).filter((r) => !(r.emoji === emoji && r.by === by));
    if (e.on !== false) list.push({ emoji, by });
    if (list.length) out[target] = list; else delete out[target];
  }
  return out;
}

/** What a message shows: DEX's emoji on it (yours, from before, aren't shown). */
export function agentEmojis(reactions: Reaction[] | undefined): string[] {
  return [...new Set((reactions ?? []).filter((r) => r.by === 'agent').map((r) => r.emoji))];
}

const GO_AHEAD = /^(ok|okay|k|kk|yes|yep|yeah|yup|sure|alright|go|go on|go ahead|do it|proceed|continue|carry on|sounds good|perfect|great|book it|send it|ship it|please do|lgtm|fine|cool|that works|works for me|confirm|confirmed)( (please|then|dex|go on|go ahead|do it|yes|sure|thanks))*$/;
const THANKS = /^(thanks|thank you|thank u|thx|ty|tysm|cheers)( (so much|a lot|dex|man|bro|buddy|again))*$/;
const LAUGH = /^((ha){2,}h?|lol|lmao|rofl)$/;

/**
 * DEX's own reaction to a follow-up of yours, or null — and null is the
 * usual answer. A plain go-ahead gets 👍 only when DEX had just asked you
 * something (`asked`); a thank-you gets ❤️; a laugh 😂. Anything longer
 * than a few words is a real message and gets a real answer instead.
 */
export function autoReaction(text: string, asked: boolean): string | null {
  const t = text.toLowerCase().replace(/\p{Extended_Pictographic}|‍|️/gu, ' ').replace(/[.!,;:~?\s]+/g, ' ').trim();
  if (!t || t.split(' ').length > 6) return null;
  if (THANKS.test(t)) return '❤️';
  if (LAUGH.test(t)) return '😂';
  if (asked && GO_AHEAD.test(t)) return '👍';
  return null;
}

/**
 * Did DEX's last turn end by asking you something — a widget question, an
 * approval, or words ending on a "?"? (Events of the task so far, in order.)
 */
export function endedOnQuestion(events: ReadonlyArray<{ type?: string } & Record<string, unknown>>): boolean {
  let text = '';
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === 'user_input') break;
    if (e.type === 'widget' && (e.widget as { type?: string } | undefined)?.type === 'ask') return true;
    if (e.type === 'confirmation' && e.status === 'pending') return true;
    if (e.type === 'done' && typeof e.summary === 'string' && !text) text = e.summary;
    if (e.type === 'thinking' && typeof e.text === 'string') text = e.text + text;
    if (e.type === 'tool_call' && text) break;
  }
  // Agents often end "…What date? How many of you? Once you tell me, I'll search." —
  // a question near the end counts, not only a final "?".
  return text.trim().slice(-400).includes('?');
}
