/**
 * Widgets — the chat's side of DEX's generative UI kit (shared/widgets.ts).
 *
 * A question comes with real controls instead of "where are you flying
 * from?" in prose: choice pills, a place field with suggestions, a strip of
 * days with a calendar behind it, time slots, a stepper. One-field questions
 * answer in a single tap; forms send once everything's filled. The answer
 * goes out as your next message, and the question folds to "answered".
 *
 * Results come as cards (a flight, a hotel, a place — with Select or
 * Directions), link buttons instead of "visit https://…", and fact tables.
 */
import React, { useMemo, useState } from 'react';
import {
  fieldShown, formatAnswer, formatDay, formatTime, optionLabel, unitFor,
  type AnswerValue, type AskField, type AskWidget, type Widget, type WidgetAction, type WidgetCard, type WidgetIcon,
} from '../../../shared/widgets';
import './widgets.css';

/* ── Glyphs: one clean, rounded line set ─────────────────────────────── */

const GLYPHS: Record<WidgetIcon | 'arrow' | 'open' | 'chevL' | 'chevR' | 'minus' | 'plus', React.ReactNode> = {
  // A plane seen from above, nose up and to the right.
  flight: <path transform="rotate(45 8 8)" d="M8 1.6c.55 0 .95.45.95 1.1v3.4l4.6 2.75v1.25L8.95 8.7v2.9l1.55 1.15v1.05L8 13.15l-2.5.65v-1.05l1.55-1.15V8.7L2.45 10.1V8.85l4.6-2.75V2.7c0-.65.4-1.1.95-1.1z" />,
  hotel: <><path d="M2 12.5V4M2 9.5h12v3M14 9.5V8a2 2 0 00-2-2H7.5v3.5" /><circle cx="4.6" cy="7.4" r="1.2" /></>,
  food: <path d="M4.5 1.8v4.4M3 1.8v3.4a1.5 1.5 0 003 0V1.8M4.5 6.6v7.6M11.5 14.2V1.8c-1.5.5-2.5 2.2-2.5 4.6v2.4h2.5" />,
  place: <><path d="M8 14.2s4.5-4.1 4.5-7.6a4.5 4.5 0 00-9 0c0 3.5 4.5 7.6 4.5 7.6z" /><circle cx="8" cy="6.6" r="1.6" /></>,
  directions: <path d="M7.3 1.9L1.9 7.3a1 1 0 000 1.4l5.4 5.4a1 1 0 001.4 0l5.4-5.4a1 1 0 000-1.4L8.7 1.9a1 1 0 00-1.4 0zM6 10V8.2c0-.7.5-1.2 1.2-1.2H10M8.6 5.6L10 7 8.6 8.4" />,
  calendar: <><rect x="2" y="3" width="12" height="11" rx="2.4" /><path d="M2 6.6h12M5.4 1.6v2.6M10.6 1.6v2.6" /></>,
  time: <><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.3 1.5" /></>,
  mail: <><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2" /><path d="M2.4 4.2L8 8.6l5.6-4.4" /></>,
  call: <path d="M5.6 2.3l1.3 2.9-1.4 1.2a7.6 7.6 0 004.1 4.1l1.2-1.4 2.9 1.3-.5 2.3a1.4 1.4 0 01-1.5 1.1A11.6 11.6 0 011.9 3.3a1.4 1.4 0 011.1-1.5z" />,
  cart: <><path d="M1.6 2.2h2l1.6 7.6h7.3l1.5-5.6H4.3" /><circle cx="6" cy="12.8" r="1.1" /><circle cx="11.5" cy="12.8" r="1.1" /></>,
  money: <><rect x="1.6" y="4" width="12.8" height="8" rx="2" /><circle cx="8" cy="8" r="1.8" /><path d="M4.2 6.4v3.2M11.8 6.4v3.2" /></>,
  doc: <><path d="M9.4 1.8H4.6a1.6 1.6 0 00-1.6 1.6v9.2a1.6 1.6 0 001.6 1.6h6.8a1.6 1.6 0 001.6-1.6V5.4z" /><path d="M9.4 1.8v3.6H13M5.8 8.6h4.4M5.8 11h3" /></>,
  code: <path d="M5.4 4.4L1.8 8l3.6 3.6M10.6 4.4L14.2 8l-3.6 3.6M9.2 2.8L6.8 13.2" />,
  music: <><path d="M6.2 12V3.4l7-1.4v8.4" /><circle cx="4.4" cy="12" r="1.8" /><circle cx="11.4" cy="10.4" r="1.8" /></>,
  link: <path d="M6.8 9.2a2.8 2.8 0 004 0l2.3-2.3a2.8 2.8 0 00-4-4l-.9.9M9.2 6.8a2.8 2.8 0 00-4 0L2.9 9.1a2.8 2.8 0 004 4l.9-.9" />,
  person: <><circle cx="8" cy="5.2" r="2.8" /><path d="M2.6 14a5.4 5.4 0 0110.8 0" /></>,
  star: <path d="M8 1.9l1.8 3.8 4.1.5-3 2.8.8 4.1L8 11.1l-3.7 2 .8-4.1-3-2.8 4.1-.5z" />,
  ticket: <path d="M2 5a1 1 0 011-1h10a1 1 0 011 1v1.3a1.7 1.7 0 000 3.4V11a1 1 0 01-1 1H3a1 1 0 01-1-1V9.7a1.7 1.7 0 000-3.4zM9.8 4v8" />,
  car: <><path d="M2.4 10.6V8.4l1.5-3.6c.2-.5.7-.8 1.2-.8h5.8c.5 0 1 .3 1.2.8l1.5 3.6v2.2a1 1 0 01-1 1H3.4a1 1 0 01-1-1zM2.6 8.4h10.8" /><circle cx="5" cy="10" r=".6" /><circle cx="11" cy="10" r=".6" /></>,
  train: <><rect x="3.4" y="1.8" width="9.2" height="9.6" rx="2.4" /><path d="M3.4 7.2h9.2M5.4 14.2l1.4-2.8M10.6 14.2l-1.4-2.8" /><circle cx="5.8" cy="9.4" r=".5" /><circle cx="10.2" cy="9.4" r=".5" /></>,
  weather: <><circle cx="6" cy="6" r="2.4" /><path d="M6 1.4v1M1.4 6h1M2.8 2.8l.7.7M9.2 2.8l-.7.7M5.6 13.6h6a2.4 2.4 0 00.2-4.8 3.2 3.2 0 00-6 .7 2.1 2.1 0 00-.2 4.1z" /></>,
  pc: <><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.8" /><path d="M5.6 14h4.8M8 11v3" /></>,
  check: <path d="M3.2 8.4l3.1 3 6.5-6.6" />,
  arrow: <path d="M3 8h9.4M8.8 4.4L12.4 8l-3.6 3.6" />,
  open: <path d="M6.6 3.6H4.4a1.6 1.6 0 00-1.6 1.6v6.4a1.6 1.6 0 001.6 1.6h6.4a1.6 1.6 0 001.6-1.6V9.4M9.2 2.6h4.2v4.2M13.2 2.8L7.6 8.4" />,
  chevL: <path d="M9.8 3.6L5.4 8l4.4 4.4" />,
  chevR: <path d="M6.2 3.6L10.6 8l-4.4 4.4" />,
  minus: <path d="M3.6 8h8.8" />,
  plus: <path d="M8 3.6v8.8M3.6 8h8.8" />,
};

