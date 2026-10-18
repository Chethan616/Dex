/**
 * The triage card (shared/triage.ts): messages to answer, plotted by urgency
 * (across) and importance (up) with the axes through the middle, the way the
 * reviewer sketched it. Tap a point and the message opens below with DEX's
 * draft and three answers — Yes sends it, No leaves it, Specify says what to
 * change. Five or fewer messages read better as a list, so they get one.
 *
 * Answers go out as `/triage …` commands through the chat's normal follow-up
 * path; main turns Yes and Specify into instructions for the agent and marks
 * No by itself. Where each message stands comes back in the widget (sending,
 * sent, skipped), and until it does the card shows the answer at once.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS, PLOT_ABOVE, QUADRANTS, TRIAGE_CATEGORIES, categoryOf, cornerRange, isSettled, lanesOf, quadrantOf, triageCommand, triageOrder, withinCorner,
  type Quadrant, type TriageCategory, type TriageItem, type TriageState, type TriageWidget,
} from '../../../shared/triage';
import { Glyph } from './Widgets';
import './triage.css';

const SOURCE_NAME: Record<string, string> = {
  email: 'Email', gmail: 'Gmail', outlook: 'Outlook', whatsapp: 'WhatsApp', telegram: 'Telegram', slack: 'Slack',
  teams: 'Teams', discord: 'Discord', sms: 'SMS', messages: 'Messages',
};

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* ── The plot ─────────────────────────────────────────────────────── */

/*
 * Two levels. The overview is honest: every message sits exactly where its
 * urgency (across) and importance (up) put it — position means priority and
 * nothing else; colour says what it's about. Tap a corner and it opens on its
 * own, its axes in real numbers, split into one small plot per category with
 * the same axes: the corner's work, personal, academic and other messages
 * side by side, so neither the layout nor the category can make one look
 * more pressing than it is.
 */

const W = 600;
const H = 380;
/** Room above for "Importance ↑" and below for "Urgency →". */
const PAD_T = 18;
const PAD_B = 18;
/** The gap between the corners, where the axes run. */
const GAP = 12;
/** A corner's header: its name, count and category mix. */
const HEAD = 34;
const INSET = 8;
const R = 11;

const Q_ORDER: Quadrant[] = ['plan', 'now', 'later', 'quick'];

interface Box { x: number; y: number; w: number; h: number }
interface Placed { item: TriageItem; x: number; y: number }

/** Where each corner sits: plan and now on top, later and quick below. */
function cornerBox(q: Quadrant): Box {
  const qw = (W - GAP) / 2;
  const qh = (H - PAD_T - PAD_B - GAP) / 2;
  const right = q === 'now' || q === 'quick';
  const top = q === 'plan' || q === 'now';
  return { x: right ? qw + GAP : 0, y: PAD_T + (top ? 0 : qh + GAP), w: qw, h: qh };
}

/** A message's spot in a box drawn for its corner's range: urgency across, importance up, both exact. */
function spot(item: TriageItem, b: Box, r: number): { x: number; y: number } {
  const [fu, fi] = withinCorner(item);
  return { x: b.x + r + (b.w - 2 * r) * fu, y: b.y + r + (b.h - 2 * r) * (1 - fi) };
}

/** Points that would cover each other are nudged apart a little, never out of their box. */
function spread(items: TriageItem[], boxOf: (it: TriageItem) => Box, r: number): Placed[] {
  const placed: Placed[] = [];
  for (const item of triageOrder(items)) {
    const b = boxOf(item);
    const base = spot(item, b, r);
    const minX = b.x + r;
    const maxX = Math.max(minX, b.x + b.w - r);
    const minY = b.y + r;
    const maxY = Math.max(minY, b.y + b.h - r);
    let { x, y } = base;
    for (let k = 1, a = 0; k < 48 && placed.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * r + 2); k += 1) {
      a += 2.4;
      x = Math.min(maxX, Math.max(minX, base.x + Math.cos(a) * (2 + k * 2)));
      y = Math.min(maxY, Math.max(minY, base.y + Math.sin(a) * (2 + k * 2)));
    }
    placed.push({ item, x, y });
  }
  return placed;
}

const fmt = (n: number): string => String(Number(n.toFixed(1)));

