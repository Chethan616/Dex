/**
 * Widgets — DEX's generative UI, from a fixed kit (docs: dex-tools/ui.md).
 *
 * Instead of asking "where are you flying from?" in prose, or ending with
 * "visit https://… for details", the agent sends a small JSON spec with
 * `dex-ui` and the chat renders a real control: choice chips, a place field
 * with suggestions, a date strip and calendar, time slots, a stepper — or
 * result cards, link buttons and fact tables. Predefined components, so it
 * costs the agent a few hundred tokens, not a generated web page.
 *
 * An `ask` widget's answer goes back as the user's next message (like a
 * quick reply in WhatsApp or Telegram); the widget then shows as answered.
 * The phone renders the same specs (android/…/ui/components/Widgets.kt).
 */
import { z } from 'zod';

/** Glyphs a widget may name; each platform draws its own clean version. */
export const WIDGET_ICONS = [
  'flight', 'hotel', 'food', 'place', 'directions', 'calendar', 'time', 'mail', 'call', 'cart', 'money',
  'doc', 'code', 'music', 'link', 'person', 'star', 'ticket', 'car', 'train', 'weather', 'pc', 'check',
] as const;
export type WidgetIcon = (typeof WIDGET_ICONS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const Icon = z.enum(WIDGET_ICONS);
const SAFE_URL = /^(https?:\/\/|mailto:|tel:|geo:)/i;
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'times are HH:MM, 24-hour');

/** A button: opens a link, or sends `reply` as the user's next message. */
export const WidgetActionSchema = z.object({
  label: text(40),
  url: z.string().max(2000).regex(SAFE_URL, 'a url starts with https://, http://, mailto:, tel: or geo:').optional(),
  reply: text(500).optional(),
  primary: z.boolean().optional(),
  icon: Icon.optional(),
}).refine((a) => Boolean(a.url) !== Boolean(a.reply), { message: 'an action has a url or a reply (one of them)' });
export type WidgetAction = z.infer<typeof WidgetActionSchema>;

const fieldBase = {
  id: z.string().regex(/^[A-Za-z][\w-]{0,23}$/).optional(),
  label: text(60).optional(),
  optional: z.boolean().optional(),
};

const ChoiceOption = z.union([
  text(80),
  z.object({ label: text(80), detail: text(140).optional(), value: text(200).optional(), icon: Icon.optional() }),
]);

export const AskFieldSchema = z.discriminatedUnion('kind', [
  z.object({ ...fieldBase, kind: z.literal('choice'), options: z.array(ChoiceOption).min(2).max(12), multi: z.boolean().optional(), other: z.boolean().optional() }),
  z.object({ ...fieldBase, kind: z.literal('place'), placeholder: text(60).optional(), suggestions: z.array(text(80)).max(8).optional() }),
  z.object({ ...fieldBase, kind: z.literal('date'), min: ISO_DATE.optional(), max: ISO_DATE.optional(), default: ISO_DATE.optional(), range: z.boolean().optional() }),
  z.object({ ...fieldBase, kind: z.literal('time'), slots: z.array(HHMM).max(12).optional(), default: HHMM.optional() }),
  z.object({ ...fieldBase, kind: z.literal('number'), min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional(), default: z.number().optional(), unit: text(20).optional() }),
  z.object({ ...fieldBase, kind: z.literal('text'), placeholder: text(80).optional(), multiline: z.boolean().optional() }),
]);
export type AskField = z.infer<typeof AskFieldSchema> & { id: string };

export const CardSchema = z.object({
  title: text(100),
  subtitle: text(140).optional(),
  lines: z.array(text(140)).max(3).optional(),
  price: text(30).optional(),
  badge: text(24).optional(),
  icon: Icon.optional(),
  actions: z.array(WidgetActionSchema).max(3).optional(),
});
export type WidgetCard = z.infer<typeof CardSchema>;

export const WidgetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ask'), title: text(140), note: text(300).optional(), icon: Icon.optional(), fields: z.array(AskFieldSchema).min(1).max(6), submit: text(30).optional() }),
  z.object({ type: z.literal('cards'), title: text(120).optional(), icon: Icon.optional(), items: z.array(CardSchema).min(1).max(8) }),
  z.object({ type: z.literal('buttons'), title: text(120).optional(), buttons: z.array(WidgetActionSchema).min(1).max(6) }),
  z.object({ type: z.literal('facts'), title: text(120).optional(), icon: Icon.optional(), rows: z.array(z.object({ label: text(40), value: text(200) })).min(1).max(12), actions: z.array(WidgetActionSchema).max(3).optional() }),
]);
export type Widget = z.infer<typeof WidgetSchema>;
export type AskWidget = Omit<Extract<Widget, { type: 'ask' }>, 'fields'> & { fields: AskField[] };

