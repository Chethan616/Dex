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
  PLOT_ABOVE, QUADRANTS, isSettled, quadrantOf, triageCommand, triageOrder,
  type TriageItem, type TriageState, type TriageWidget,
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
const H = 320;
/** Room above and below for the corner names, so no point ever sits on one. */
const PAD = { l: 8, r: 8, t: 30, b: 30 };
const R = 14;

interface Placed { item: TriageItem; x: number; y: number }

/** Each message where its scores put it, nudged off any point it would cover. */
function place(items: TriageItem[]): Placed[] {
  const placed: Placed[] = [];
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  for (const item of triageOrder(items)) {
    let x = PAD.l + R + ((iw - 2 * R) * item.urgency) / 10;
    let y = PAD.t + R + ((ih - 2 * R) * (10 - item.importance)) / 10;
    const bx = x;
    const by = y;
    // A spiral out from where it belongs, a step at a time, until it's clear.
    for (let k = 1, a = 0; k < 40 && placed.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * R + 3); k += 1) {
      a += 2.4;
      x = Math.min(W - PAD.r - R, Math.max(PAD.l + R, bx + Math.cos(a) * (4 + k * 3)));
      y = Math.min(H - PAD.b - R, Math.max(PAD.t + R, by + Math.sin(a) * (4 + k * 3)));
    }
    placed.push({ item, x, y });
  }
  return placed;
}

function Plot({ items, selected, onSelect }: { items: TriageItem[]; selected: string | null; onSelect: (id: string) => void }): React.ReactElement {
  const placed = useMemo(() => place(items), [items]);
  const [hover, setHover] = useState<string | null>(null);
  const tip = placed.find((p) => p.item.id === hover);
  const cx = W / 2;
  const cy = H / 2;
  return (
    <div className="tri-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Messages by urgency and importance">
        {/* The four corners, faintly tinted, each named. */}
        <rect className="tri-q tri-q--plan" x={PAD.l} y={PAD.t} width={cx - PAD.l} height={cy - PAD.t} rx="14" />
        <rect className="tri-q tri-q--now" x={cx} y={PAD.t} width={W - PAD.r - cx} height={cy - PAD.t} rx="14" />
        <rect className="tri-q tri-q--later" x={PAD.l} y={cy} width={cx - PAD.l} height={H - PAD.b - cy} rx="14" />
        <rect className="tri-q tri-q--quick" x={cx} y={cy} width={W - PAD.r - cx} height={H - PAD.b - cy} rx="14" />
        <text className="tri-ql" x={PAD.l + 4} y={PAD.t - 11}>{QUADRANTS.plan.label}</text>
        <text className="tri-ql tri-ql--now" x={W - PAD.r - 4} y={PAD.t - 11} textAnchor="end">{QUADRANTS.now.label}</text>
        <text className="tri-ql" x={PAD.l + 4} y={H - PAD.b + 20}>{QUADRANTS.later.label}</text>
        <text className="tri-ql" x={W - PAD.r - 4} y={H - PAD.b + 20} textAnchor="end">{QUADRANTS.quick.label}</text>
        {/* The axes through the middle, arrows out: urgency across, importance up. */}
        <g className="tri-axis">
          <path d={`M${PAD.l + 4} ${cy}H${W - PAD.r - 2}M${W - PAD.r - 10} ${cy - 6}l8 6-8 6`} />
          <path d={`M${cx} ${H - PAD.b - 2}V${PAD.t + 2}M${cx - 6} ${PAD.t + 10}l6-8 6 8`} />
        </g>
        <text className="tri-al" x={W - PAD.r - 8} y={cy + 22} textAnchor="end">Urgency</text>
        <text className="tri-al" x={cx} y={PAD.t - 11} textAnchor="middle">Importance</text>
        {placed.map(({ item, x, y }) => {
          const q = quadrantOf(item);
          const state = item.state ?? 'open';
          const on = item.id === selected;
          return (
            <g
              key={item.id}
              className={`tri-pt tri-pt--${q} tri-pt--${state}${on ? ' tri-pt--on' : ''}`}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${item.from}${item.subject ? `: ${item.subject}` : ''} — ${QUADRANTS[q].label}${state === 'sent' ? ', sent' : state === 'skipped' ? ', skipped' : ''}`}
              aria-pressed={on}
              onClick={() => onSelect(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
              onMouseEnter={() => setHover(item.id)}
              onMouseLeave={() => setHover((h) => (h === item.id ? null : h))}
              onFocus={() => setHover(item.id)}
              onBlur={() => setHover((h) => (h === item.id ? null : h))}
            >
              {on && <circle className="tri-pt__ring" r={R + 5} />}
              <circle className="tri-pt__dot" r={R} />
              {state === 'sent' ? (
                <path className="tri-pt__mark" d="M-5 0.5l3.4 3.4L5.5-4" />
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
            <span className={`tri-av tri-av--${q}`} aria-hidden="true">{initials(item.from)}</span>
            <div className="tri-msg__who">
              <span className="tri-msg__from">{item.from}</span>
              {(item.address || via) && <span className="tri-msg__addr">{[item.address, via].filter(Boolean).join(' · ')}</span>}
            </div>
            {item.at && <span className="tri-msg__at">{item.at}</span>}
          </div>
          <div className="tri-msg__tags">
            <span className={`tri-chip tri-chip--${q}`}>{QUADRANTS[q].label}</span>
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
                  <span className={`tri-av tri-av--${q}`} aria-hidden="true">{state === 'sent' ? <Glyph name="check" size={14} /> : initials(item.from)}</span>
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