const scoreLine = (it: TriageItem): string =>
  `Urgency ${fmt(it.urgency)} · Importance ${fmt(it.importance)} · ${CATEGORY_LABELS[categoryOf(it)]}`;

function Point({ item, x, y, r, on, dim, onSelect, onHover }: {
  item: TriageItem; x: number; y: number; r: number; on: boolean; dim: boolean;
  onSelect: (id: string) => void; onHover: (id: string | null) => void;
}): React.ReactElement {
  const state = item.state ?? 'open';
  return (
    <g
      className={`tri-pt tri-cat--${categoryOf(item)} tri-pt--${state}${on ? ' tri-pt--on' : ''}${dim ? ' tri-pt--dim' : ''}`}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={`${item.from}${item.subject ? `: ${item.subject}` : ''} — ${QUADRANTS[quadrantOf(item)].label}, ${scoreLine(item)}${state === 'sent' ? ', sent' : state === 'skipped' ? ', skipped' : ''}`}
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); onSelect(item.id); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(item.id); } }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(null)}
    >
      {on && <circle className="tri-pt__ring" r={r + 4} />}
      <circle className="tri-pt__dot" r={r} />
      {state === 'sent' ? (
        <path className="tri-pt__mark" d={`M${-r * 0.42} ${r * 0.05}l${r * 0.28} ${r * 0.28}L${r * 0.44} ${-r * 0.33}`} />
      ) : (
        <text className="tri-pt__ini" textAnchor="middle" dy="0.35em" style={{ fontSize: r * 0.86 }}>{initials(item.from)}</text>
      )}
    </g>
  );
}

function Tip({ placed, hover, w, h }: { placed: Placed[]; hover: string | null; w: number; h: number }): React.ReactElement | null {
  const tip = placed.find((p) => p.item.id === hover);
  if (!tip) return null;
  return (
    <div className="tri-tip" style={{ left: `${(tip.x / w) * 100}%`, top: `${(tip.y / h) * 100}%` }} aria-hidden="true">
      <b>{tip.item.from}</b>
      {(tip.item.subject ?? tip.item.preview) && <span>{tip.item.subject ?? tip.item.preview}</span>}
      <em>{scoreLine(tip.item)}</em>
    </div>
  );
}

/** The categories on the card, with counts: tap one to pick out its messages everywhere. */
function Legend({ items, lanes, focus, onFocus }: {
  items: TriageItem[]; lanes: TriageCategory[]; focus: TriageCategory | null; onFocus: (c: TriageCategory | null) => void;
}): React.ReactElement | null {
  if (lanes.length < 2) return null;
  return (
    <div className="tri-legend" role="group" aria-label="Show one kind of message">
      {lanes.map((c) => (
        <button
          key={c}
          type="button"
          className={`tri-legend__item tri-cat--${c}`}
          aria-pressed={focus === c}
          onClick={() => onFocus(focus === c ? null : c)}
        >
          <i aria-hidden="true" />{CATEGORY_LABELS[c]}<b>{items.filter((it) => categoryOf(it) === c).length}</b>
        </button>
      ))}
    </div>
  );
}

/** A corner's category mix as one thin bar: what it's mostly about, at a glance. */
function MixBar({ items, x, y, w }: { items: TriageItem[]; x: number; y: number; w: number }): React.ReactElement {
  const total = items.length;
  if (total === 0) return <rect className="tri-mix__empty" x={x} y={y} width={w} height="4" rx="2" />;
  let at = x;
  const parts = TRIAGE_CATEGORIES.map((c) => ({ c, n: items.filter((it) => categoryOf(it) === c).length })).filter((p) => p.n > 0);
  return (
    <g>
      {parts.map(({ c, n }, i) => {
        const pw = (w * n) / total;
        const rect = <rect key={c} className={`tri-mix__part tri-cat--${c}`} x={at + (i ? 1 : 0)} y={y} width={Math.max(0, pw - (i ? 1 : 0))} height="4" rx="2"><title>{`${CATEGORY_LABELS[c]}: ${n}`}</title></rect>;
        at += pw;
        return rect;
      })}
    </g>
  );
}

