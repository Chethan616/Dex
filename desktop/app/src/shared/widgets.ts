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

/* ── Reading what agents actually write ─────────────────────────────── */

// Agents guess the shape before (or instead of) reading ui.md. A live run
// sent `{"from": {"type": "text", …}, "date": {"type": "date"}}` with the
// title as an argument, got "Invalid input" twice and fell back to prose. So
// the kit reads the natural variants, and an error shows the shape to use.

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const firstOf = (o: Loose, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');

const KIND_ALIASES: Record<string, AskField['kind']> = {
  choice: 'choice', choices: 'choice', select: 'choice', options: 'choice', option: 'choice', radio: 'choice', dropdown: 'choice',
  chips: 'choice', enum: 'choice', buttons: 'choice', multiselect: 'choice', checkbox: 'choice', checkboxes: 'choice', boolean: 'choice', yesno: 'choice',
  place: 'place', city: 'place', location: 'place', airport: 'place', address: 'place', destination: 'place', origin: 'place', station: 'place',
  date: 'date', day: 'date', dates: 'date', daterange: 'date', calendar: 'date',
  time: 'time', slot: 'time', slots: 'time', clock: 'time',
  number: 'number', integer: 'number', int: 'number', count: 'number', stepper: 'number', quantity: 'number', numeric: 'number', float: 'number',
  text: 'text', string: 'text', input: 'text', textarea: 'text', free: 'text', freetext: 'text', email: 'text', phone: 'text', name: 'text',
};
const PLACE_WORDS = /\b(city|cities|airport|from|to|origin|destination|depart(ure|ing)?|arriv(al|e|ing)|location|address|place|station|where)\b/i;

function slugId(raw: string): string {
  const id = raw.replace(/[^\w-]+/g, '_').replace(/^[^A-Za-z]+/, '').slice(0, 24);
  return id || 'field';
}

function normAction(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const a: Loose = { ...raw };
  a.label = firstOf(raw, 'label', 'text', 'title', 'name');
  a.url = firstOf(raw, 'url', 'href', 'link');
  a.reply = firstOf(raw, 'reply', 'message', 'send', 'prompt', 'value');
  if (a.url && a.reply) delete a.reply;
  return a;
}

function normOption(o: unknown): unknown {
  if (typeof o === 'number' || typeof o === 'boolean') return String(o);
  if (!isObj(o)) return o;
  return { ...o, label: firstOf(o, 'label', 'title', 'name', 'text', 'value'), detail: firstOf(o, 'detail', 'description', 'subtitle', 'hint') };
}

function normField(key: string | undefined, raw: unknown): unknown {
  // {"from": "Departure city"}: a field named by its label.
  if (typeof raw === 'string') raw = { label: raw };
  if (!isObj(raw)) return raw;
  const f: Loose = { ...raw };
  const given = String(firstOf(raw, 'kind', 'type', 'input', 'widget') ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const options = firstOf(raw, 'options', 'choices', 'values', 'items');
  let kind = KIND_ALIASES[given] ?? (Array.isArray(options) ? 'choice' : 'text');
  const label = firstOf(raw, 'label', 'title', 'question', 'name', 'prompt');
  // A generic text field that's plainly a place ("from", "Departure city") gets the place control.
  if (kind === 'text' && (!given || given === 'text' || given === 'string' || given === 'input') && PLACE_WORDS.test(`${key ?? ''} ${String(label ?? '')}`)) kind = 'place';
  f.kind = kind;
  f.id = firstOf(raw, 'id') ?? (key ? slugId(key) : undefined);
  f.label = label;
  if (f.default === undefined && raw.value !== undefined) f.default = raw.value;
  if (['multiselect', 'checkbox', 'checkboxes'].includes(given)) f.multi = true;
  if (['dates', 'daterange'].includes(given)) f.range = true;
  if (kind === 'choice') {
    f.options = Array.isArray(options) ? options.map(normOption) : given === 'boolean' || given === 'yesno' ? ['Yes', 'No'] : options;
  } else if (kind === 'place' && Array.isArray(options) && !f.suggestions) {
    f.suggestions = options.map((o) => (isObj(o) ? firstOf(o, 'label', 'value', 'name') : String(o)));
  } else if (kind === 'time' && Array.isArray(options) && !f.slots) {
    f.slots = options;
  }
  if (kind === 'number') {
    for (const k of ['min', 'max', 'step', 'default']) if (typeof f[k] === 'string' && f[k] !== '' && !Number.isNaN(Number(f[k]))) f[k] = Number(f[k]);
  } else if (f.default !== undefined && typeof f.default !== 'string') {
    delete f.default;
  }
  return f;
}

const TYPE_ALIASES: Record<string, Widget['type']> = {
  ask: 'ask', form: 'ask', question: 'ask', questions: 'ask', input: 'ask', choose: 'ask',
  cards: 'cards', card: 'cards', results: 'cards', list: 'cards', options: 'cards',
  buttons: 'buttons', button: 'buttons', links: 'buttons', link: 'buttons',
  facts: 'facts', fact: 'facts', table: 'facts', summary: 'facts', details: 'facts',
};

/**
 * The spec as the kit expects it, from the shapes agents tend to write:
 * fields as a map keyed by id, `type` for a field's kind, common kind names
 * (select, city, stepper…), `question` for the title, `choices`, `value`,
 * links as `href`, facts as a plain map. `hint` carries what the command
 * line said: `dex-ui ask "Flight details"`.
 */
export function normalizeWidget(raw: unknown, hint: { type?: string; title?: string } = {}): unknown {
  const hintType = hint.type ? TYPE_ALIASES[hint.type.toLowerCase()] : undefined;
  if (Array.isArray(raw)) {
    const listKey = { ask: 'fields', cards: 'items', buttons: 'buttons', facts: 'rows' }[hintType ?? 'ask'];
    raw = { [listKey]: raw };
  }
  if (!isObj(raw)) return raw;
  // An unknown type stays as given, so the schema refuses it rather than guessing.
  const typeGiven = typeof raw.type === 'string' ? TYPE_ALIASES[raw.type.toLowerCase()] ?? (raw.type as Widget['type']) : undefined;
  const type = typeGiven ?? hintType ?? (raw.fields || raw.inputs ? 'ask' : raw.items || raw.cards || raw.results ? 'cards' : raw.buttons || raw.links ? 'buttons' : raw.rows || raw.facts ? 'facts' : 'ask');
  const w: Loose = { ...raw, type };
  const title = firstOf(raw, 'title', 'question', 'prompt', 'heading') ?? hint.title;
  if (title !== undefined) w.title = title;

  if (type === 'ask') {
    let fields = firstOf(raw, 'fields', 'inputs', 'questions');
    if (fields === undefined) {
      // No `fields`: the spec itself is the map of fields — what the live run sent.
      const reserved = new Set(['type', 'title', 'question', 'prompt', 'heading', 'note', 'icon', 'submit', 'button']);
      const entries = Object.entries(raw).filter(([k, v]) => !reserved.has(k) && (isObj(v) || typeof v === 'string'));
      if (entries.length) fields = Object.fromEntries(entries);
    }
    if (Array.isArray(fields)) w.fields = fields.map((f) => normField(undefined, f));
    else if (isObj(fields)) w.fields = Object.entries(fields).map(([k, v]) => normField(k, v));
    w.submit = firstOf(raw, 'submit', 'button', 'submitLabel');
    const list = Array.isArray(w.fields) ? (w.fields as Loose[]) : [];
    if (w.title === undefined) w.title = list.length === 1 && typeof list[0]?.label === 'string' ? list[0].label : 'A few details';
  } else if (type === 'cards') {
    const items = firstOf(raw, 'items', 'cards', 'results', 'options');
    if (Array.isArray(items)) {
      w.items = items.map((c) => (isObj(c) ? {
        ...c,
        title: firstOf(c, 'title', 'name', 'label'),
        subtitle: firstOf(c, 'subtitle', 'description', 'detail', 'summary'),
        actions: Array.isArray(firstOf(c, 'actions', 'buttons', 'links')) ? (firstOf(c, 'actions', 'buttons', 'links') as unknown[]).map(normAction) : undefined,
      } : c));
    }
  } else if (type === 'buttons') {
    const buttons = firstOf(raw, 'buttons', 'links', 'actions');
    if (Array.isArray(buttons)) w.buttons = buttons.map(normAction);
  } else if (type === 'facts') {
    const rows = firstOf(raw, 'rows', 'facts', 'items', 'data');
    if (isObj(rows)) w.rows = Object.entries(rows).map(([label, value]) => ({ label, value: String(value) }));
    else if (Array.isArray(rows)) w.rows = rows.map((r) => (isObj(r) ? { label: firstOf(r, 'label', 'key', 'name'), value: String(firstOf(r, 'value', 'text') ?? '') } : r));
    const actions = firstOf(raw, 'actions', 'buttons', 'links');
    if (Array.isArray(actions)) w.actions = actions.map(normAction);
  }
  return w;
}

/** What each kind looks like, for an error the agent can act on. */
const SHAPES: Record<Widget['type'], string> = {
  ask: '{"title":"Where and when are you flying?","fields":[{"id":"from","kind":"place","label":"From","suggestions":["Hyderabad (HYD)"]},{"id":"date","kind":"date","label":"Date"},{"id":"pax","kind":"number","label":"Travellers","min":1,"default":1}]} — kinds: choice (options), place (suggestions), date, time (slots "HH:MM"), number, text',
  cards: '{"title":"Flights","items":[{"title":"IndiGo 6E 2345","subtitle":"07:05 → 09:15","price":"₹4,850","actions":[{"label":"Select","reply":"Book 6E 2345"},{"label":"Open","url":"https://…"}]}]}',
  buttons: '{"buttons":[{"label":"Open in Google Flights","url":"https://www.google.com/travel/flights?q=…"}]}',
  facts: '{"title":"Your booking","rows":[{"label":"Flight","value":"6E 2345"}]}',
};

function issueText(i: z.core.$ZodIssue): string {
  const where = i.path.join('.') || '(spec)';
  if (i.code === 'invalid_type' && i.message.includes('undefined')) return `${where}: missing`;
  if (i.code === 'invalid_union' && i.path[i.path.length - 1] !== undefined && String(i.path[0]) === 'fields') return `${where}: unknown kind (choice, place, date, time, number or text)`;
  if (i.code === 'invalid_union') return `${where}: not one of the kit's shapes`;
  return `${where}: ${i.message}`;
}

/**
 * Parse an agent's spec: the widget with every field given an id, or a
 * short, fixable message — what's wrong and the shape to use.
 */
export function parseWidget(raw: unknown, hint: { type?: string; title?: string } = {}): { widget: Widget; error: null } | { widget: null; error: string } {
  const normal = normalizeWidget(raw, hint);
  const r = WidgetSchema.safeParse(normal);
  if (!r.success) {
    const problems = r.error.issues.slice(0, 5).map(issueText).join('; ');
    const type = (isObj(normal) && typeof normal.type === 'string' && normal.type in SHAPES ? normal.type : 'ask') as Widget['type'];
    return { widget: null, error: `${problems}. A ${type} looks like ${SHAPES[type]}` };
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
