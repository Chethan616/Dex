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
  CATEGORY_LABELS, PLOT_ABOVE, QUADRANTS, categoryOf, isSettled, lanesOf, quadrantOf, triageCommand, triageOrder,
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

const W = 600;
const H = 380;
/** Room above for "Importance ↑" and below for "Urgency →". */
const PAD_T = 18;
const PAD_B = 18;
/** The gap between the corners, where the axes run. */
const GAP = 12;
/** A corner's own header: its name and how many. */
const HEAD = 24;
const INSET = 7;
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

/** A corner's lanes, one per category on the card: each a small plot of its own. */
function laneBox(q: Quadrant, lane: number, lanes: number): Box {
  const c = cornerBox(q);
  const w = (c.w - INSET * 2) / lanes;
  return { x: c.x + INSET + lane * w, y: c.y + HEAD, w, h: c.h - HEAD - INSET };
}

/**
 * Each message in its corner's lane for its category, where its scores put
 * it within that corner (urgency across, importance up — the same axes,
 * smaller), nudged off any point it would cover without leaving the lane.
 */
function place(items: TriageItem[], lanes: TriageCategory[]): Placed[] {
  const placed: Placed[] = [];
  for (const item of triageOrder(items)) {
    const q = quadrantOf(item);
    const lane = Math.max(0, lanes.indexOf(categoryOf(item)));
    const b = laneBox(q, lane, Math.max(1, lanes.length));
    const uLo = item.urgency >= 5 ? 5 : 0;
    const iLo = item.importance >= 5 ? 5 : 0;
    const fu = Math.min(1, Math.max(0, (item.urgency - uLo) / 5));
    const fi = Math.min(1, Math.max(0, (item.importance - iLo) / 5));
    const minX = b.x + R;
    const maxX = Math.max(minX, b.x + b.w - R);
    const minY = b.y + R;
    const maxY = Math.max(minY, b.y + b.h - R);
    const bx = minX + (maxX - minX) * fu;
    const by = minY + (maxY - minY) * (1 - fi);
    let x = bx;
    let y = by;
    for (let k = 1, a = 0; k < 48 && placed.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * R + 2); k += 1) {
      a += 2.4;
      x = Math.min(maxX, Math.max(minX, bx + Math.cos(a) * (3 + k * 2.5)));
      y = Math.min(maxY, Math.max(minY, by + Math.sin(a) * (3 + k * 2.5)));
    }
    placed.push({ item, x, y });
  }
  return placed;
}

function Plot({ items, selected, onSelect }: { items: TriageItem[]; selected: string | null; onSelect: (id: string) => void }): React.ReactElement {
  const lanes = useMemo(() => lanesOf(items), [items]);
  const placed = useMemo(() => place(items, lanes), [items, lanes]);
  const [hover, setHover] = useState<string | null>(null);
  const tip = placed.find((p) => p.item.id === hover);
  const cx = W / 2;
  const cy = PAD_T + (H - PAD_T - PAD_B) / 2;
  const n = Math.max(1, lanes.length);
  return (
    <div className="tri-plot">
      {lanes.length > 1 && (
        <div className="tri-legend" aria-label="Lanes in each corner">
          {lanes.map((c) => (
            <span key={c} className={`tri-legend__item tri-cat--${c}`}>
              <i aria-hidden="true" />{CATEGORY_LABELS[c]}<b>{items.filter((it) => categoryOf(it) === c).length}</b>
            </span>
          ))}
        </div>
      )}
      <div className="tri-plot__area">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Messages by urgency and importance, each corner split by what they're about">
        {Q_ORDER.map((q) => {
          const c = cornerBox(q);
          const count = items.filter((it) => quadrantOf(it) === q).length;
          return (
            <g key={q} className={`tri-corner tri-corner--${q}`}>
              <rect className="tri-corner__bg" x={c.x} y={c.y} width={c.w} height={c.h} rx="12" />
              <text className="tri-corner__name" x={c.x + 10} y={c.y + 16}>{QUADRANTS[q].label}</text>
              <text className="tri-corner__count" x={c.x + c.w - 10} y={c.y + 16} textAnchor="end">{count || ''}</text>
              {/* Each lane keyed by its category's colour, and divided from the next. */}
              {lanes.length > 1 && lanes.map((cat, i) => {
                const b = laneBox(q, i, n);
                return (
                  <g key={cat}>
                    <rect className={`tri-lane__key tri-cat--${cat}`} x={b.x + 3} y={b.y - 3} width={Math.max(0, b.w - 6)} height="2.5" rx="1.25"><title>{CATEGORY_LABELS[cat]}</title></rect>
                    {i > 0 && <line className="tri-lane__div" x1={b.x} y1={b.y + 2} x2={b.x} y2={b.y + b.h} />}
                  </g>
                );
              })}
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
        {placed.map(({ item, x, y }) => {
          const q = quadrantOf(item);
          const state = item.state ?? 'open';
          const on = item.id === selected;
          return (
            <g
              key={item.id}
              className={`tri-pt tri-cat--${categoryOf(item)} tri-pt--${state}${on ? ' tri-pt--on' : ''}`}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${item.from}${item.subject ? `: ${item.subject}` : ''} — ${QUADRANTS[q].label}, ${CATEGORY_LABELS[categoryOf(item)]}${state === 'sent' ? ', sent' : state === 'skipped' ? ', skipped' : ''}`}
              aria-pressed={on}
              onClick={() => onSelect(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
              onMouseEnter={() => setHover(item.id)}
              onMouseLeave={() => setHover((h) => (h === item.id ? null : h))}
              onFocus={() => setHover(item.id)}
              onBlur={() => setHover((h) => (h === item.id ? null : h))}
            >
              {on && <circle className="tri-pt__ring" r={R + 4} />}
              <circle className="tri-pt__dot" r={R} />
              {state === 'sent' ? (
                <path className="tri-pt__mark" d="M-4.5 0.5l3 3L4.8-3.6" />
              ) : (
                <text className="tri-pt__ini" textAnchor="middle" dy="0.35em">{initials(item.from)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          className="tri-tip"
          style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
          aria-hidden="true"
        >
          <b>{tip.item.from}</b>
          <span>{tip.item.subject ?? tip.item.preview ?? ''}</span>
        </div>
      )}
      </div>
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
            {item.why && <span className="tri-msg__why">{item.why}</span>}
          </div>
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
          <Plot items={items} selected={selected} onSelect={setSelected} />
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