function Overview({ items, selected, focus, onSelect, onZoom }: {
  items: TriageItem[]; selected: string | null; focus: TriageCategory | null;
  onSelect: (id: string) => void; onZoom: (q: Quadrant) => void;
}): React.ReactElement {
  const placed = useMemo(() => spread(items, (it) => {
    const c = cornerBox(quadrantOf(it));
    return { x: c.x + INSET, y: c.y + HEAD, w: c.w - INSET * 2, h: c.h - HEAD - INSET };
  }, R), [items]);
  const [hover, setHover] = useState<string | null>(null);
  const cx = W / 2;
  const cy = PAD_T + (H - PAD_T - PAD_B) / 2;
  return (
    <div className="tri-plot__area">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Messages by urgency and importance">
        {Q_ORDER.map((q) => {
          const c = cornerBox(q);
          const inQ = items.filter((it) => quadrantOf(it) === q);
          // An empty corner has nothing to open.
          const opens = inQ.length > 0;
          return (
            <g
              key={q}
              className={`tri-corner tri-corner--${q}${opens ? ' tri-corner--opens' : ''}`}
              {...(opens ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': `Open ${QUADRANTS[q].label}: ${inQ.length} message${inQ.length === 1 ? '' : 's'}, by category`,
                onClick: () => onZoom(q),
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onZoom(q); } },
              } : {})}
            >
              <rect className="tri-corner__bg" x={c.x} y={c.y} width={c.w} height={c.h} rx="12" />
              <text className="tri-corner__name" x={c.x + 10} y={c.y + 16}>{QUADRANTS[q].label}</text>
              {opens && <text className="tri-corner__count" x={c.x + c.w - 10} y={c.y + 16} textAnchor="end">{inQ.length}<tspan className="tri-corner__chev" dx="4">›</tspan></text>}
              <MixBar items={inQ} x={c.x + 10} y={c.y + 22} w={c.w - 20} />
            </g>
          );
        })}
        {/* The axes run through the gaps between the corners, arrows out. */}
        <g className="tri-axis">
          <path d={`M2 ${cy}H${W - 2}M${W - 9} ${cy - 5}l7 5-7 5`} />
          <path d={`M${cx} ${H - PAD_B}V${PAD_T - 6}M${cx - 5} ${PAD_T + 1}l5-7 5 7`} />
        </g>
        <text className="tri-al" x={cx + 9} y={11}>Importance</text>
        <text className="tri-al" x={W - 2} y={H - 4} textAnchor="end">Urgency →</text>
        {placed.map(({ item, x, y }) => (
          <Point key={item.id} item={item} x={x} y={y} r={R} on={item.id === selected} dim={Boolean(focus && categoryOf(item) !== focus)} onSelect={onSelect} onHover={setHover} />
        ))}
      </svg>
      <Tip placed={placed} hover={hover} w={W} h={H} />
    </div>
  );
}

/* One corner, opened: a small plot per category, the same exact axes. */
const ZW = 600;
const ZH = 250;
const Z_HEAD = 24;
const Z_FOOT = 16;
/** Room on the left for the importance scale. */
const Z_LEFT = 22;
const Z_GAP = 10;
const ZR = 13;
const TICKS = [0, 0.5, 1];

