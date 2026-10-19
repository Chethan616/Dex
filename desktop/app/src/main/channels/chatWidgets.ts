/**
 * A task's widgets (shared/widgets.ts) in a chat app. The hub draws them;
 * WhatsApp, Telegram and Discord get a message plus buttons: a question's
 * ready answers, a card's Select, a link. Telegram and Discord show real
 * buttons; WhatsApp numbers the answers ("reply 2") and lists the links.
 */
import { optionLabel, widgetLine, type AskField, type Widget } from '../../shared/widgets';

export interface ChatButton {
  label: string;
  /** Sent back as the user's answer when pressed. */
  reply?: string;
  /** Opened when pressed. */
  url?: string;
}

export interface ChatPrompt {
  /** The message, in DEX's chat markup (*bold*, _italic_). */
  text: string;
  /** Rows of buttons; the adapter that can't draw buttons gets `numbered` instead. */
  rows: ChatButton[][];
  /** Whether it waits for the user's answer (a question), not just shows something. */
  asks: boolean;
}

const MAX_ROWS = 5;
const MAX_PER_ROW = 3;
const label = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function fieldLine(f: AskField): string {
  const name = f.label ?? 'Answer';
  switch (f.kind) {
    case 'choice': return `• *${name}*: ${f.options.map(optionLabel).join(' / ')}${f.multi ? ' (any of them)' : ''}`;
    case 'place': return `• *${name}*${f.suggestions?.length ? `: e.g. ${f.suggestions.slice(0, 3).join(', ')}` : ''}`;
    case 'date': return `• *${name}*: a date${f.range ? ' range' : ''}`;
    case 'time': return `• *${name}*${f.slots?.length ? `: ${f.slots.join(', ')}` : ': a time'}`;
    case 'number': return `• *${name}*: a number${f.unit ? ` (${f.unit})` : ''}${f.default !== undefined ? `, ${f.default} if you skip it` : ''}`;
    case 'text': return `• *${name}*`;
  }
}

/** One row per button for long labels, else a few per row; at most five rows. */
function layout(buttons: ChatButton[]): ChatButton[][] {
  const long = buttons.some((b) => b.label.length > 18);
  const per = long ? 1 : MAX_PER_ROW;
  const rows: ChatButton[][] = [];
  for (let i = 0; i < buttons.length && rows.length < MAX_ROWS; i += per) rows.push(buttons.slice(i, i + per));
  return rows;
}

export function widgetToChat(w: Widget): ChatPrompt | null {
  switch (w.type) {
    case 'ask': {
      const head = [`*${w.title}*`, w.note].filter(Boolean).join('\n');
      const fields = w.fields as AskField[];
      if (fields.length === 1) {
        const f = fields[0];
        const answers = f.kind === 'choice' && !f.multi ? f.options.map((o) => ({ label: optionLabel(o), reply: typeof o === 'string' ? o : (o.value ?? o.label) }))
          : f.kind === 'place' ? (f.suggestions ?? []).map((s) => ({ label: s, reply: s }))
          : f.kind === 'time' ? (f.slots ?? []).map((s) => ({ label: s, reply: s }))
          : [];
        const other = f.kind !== 'choice' || f.other || f.multi;
        const hint = answers.length ? (other ? '_Pick one, or type your own answer._' : '_Pick one._') : `_Type your answer${f.kind === 'date' ? ' (a date like "Friday" or "12 Nov")' : ''}._`;
        return { text: `${head}\n\n${f.kind === 'choice' && f.multi ? `${fieldLine(f)}\n\n` : ''}${hint}`, rows: layout(answers.slice(0, 12).map((a) => ({ label: label(a.label), reply: a.reply }))), asks: true };
      }
      return { text: `${head}\n\n${fields.map(fieldLine).join('\n')}\n\n_Answer in one message, e.g. "${fields.slice(0, 2).map((f) => f.label ?? 'answer').join(', ')} …"._`, rows: [], asks: true };
    }
    case 'cards': {
      const lines = w.items.map((c, i) => {
        const top = `*${i + 1}. ${c.title}*${c.price ? ` · ${c.price}` : ''}${c.badge ? ` · ${c.badge}` : ''}`;
        return [top, c.subtitle, ...(c.lines ?? [])].filter(Boolean).join('\n');
      });
      const buttons: ChatButton[] = [];
      w.items.forEach((c, i) => {
        const pick = c.actions?.find((a) => a.reply);
        if (pick?.reply) buttons.push({ label: label(`${i + 1}. ${pick.label === 'Select' ? c.title : pick.label}`), reply: pick.reply });
        const url = c.url ?? c.actions?.find((a) => a.url)?.url;
        if (url) buttons.push({ label: label(`Open ${i + 1}`), url });
      });
      const asks = buttons.some((b) => b.reply);
      return { text: [w.title ? `*${w.title}*` : null, lines.join('\n\n')].filter(Boolean).join('\n\n'), rows: layout(buttons), asks };
    }
    case 'buttons':
      return { text: w.title ? `*${w.title}*` : 'Here you go:', rows: layout(w.buttons.map((b) => ({ label: label(b.label), reply: b.reply, url: b.url }))), asks: w.buttons.some((b) => b.reply) };
    case 'facts': {
      const rows = w.rows.map((r) => `*${r.label}:* ${r.value}`).join('\n');
      return { text: [w.title ? `*${w.title}*` : null, rows].filter(Boolean).join('\n\n'), rows: layout((w.actions ?? []).map((a) => ({ label: label(a.label), reply: a.reply, url: a.url }))), asks: false };
    }
    case 'chart':
      return { text: `📊 ${widgetLine(w)}`, rows: [], asks: false };
    // Triage cards, saved workflows and custom views need the app.
    case 'triage':
    case 'workflows':
    case 'custom':
      return { text: `${widgetLine(w)}\n\n_Open the task in DEX to see it._`, rows: [], asks: false };
  }
}

/**
 * The same prompt as plain text, for a chat without buttons: answers
 * numbered ("reply 2"), links written out. Returns the replies in number order.
 */
export function numbered(prompt: ChatPrompt): { text: string; replies: string[] } {
  const replies: string[] = [];
  const picks: string[] = [];
  const links: string[] = [];
  for (const b of prompt.rows.flat()) {
    if (b.reply) { replies.push(b.reply); picks.push(`*${replies.length}.* ${b.label.replace(/^\d+\.\s*/, '')}`); }
    else if (b.url) links.push(`${b.label}: ${b.url}`);
  }
  const parts = [prompt.text];
  if (picks.length) parts.push(`${picks.join('\n')}\n\n_↩ Reply with a number, or your own answer._`);
  if (links.length) parts.push(links.join('\n'));
  return { text: parts.join('\n\n'), replies };
}

/** "2", "#2", "2." or an option's own words → that answer; otherwise null. */
export function pickedReply(text: string, replies: string[], labels: string[] = replies): string | null {
  const t = text.trim();
  const n = /^#?(\d{1,2})\.?$/.exec(t);
  if (n) return replies[Number(n[1]) - 1] ?? null;
  const i = labels.findIndex((l) => l.trim().toLowerCase() === t.toLowerCase());
  return i >= 0 ? replies[i] : null;
}