export function Glyph({ name, size = 16 }: { name: keyof typeof GLYPHS; size?: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

/** The glyph a question wears when the agent didn't name one: from what it asks. */
function askGlyph(w: AskWidget): WidgetIcon {
  if (w.icon) return w.icon;
  const kinds = new Set(w.fields.map((f) => f.kind));
  if (kinds.has('place')) return 'place';
  if (kinds.has('date')) return 'calendar';
  if (kinds.has('time')) return 'time';
  return 'check';
}

/** A link's glyph, from where it goes. */
function actionGlyph(a: WidgetAction): keyof typeof GLYPHS {
  if (a.icon) return a.icon;
  if (a.reply) return 'arrow';
  const url = a.url ?? '';
  if (/^tel:/i.test(url)) return 'call';
  if (/^mailto:/i.test(url)) return 'mail';
  if (/^geo:|maps\.google|google\.[a-z.]+\/maps|maps\.app\.goo\.gl|maps\.apple/i.test(url)) return 'directions';
  if (/\/travel\/flights|flights?\b/i.test(url)) return 'flight';
  if (/\/travel\/hotels|booking\.com|airbnb/i.test(url)) return 'hotel';
  if (/calendar\.google|outlook\.live\.com\/calendar/i.test(url)) return 'calendar';
  return 'link';
}

/** geo: links have no handler on a PC: open them as a Google Maps search. */
function openable(url: string): string {
  const geo = /^geo:([-\d.]+),([-\d.]+)(?:\?q=(.*))?$/i.exec(url);
  if (geo) return `https://www.google.com/maps/search/?api=1&query=${geo[3] ?? `${geo[1]},${geo[2]}`}`;
  return url;
}

/** Web pages go where the chat opens them (a tab of the task); mail and phone links to the user's own apps. */
function openAction(url: string, onOpenUrl?: (u: string) => void): void {
  const target = openable(url);
  if (/^https?:\/\//i.test(target) && onOpenUrl) onOpenUrl(target);
  else void window.electronAPI?.widgets?.openUrl(target);
}

/* ── Dates ───────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso: string, n: number) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const inRange = (iso: string, min?: string, max?: string) => (!min || iso >= min) && (!max || iso <= max);

function dayLabel(iso: string, today: string): string | null {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  return null;
}

/* ── Fields ──────────────────────────────────────────────────────────── */

interface FieldProps<F extends AskField['kind']> {
  field: Extract<AskField, { kind: F }>;
  value: AnswerValue | undefined;
  /** `commit`: a one-field question sends straight away. */
  onChange: (v: AnswerValue | undefined, commit?: boolean) => void;
  solo: boolean;
}

function ChoiceField({ field, value, onChange, solo }: FieldProps<'choice'>): React.ReactElement {
  const picked = value?.kind === 'choice' ? value.picked : [];
  const [other, setOther] = useState<string | null>(null);
  const rich = field.options.some((o) => typeof o !== 'string' && o.detail);
  const pick = (label: string) => {
    if (field.multi) {
      const next = picked.includes(label) ? picked.filter((p) => p !== label) : [...picked, label];
      onChange(next.length ? { kind: 'choice', picked: next } : undefined);
    } else {
      onChange({ kind: 'choice', picked: [label] }, solo);
    }
  };
  return (
    <div className={rich ? 'cx-w-rows' : 'cx-w-opts'} role="group" aria-label={field.label}>
      {field.options.map((o) => {
        const label = optionLabel(o);
        const on = picked.includes(label);
        const detail = typeof o === 'string' ? undefined : o.detail;
        const icon = typeof o === 'string' ? undefined : o.icon;
        return (
          <button key={label} type="button" className={rich ? 'cx-w-row' : 'cx-w-opt'} aria-pressed={on} onClick={() => pick(label)}>
            {icon && <Glyph name={icon} size={15} />}
            {rich ? (
              <span className="cx-w-row__text"><span className="cx-w-row__title">{label}</span>{detail && <span className="cx-w-row__detail">{detail}</span>}</span>
            ) : label}
            {field.multi && on && <Glyph name="check" size={13} />}
          </button>
        );
      })}
      {field.other && other === null && (
        <button type="button" className={rich ? 'cx-w-row cx-w-row--ghost' : 'cx-w-opt cx-w-opt--ghost'} onClick={() => setOther('')}>Something else…</button>
      )}
      {field.other && other !== null && (
        <InlineInput
          autoFocus
          placeholder="Say what you'd like"
          value={other}
          onChange={setOther}
          onSubmit={(t) => onChange({ kind: 'choice', picked: [...(field.multi ? picked : []), t] }, solo && !field.multi)}
          send={solo && !field.multi}
        />
      )}
    </div>
  );
}

function PlaceField({ field, value, onChange, solo }: FieldProps<'place'>): React.ReactElement {
  const current = value?.kind === 'place' ? value.text : '';
  const [typed, setTyped] = useState('');
  return (
    <div className="cx-w-stack">
      {(field.suggestions?.length ?? 0) > 0 && (
        <div className="cx-w-opts" role="group" aria-label={field.label ?? 'Suggestions'}>
          {field.suggestions!.map((s) => (
            <button key={s} type="button" className="cx-w-opt" aria-pressed={current === s} onClick={() => onChange({ kind: 'place', text: s }, solo)}>
              <Glyph name="place" size={14} />{s}
            </button>
          ))}
        </div>
      )}
      <InlineInput
        icon="place"
        placeholder={field.placeholder ?? 'A city, airport or address'}
        value={typed}
        onChange={(t) => { setTyped(t); if (!solo) onChange(t.trim() ? { kind: 'place', text: t } : undefined); }}
        onSubmit={(t) => onChange({ kind: 'place', text: t }, solo)}
        send={solo}
      />
    </div>
  );
}

function Calendar({ month, onMonth, start, end, min, max, onPick }: {
  month: string; onMonth: (m: string) => void; start?: string; end?: string; min?: string; max?: string; onPick: (iso: string) => void;
}): React.ReactElement {
  const first = dateOf(month);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => isoOf(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const shift = (n: number) => onMonth(isoOf(new Date(first.getFullYear(), first.getMonth() + n, 1)));
  const today = isoOf(new Date());
  return (
    <div className="cx-w-cal">
      <div className="cx-w-cal__head">
        <button type="button" className="cx-w-icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Glyph name="chevL" /></button>
        <span>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="cx-w-icon-btn" onClick={() => shift(1)} aria-label="Next month"><Glyph name="chevR" /></button>
      </div>
      <div className="cx-w-cal__grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cx-w-cal__wd">{d}</span>)}
        {cells.map((iso, i) => iso === null ? <span key={`x${i}`} /> : (
          <button
            key={iso}
            type="button"
            className={[
              'cx-w-cal__day',
              iso === today ? 'cx-w-cal__day--today' : '',
              iso === start || iso === end ? 'cx-w-cal__day--on' : '',
              start && end && iso > start && iso < end ? 'cx-w-cal__day--between' : '',
            ].join(' ')}
            disabled={!inRange(iso, min, max)}
            onClick={() => onPick(iso)}
          >
            {dateOf(iso).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function DateField({ field, value, onChange, solo }: FieldProps<'date'>): React.ReactElement {
  const today = isoOf(new Date());
  const from = field.min && field.min > today ? field.min : today;
  const strip = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => inRange(d, field.min, field.max));
  const sel = value?.kind === 'date' ? value : field.default ? { kind: 'date' as const, start: field.default } : undefined;
  const [calOpen, setCalOpen] = useState(false);
  const [month, setMonth] = useState(() => { const d = dateOf(sel?.start ?? from); return isoOf(new Date(d.getFullYear(), d.getMonth(), 1)); });
  // A range: first tap starts it, the second ends it.
  const [rangeStart, setRangeStart] = useState<string | null>(null);

  const pick = (iso: string) => {
    if (!field.range) { onChange({ kind: 'date', start: iso }, solo); return; }
    if (!rangeStart || iso < rangeStart) { setRangeStart(iso); onChange({ kind: 'date', start: iso }); return; }
    setRangeStart(null);
    onChange({ kind: 'date', start: rangeStart, end: iso }, solo);
  };
  const on = (iso: string) => sel?.start === iso || (sel?.kind === 'date' && sel.end === iso);
  return (
    <div className="cx-w-stack">
      <div className="cx-w-days" role="group" aria-label={field.label ?? 'Pick a day'}>
        {strip.map((iso) => {
          const d = dateOf(iso);
          const special = dayLabel(iso, today);
          return (
            <button key={iso} type="button" className="cx-w-day" aria-pressed={on(iso)} onClick={() => pick(iso)}>
              <span className="cx-w-day__wd">{special ?? d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <span className="cx-w-day__n">{d.getDate()}</span>
              <span className="cx-w-day__m">{d.toLocaleDateString('en-GB', { month: 'short' })}</span>
            </button>
          );
        })}
        <button type="button" className="cx-w-day cx-w-day--more" aria-expanded={calOpen} onClick={() => setCalOpen((v) => !v)}>
          <Glyph name="calendar" size={18} />
          <span className="cx-w-day__m">{calOpen ? 'Close' : 'Other'}</span>
        </button>
      </div>
      {calOpen && <Calendar month={month} onMonth={setMonth} start={sel?.start} end={sel?.kind === 'date' ? sel.end : undefined} min={field.min ?? today} max={field.max} onPick={pick} />}
      {field.range && (
        <div className="cx-w-hint">
          {sel?.kind === 'date' && sel.end ? `${formatDay(sel.start)} → ${formatDay(sel.end)}` : rangeStart ? `From ${formatDay(rangeStart)} — now pick the last day` : 'Pick the first day, then the last'}
        </div>
      )}
    </div>
  );
}

function TimeField({ field, value, onChange, solo }: FieldProps<'time'>): React.ReactElement {
  const current = value?.kind === 'time' ? value.time : field.default;
  const [custom, setCustom] = useState(current && !(field.slots ?? []).includes(current) ? current : '');
  return (
    <div className="cx-w-stack">
      {(field.slots?.length ?? 0) > 0 && (
        <div className="cx-w-opts" role="group" aria-label={field.label ?? 'Pick a time'}>
          {field.slots!.map((t) => (
            <button key={t} type="button" className="cx-w-opt cx-w-opt--time" aria-pressed={current === t} onClick={() => onChange({ kind: 'time', time: t }, solo)}>
              {formatTime(t)}
            </button>
          ))}
        </div>
      )}
      <div className="cx-w-inline">
        <span className="cx-w-inline__icon"><Glyph name="time" size={15} /></span>
        <input
          type="time"
          className="cx-w-input cx-w-input--time"
          value={custom}
          aria-label={field.slots?.length ? 'Another time' : field.label ?? 'Time'}
          onChange={(e) => { setCustom(e.target.value); if (!solo && e.target.value) onChange({ kind: 'time', time: e.target.value }); }}
        />
        {solo && <button type="button" className="cx-w-send" disabled={!custom} onClick={() => onChange({ kind: 'time', time: custom }, true)}>Send</button>}
      </div>
    </div>
  );
}

function NumberField({ field, value, onChange, solo }: FieldProps<'number'>): React.ReactElement {
  const min = field.min ?? 0;
  const max = field.max ?? 99;
  const step = field.step ?? 1;
  const n = value?.kind === 'number' ? value.n : field.default ?? min;
  const set = (x: number) => onChange({ kind: 'number', n: Math.min(max, Math.max(min, Math.round(x / step) * step)) });
  return (
    <div className="cx-w-inline">
      <div className="cx-w-stepper">
        <button type="button" className="cx-w-icon-btn" disabled={n <= min} onClick={() => set(n - step)} aria-label="Less"><Glyph name="minus" /></button>
        <span className="cx-w-stepper__n">{n}{field.unit ? <span className="cx-w-stepper__unit"> {unitFor(field.unit, n)}</span> : null}</span>
        <button type="button" className="cx-w-icon-btn" disabled={n >= max} onClick={() => set(n + step)} aria-label="More"><Glyph name="plus" /></button>
      </div>
      {solo && <button type="button" className="cx-w-send" onClick={() => onChange({ kind: 'number', n }, true)}>Send</button>}
    </div>
  );
}

function TextField({ field, value, onChange, solo }: FieldProps<'text'>): React.ReactElement {
  const [typed, setTyped] = useState(value?.kind === 'text' ? value.text : '');
  return (
    <InlineInput
      placeholder={field.placeholder ?? 'Type here'}
      value={typed}
      multiline={field.multiline}
      onChange={(t) => { setTyped(t); if (!solo) onChange(t.trim() ? { kind: 'text', text: t } : undefined); }}
      onSubmit={(t) => onChange({ kind: 'text', text: t }, solo)}
      send={solo}
    />
  );
}

function InlineInput({ value, onChange, onSubmit, placeholder, send, icon, autoFocus, multiline }: {
  value: string; onChange: (t: string) => void; onSubmit: (t: string) => void; placeholder: string; send: boolean;
  icon?: keyof typeof GLYPHS; autoFocus?: boolean; multiline?: boolean;
}): React.ReactElement {
  const submit = () => { if (value.trim()) onSubmit(value.trim()); };
  const common = {
    className: `cx-w-input${multiline ? ' cx-w-input--multi' : ''}`,
    value,
    placeholder,
    autoFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && send) { e.preventDefault(); submit(); } },
  };
  return (
    <div className="cx-w-inline">
      {icon && <span className="cx-w-inline__icon"><Glyph name={icon} size={15} /></span>}
      {multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
      {send && <button type="button" className="cx-w-send" disabled={!value.trim()} onClick={submit}>Send</button>}
    </div>
  );
}

/* ── Ask ─────────────────────────────────────────────────────────────── */

function filled(f: AskField, v: AnswerValue | undefined): boolean {
  if (!v) return false;
  if (v.kind === 'date' && f.kind === 'date' && f.range) return Boolean(v.end);
  return true;
}

function AskView({ widget, answered, onReply }: { widget: AskWidget; answered: boolean; onReply?: (text: string) => void }): React.ReactElement {
  const solo = widget.fields.length === 1;
  const initial = useMemo(() => {
    const out: Record<string, AnswerValue | undefined> = {};
    for (const f of widget.fields) {
      if (f.kind === 'number') out[f.id] = { kind: 'number', n: f.default ?? f.min ?? 0 };
      if (f.kind === 'date' && f.default) out[f.id] = { kind: 'date', start: f.default };
      if (f.kind === 'time' && f.default) out[f.id] = { kind: 'time', time: f.default };
    }
    return out;
  }, [widget]);
  const [values, setValues] = useState(initial);
  const [sent, setSent] = useState(false);

  if (answered || sent) {
    return (
      <div className="cx-w cx-w--done">
        <span className="cx-w--done__check"><Glyph name="check" size={14} /></span>
        <span className="cx-w--done__title">{widget.title}</span>
      </div>
    );
  }
  // Somewhere that can't answer: say what's being asked, and where.
  if (!onReply) {
    return (
      <div className="cx-w cx-w--done cx-w--waiting">
        <span className="cx-w__glyph cx-w__glyph--small"><Glyph name={askGlyph(widget)} size={13} /></span>
        <span className="cx-w--done__title">{widget.title}</span>
        <span className="cx-w--waiting__hint">Waiting for your answer</span>
      </div>
    );
  }

  const send = (next: Record<string, AnswerValue | undefined>) => {
    const text = formatAnswer(widget, next);
    if (!text || !onReply) return;
    setSent(true);
    onReply(text);
  };
  const shown = widget.fields.filter((f) => fieldShown(widget, f, values));
  const ready = shown.every((f) => f.optional || filled(f, values[f.id]));

  return (
    <div className="cx-w" role="form" aria-label={widget.title}>
      <div className="cx-w__head">
        <span className="cx-w__glyph"><Glyph name={askGlyph(widget)} /></span>
        <div className="cx-w__titles">
          <span className="cx-w__title">{widget.title}</span>
          {widget.note && <span className="cx-w__note">{widget.note}</span>}
        </div>
      </div>
      {shown.map((f) => {
        const onChange = (v: AnswerValue | undefined, commit?: boolean) => {
          const next = { ...values, [f.id]: v };
          setValues(next);
          if (commit && v) send(next);
        };
        const props = { value: values[f.id], onChange, solo };
        return (
          <div key={f.id} className="cx-w__field">
            {!solo && f.label && <div className="cx-w__label">{f.label}{f.optional ? <span className="cx-w__optional"> · optional</span> : null}</div>}
            {f.kind === 'choice' && <ChoiceField field={f} {...props} />}
            {f.kind === 'place' && <PlaceField field={f} {...props} />}
            {f.kind === 'date' && <DateField field={f} {...props} />}
            {f.kind === 'time' && <TimeField field={f} {...props} />}
            {f.kind === 'number' && <NumberField field={f} {...props} />}
            {f.kind === 'text' && <TextField field={f} {...props} />}
          </div>
        );
      })}
      {(!solo || (widget.fields[0].kind === 'choice' && widget.fields[0].multi)) && (
        <div className="cx-w__foot">
          <button type="button" className="cx-w-send cx-w-send--wide" disabled={!ready} onClick={() => send(values)}>
            {widget.submit ?? 'Send'}<Glyph name="arrow" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Show ────────────────────────────────────────────────────────────── */

function ActionButton({ action, onReply, onOpenUrl, small }: { action: WidgetAction; onReply?: (t: string) => void; onOpenUrl?: (u: string) => void; small?: boolean }): React.ReactElement {
  const external = Boolean(action.url);
  return (
    <button
      type="button"
      className={`cx-wbtn${action.primary ? ' cx-wbtn--primary' : ''}${small ? ' cx-wbtn--small' : ''}`}
      title={action.url}
      onClick={() => (action.url ? openAction(action.url, onOpenUrl) : action.reply ? onReply?.(action.reply) : undefined)}
    >
      <Glyph name={actionGlyph(action)} size={small ? 13 : 15} />
      <span>{action.label}</span>
      {external && !small && <span className="cx-wbtn__out"><Glyph name="open" size={12} /></span>}
    </button>
  );
}

function CardRow({ card, onReply, onOpenUrl }: { card: WidgetCard; onReply?: (t: string) => void; onOpenUrl?: (u: string) => void }): React.ReactElement {
  return (
    <div className="cx-wc__item">
      <span className="cx-wc__icon"><Glyph name={card.icon ?? 'star'} size={17} /></span>
      <div className="cx-wc__text">
        <span className="cx-wc__title">{card.title}</span>
        {card.subtitle && <span className="cx-wc__sub">{card.subtitle}</span>}
        {card.lines?.map((l, i) => <span key={i} className="cx-wc__line">{l}</span>)}
      </div>
      {(card.price || card.badge) && (
        <div className="cx-wc__side">
          {card.price && <span className="cx-wc__price">{card.price}</span>}
          {card.badge && <span className="cx-wc__badge">{card.badge}</span>}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="cx-wc__actions">
          {card.actions.map((a, i) => <ActionButton key={i} action={a} onReply={onReply} onOpenUrl={onOpenUrl} small />)}
        </div>
      )}
    </div>
  );
}

export interface WidgetViewProps {
  widget: Widget;
  /** A later message exists: a question shows as answered. */
  answered: boolean;
  onReply?: (text: string) => void;
  onOpenUrl?: (url: string) => void;
}

export function WidgetView({ widget, answered, onReply, onOpenUrl }: WidgetViewProps): React.ReactElement {
  switch (widget.type) {
    case 'ask':
      return <AskView widget={widget as AskWidget} answered={answered} onReply={onReply} />;
    case 'cards':
      return (
        <div className="cx-wc">
          {widget.title && <div className="cx-wc__head">{widget.icon && <Glyph name={widget.icon} size={15} />}<span>{widget.title}</span></div>}
          {widget.items.map((c, i) => <CardRow key={i} card={{ ...c, icon: c.icon ?? widget.icon }} onReply={onReply} onOpenUrl={onOpenUrl} />)}
        </div>
      );
    case 'buttons':
      return (
        <div className="cx-wb">
          {widget.title && <div className="cx-wb__title">{widget.title}</div>}
          <div className="cx-wb__row">{widget.buttons.map((b, i) => <ActionButton key={i} action={b} onReply={onReply} onOpenUrl={onOpenUrl} />)}</div>
        </div>
      );
    case 'facts':
      return (
        <div className="cx-wc cx-wf">
          {widget.title && <div className="cx-wc__head">{widget.icon && <Glyph name={widget.icon} size={15} />}<span>{widget.title}</span></div>}
          <dl className="cx-wf__rows">
            {widget.rows.map((r, i) => (
              <div key={i} className="cx-wf__row"><dt>{r.label}</dt><dd>{r.value}</dd></div>
            ))}
          </dl>
          {widget.actions && widget.actions.length > 0 && (
            <div className="cx-wf__actions">{widget.actions.map((a, i) => <ActionButton key={i} action={a} onReply={onReply} onOpenUrl={onOpenUrl} small />)}</div>
          )}
        </div>
      );
  }
}