function Breakdown({ q, items, lanes, selected, focus, onSelect }: {
  q: Quadrant; items: TriageItem[]; lanes: TriageCategory[]; selected: string | null; focus: TriageCategory | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const cats = lanes.length ? lanes : (['other'] as TriageCategory[]);
  const k = cats.length;
  const cw = (ZW - Z_LEFT - Z_GAP * (k - 1)) / k;
  const inQ = useMemo(() => items.filter((it) => quadrantOf(it) === q), [items, q]);
  const boxFor = (c: TriageCategory): Box => {
    const i = cats.indexOf(c);
    return { x: Z_LEFT + i * (cw + Z_GAP), y: Z_HEAD, w: cw, h: ZH - Z_HEAD - Z_FOOT };
  };
  const plotH = ZH - Z_HEAD - Z_FOOT;
  const placed = useMemo(() => spread(inQ, (it) => boxFor(categoryOf(it)), ZR), [inQ, k]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<string | null>(null);
  const [uLo, uHi, iLo, iHi] = cornerRange(q);
  return (
    <div className="tri-plot__area">
      <svg viewBox={`0 0 ${ZW} ${ZH}`} role="group" aria-label={`${QUADRANTS[q].label}, by category`}>
        {TICKS.map((t) => (
          <text key={t} className="tri-sub__tick" x={Z_LEFT - 5} y={Z_HEAD + ZR + (plotH - 2 * ZR) * (1 - t)} dy="0.35em" textAnchor="end">{fmt(iLo + (iHi - iLo) * t)}</text>
        ))}
        {cats.map((c) => {
          const b = boxFor(c);
          const n = inQ.filter((it) => categoryOf(it) === c).length;
          return (
            <g key={c} className={`tri-sub tri-cat--${c}${focus && focus !== c ? ' tri-sub--dim' : ''}`}>
              <circle className="tri-sub__dot" cx={b.x + 6} cy={12} r="4" />
              <text className="tri-sub__name" x={b.x + 15} y={16}>{CATEGORY_LABELS[c]}</text>
              <text className="tri-sub__count" x={b.x + b.w} y={16} textAnchor="end">{n}</text>
              <rect className="tri-sub__bg" x={b.x} y={b.y} width={b.w} height={b.h} rx="10" />
              {/* Quarter lines, so a point's place reads as a number. */}
              {[0.25, 0.5, 0.75].map((t) => (
                <g key={t}>
                  <line className="tri-sub__grid" x1={b.x + b.w * t} y1={b.y + 4} x2={b.x + b.w * t} y2={b.y + b.h - 4} />
                  <line className="tri-sub__grid" x1={b.x + 4} y1={b.y + b.h * t} x2={b.x + b.w - 4} y2={b.y + b.h * t} />
                </g>
              ))}
              {TICKS.map((t) => (
                <text key={t} className="tri-sub__tick" x={b.x + ZR + (b.w - 2 * ZR) * t} y={ZH - 3} textAnchor="middle">{fmt(uLo + (uHi - uLo) * t)}</text>
              ))}
              {n === 0 && <text className="tri-sub__none" x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle">None</text>}
            </g>
          );
        })}
        {placed.map(({ item, x, y }) => (
          <Point key={item.id} item={item} x={x} y={y} r={ZR} on={item.id === selected} dim={Boolean(focus && categoryOf(item) !== focus)} onSelect={onSelect} onHover={setHover} />
        ))}
      </svg>
      <Tip placed={placed} hover={hover} w={ZW} h={ZH} />
      <div className="tri-zoom__axes">In each: urgency {uLo}–{uHi} across, importance {iLo}–{iHi} up</div>
    </div>
  );
}

/* ── One message, opened ──────────────────────────────────────────── */

const STATE_WORDS: Partial<Record<TriageState, string>> = {
  sending: 'Sending…',
  sent: 'Sent',
  skipped: 'Skipped',
  changing: 'Redrafting…',
  failed: 'Didn’t send',
};

function Message({ item, source, onAnswer, inRow }: {
  item: TriageItem;
  source?: string;
  onAnswer: (decision: 'yes' | 'no' | 'change', text?: string) => void;
  /** Opened under its row in the list: the row already says who and what. */
  inRow?: boolean;
}): React.ReactElement {
  const q = quadrantOf(item);
  const [draft, setDraft] = useState(item.draft ?? '');
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState('');
  const askRef = useRef<HTMLInputElement>(null);
  // A redraft from the agent replaces what's in the box.
  useEffect(() => { setDraft(item.draft ?? ''); }, [item.draft]);
  useEffect(() => { if (asking) askRef.current?.focus(); }, [asking]);

  const state = item.state ?? 'open';
  const busy = state === 'sending' || state === 'changing';
  const done = state === 'sent';
  const via = SOURCE_NAME[item.source ?? source ?? ''] ?? null;
  const edited = draft.trim() && draft.trim() !== (item.draft ?? '').trim() ? draft.trim() : undefined;

  const specify = (): void => {
    if (!ask.trim()) return;
    onAnswer('change', ask.trim());
    setAsk('');
    setAsking(false);
  };

  return (
    <div className={`tri-msg tri-msg--${q}${inRow ? ' tri-msg--in-row' : ''}`}>
      {inRow ? (
        <div className="tri-msg__tags">
          {item.why && <span className="tri-msg__why">{item.why}</span>}
          <span className="tri-msg__addr">{[item.address, via, item.at].filter(Boolean).join(' · ')}</span>
        </div>
      ) : (
        <>
          <div className="tri-msg__head">
            <span className={`tri-av tri-cat--${categoryOf(item)}`} aria-hidden="true">{initials(item.from)}</span>
            <div className="tri-msg__who">
              <span className="tri-msg__from">{item.from}</span>
              {(item.address || via) && <span className="tri-msg__addr">{[item.address, via].filter(Boolean).join(' · ')}</span>}
            </div>
            {item.at && <span className="tri-msg__at">{item.at}</span>}
          </div>
          <div className="tri-msg__tags">
            <span className={`tri-chip tri-chip--${q}`}>{QUADRANTS[q].label}</span>
            <span className={`tri-chip tri-chip--cat tri-cat--${categoryOf(item)}`}><i aria-hidden="true" />{CATEGORY_LABELS[categoryOf(item)]}</span>
            <span className="tri-msg__score">Urgency {fmt(item.urgency)} · Importance {fmt(item.importance)}</span>
          </div>
          {item.why && <div className="tri-msg__why">{item.why}</div>}
          {item.subject && <div className="tri-msg__subject">{item.subject}</div>}
        </>
      )}
      {(item.body ?? item.preview) && <div className="tri-msg__body">{item.body ?? item.preview}</div>}

      <div className="tri-reply">
        <div className="tri-reply__label">
          <Glyph name="mail" size={13} />
          <span>{item.draft ? 'DEX’s reply' : 'No reply needed'}</span>
          {STATE_WORDS[state] && <span className={`tri-state tri-state--${state}`}>{STATE_WORDS[state]}</span>}
        </div>
        {(item.draft || draft) && (
          <textarea
            className="tri-reply__text"
            value={draft}
            readOnly={busy || done}
            rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Reply to ${item.from}`}
          />
        )}
        {item.note && <div className="tri-reply__note">{item.note}</div>}
      </div>

      {!done && (
        asking ? (
          <form className="tri-ask" onSubmit={(e) => { e.preventDefault(); specify(); }}>
            <input
              ref={askRef}
              className="tri-ask__input"
              value={ask}
              placeholder={`What should change? e.g. “say I’ll call at 5”`}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); }}
              aria-label="What should change in the reply"
            />
            <button type="submit" className="cx-wbtn cx-wbtn--primary cx-wbtn--small" disabled={!ask.trim()}>Redraft</button>
            <button type="button" className="cx-wbtn cx-wbtn--small" onClick={() => setAsking(false)}>Cancel</button>
          </form>
        ) : (
          <div className="tri-actions">
            <button type="button" className="cx-wbtn cx-wbtn--primary" disabled={busy} onClick={() => onAnswer('yes', edited)}>
              <Glyph name="check" size={15} />
              <span>{item.draft || draft.trim() ? (edited ? 'Yes, send my edit' : 'Yes, send') : 'Reply anyway'}</span>
            </button>
            <button type="button" className="cx-wbtn" disabled={busy || state === 'skipped'} onClick={() => onAnswer('no')}>No</button>
            <button type="button" className="cx-wbtn" disabled={busy} onClick={() => setAsking(true)}>Specify…</button>
          </div>
        )
      )}
    </div>
  );
}

/* ── The card ─────────────────────────────────────────────────────── */

export function TriageView({ widget, wid, onReply }: { widget: TriageWidget; wid?: string; onReply?: (text: string) => void }): React.ReactElement {
  // An answer shows at once, and holds until the card's own state for that
  // message moves (main marks it a moment later; the agent when it's sent).
  const [local, setLocal] = useState<Record<string, { state: TriageState; base: TriageState | undefined }>>({});
  const items = useMemo(() => widget.items.map((it) => {
    const mine = local[it.id];
    return mine && it.state === mine.base ? { ...it, state: mine.state } : it;
  }), [widget.items, local]);
  const order = useMemo(() => triageOrder(items), [items]);
  const plotted = items.length > PLOT_ABOVE;
  const [view, setView] = useState<'plot' | 'list'>(plotted ? 'plot' : 'list');
  const [zoom, setZoom] = useState<Quadrant | null>(null);
  const [focus, setFocus] = useState<TriageCategory | null>(null);
  const lanes = useMemo(() => lanesOf(items), [items]);
  const [selected, setSelected] = useState<string | null>(() => order.find((i) => !isSettled(i))?.id ?? order[0]?.id ?? null);
  const handled = items.filter(isSettled).length;
  const nowLeft = items.filter((i) => quadrantOf(i) === 'now' && !isSettled(i)).length;
  const source = widget.source ? SOURCE_NAME[widget.source] : null;
  const open = items.find((i) => i.id === selected) ?? null;

  const answer = (item: TriageItem, decision: 'yes' | 'no' | 'change', text?: string): void => {
    if (!wid || !onReply) return;
    onReply(triageCommand(decision, wid, item.id, text));
    const base = widget.items.find((i) => i.id === item.id)?.state;
    setLocal((l) => ({ ...l, [item.id]: { state: decision === 'yes' ? 'sending' : decision === 'no' ? 'skipped' : 'changing', base } }));
    // Yes and No settle it: on to the next one still waiting, most pressing first.
    if (decision !== 'change') {
      const next = order.find((i) => i.id !== item.id && !isSettled(i));
      if (next) window.setTimeout(() => setSelected(next.id), 260);
    }
  };

  return (
    <div className="tri">
      <div className="tri__head">
        <span className="tri__glyph"><Glyph name="mail" size={15} /></span>
        <div className="tri__titles">
          <span className="tri__title">{widget.title ?? 'Messages to answer'}</span>
          <span className="tri__sub">
            {[`${items.length} message${items.length === 1 ? '' : 's'}`, source, nowLeft ? `${nowLeft} to reply now` : null, handled ? `${handled} answered` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {plotted && (
          <div className="tri__views" role="tablist" aria-label="Show as">
            <button type="button" role="tab" aria-selected={view === 'plot'} onClick={() => setView('plot')}>Plot</button>
            <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
        )}
      </div>
      <div className="tri__progress" aria-hidden="true"><i style={{ width: `${(handled / Math.max(1, items.length)) * 100}%` }} /></div>

      {view === 'plot' ? (
        <>
          <div className="tri-plot">
            <div className="tri-plot__bar">
              {zoom ? (
                <>
                  <button type="button" className="tri-back" onClick={() => setZoom(null)} aria-label="Back to all corners">‹ All corners</button>
                  <span className={`tri-plot__where tri-plot__where--${zoom}`}>{QUADRANTS[zoom].label}</span>
                  <span className="tri-plot__hint">{QUADRANTS[zoom].hint}</span>
                </>
              ) : (
                <span className="tri-plot__hint">Click a corner to see it by category</span>
              )}
            </div>
            <Legend items={items} lanes={lanes} focus={focus} onFocus={setFocus} />
            <div key={zoom ?? 'all'} className="tri-plot__stage" onKeyDown={(e) => { if (e.key === 'Escape' && zoom) setZoom(null); }}>
              {zoom
                ? <Breakdown q={zoom} items={items} lanes={lanes} selected={selected} focus={focus} onSelect={setSelected} />
                : <Overview items={items} selected={selected} focus={focus} onSelect={setSelected} onZoom={setZoom} />}
            </div>
          </div>
          {open ? (
            <Message key={open.id} item={open} source={widget.source} onAnswer={(d, t) => answer(open, d, t)} />
          ) : (
            <div className="tri__hint">Tap a point to read it and answer.</div>
          )}
        </>
      ) : (
        <ul className="tri-list">
          {order.map((item) => {
            const q = quadrantOf(item);
            const on = item.id === selected;
            const state = item.state ?? 'open';
            return (
              <li key={item.id} className={`tri-row${on ? ' tri-row--on' : ''} tri-row--${state}`}>
                <button type="button" className="tri-row__head" aria-expanded={on} onClick={() => setSelected(on ? null : item.id)}>
                  <span className={`tri-av tri-cat--${categoryOf(item)}`} aria-hidden="true">{state === 'sent' ? <Glyph name="check" size={14} /> : initials(item.from)}</span>
                  <span className="tri-row__text">
                    <span className="tri-row__from">{item.from}</span>
                    <span className="tri-row__line">{item.subject ?? item.preview ?? ''}</span>
                  </span>
                  <span className={`tri-chip tri-chip--${q}`}>{STATE_WORDS[state] ?? QUADRANTS[q].label}</span>
                </button>
                {on && <Message item={item} source={widget.source} inRow onAnswer={(d, t) => answer(item, d, t)} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

