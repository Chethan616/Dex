/**
 * Reactions on chat messages, like WhatsApp's or Grok's: you can react to
 * any message (DEX's or your own) with any emoji, and DEX reacts to yours
 * only when it means something — 👍 to a go-ahead, ❤️ to a thank-you —
 * never to every message.
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

/** The quick row, before "+" opens every emoji. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👀'] as const;

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

/** Chips to draw under a message: one per emoji, with who added it. */
export function chipsFor(reactions: Reaction[] | undefined): Array<{ emoji: string; count: number; mine: boolean; agent: boolean }> {
  const chips: Array<{ emoji: string; count: number; mine: boolean; agent: boolean }> = [];
  for (const r of reactions ?? []) {
    let chip = chips.find((c) => c.emoji === r.emoji);
    if (!chip) { chip = { emoji: r.emoji, count: 0, mine: false, agent: false }; chips.push(chip); }
    chip.count += 1;
    if (r.by === 'user') chip.mine = true; else chip.agent = true;
  }
  return chips;
}