/**
 * Parse an agent's spec: the widget with every field given an id, or a
 * short, fixable list of what's wrong (the agent reads it and tries again).
 */
export function parseWidget(raw: unknown): { widget: Widget; error: null } | { widget: null; error: string } {
  const r = WidgetSchema.safeParse(raw);
  if (!r.success) {
    const problems = r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(spec)'}: ${i.message}`);
    return { widget: null, error: problems.join('; ') };
  }
  const widget = r.data;
  if (widget.type === 'ask') {
    const used = new Set<string>();
    widget.fields.forEach((f, i) => {
      let id = f.id ?? `f${i + 1}`;
      while (used.has(id)) id = `${id}_`;
      used.add(id);
      f.id = id;
    });
    if (widget.fields.length > 1 && !widget.submit) widget.submit = 'Send';
  }
  return { widget, error: null };
}

/* ── Answers ─────────────────────────────────────────────────────────── */

export type AnswerValue =
  | { kind: 'choice'; picked: string[] }
  | { kind: 'place' | 'text'; text: string }
  | { kind: 'date'; start: string; end?: string }
  | { kind: 'time'; time: string }
  | { kind: 'number'; n: number };

export function optionLabel(o: z.infer<typeof ChoiceOption>): string {
  return typeof o === 'string' ? o : o.label;
}

/** "Fri, 9 Oct 2026" — the user's own locale, but never ambiguous. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "7:30 pm" for "19:30". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "1 adult", "2 adults": a plural unit loses its "s" for one. */
export function unitFor(unit: string, n: number): string {
  return n === 1 && /[^s]s$/i.test(unit) ? unit.slice(0, -1) : unit;
}

function valueText(field: AskField, v: AnswerValue): string {
  switch (v.kind) {
    // An option's own value rides along when the agent gave one: "Economy (ECONOMY)".
    case 'choice': return v.picked.map((p) => {
      const o = field.kind === 'choice' ? field.options.find((x) => optionLabel(x) === p) : undefined;
      return o && typeof o !== 'string' && o.value && o.value !== p ? `${p} (${o.value})` : p;
    }).join(', ');
    case 'place':
    case 'text': return v.text.trim();
    // The agent gets the ISO date too: "Fri, 9 Oct 2026 (2026-10-09)".
    case 'date': return v.end ? `${formatDay(v.start)} – ${formatDay(v.end)} (${v.start} to ${v.end})` : `${formatDay(v.start)} (${v.start})`;
    case 'time': return `${formatTime(v.time)} (${v.time})`;
    case 'number': {
      const unit = field.kind === 'number' && field.unit ? ` ${unitFor(field.unit, v.n)}` : '';
      return `${v.n}${unit}`;
    }
  }
}

/**
 * The message an answer sends: just the value for a one-field question
 * ("Hyderabad (HYD)"), "Label: value" lines for a form.
 */
export function formatAnswer(widget: AskWidget, values: Record<string, AnswerValue | undefined>): string {
  const parts = widget.fields
    .map((f) => ({ f, v: values[f.id] }))
    .filter((p): p is { f: AskField; v: AnswerValue } => p.v !== undefined && valueText(p.f, p.v) !== '');
  if (widget.fields.length === 1) return parts[0] ? valueText(parts[0].f, parts[0].v) : '';
  return parts.map(({ f, v }) => `${f.label ?? f.id}: ${valueText(f, v)}`).join('\n');
}

/** A one-line description, for previews and notifications: "Asks: Where are you flying from?" */
export function widgetLine(w: Widget): string {
  switch (w.type) {
    case 'ask': return w.title;
    case 'cards': return w.title ?? w.items[0]?.title ?? 'Results';
    case 'buttons': return w.title ?? w.buttons.map((b) => b.label).join(' · ');
    case 'facts': return w.title ?? w.rows.map((r) => `${r.label}: ${r.value}`).join(' · ');
  }
}

/**
 * Quick replies for a question with ready answers (a choice, or a place with
 * suggestions) — what the phone's notification offers as reply chips.
 */
export function quickReplies(w: Widget): string[] {
  if (w.type !== 'ask' || w.fields.length !== 1) return [];
  const f = w.fields[0];
  if (f.kind === 'choice' && !f.multi) return f.options.map(optionLabel).slice(0, 5);
  if (f.kind === 'place') return (f.suggestions ?? []).slice(0, 5);
  return [];
}
