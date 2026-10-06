/**
 * Reactions on chat messages (shared/reactions.ts), like WhatsApp's and
 * Grok's: small emoji chips tucked on the bubble's corner, and on hover a
 * smiley that opens a quick row — "+" there opens every emoji.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { chipsFor, QUICK_REACTIONS, type Reaction } from '../../../shared/reactions';
import { emojiCategories, noteRecentEmoji, recentEmoji, searchEmoji } from './emoji';

/** The chips on a message. A tap adds or takes back your own. */
export const ReactionChips = memo(function ReactionChips({ reactions, onToggle, align }: {
  reactions: Reaction[] | undefined;
  onToggle: (emoji: string, on: boolean) => void;
  align: 'start' | 'end';
}): React.ReactElement | null {
  const chips = chipsFor(reactions);
  if (chips.length === 0) return null;
  return (
    <div className={`cx-reacts cx-reacts--${align}`}>
      {chips.map((c) => (
        <button
          key={c.emoji}
          type="button"
          className={`cx-react${c.mine ? ' cx-react--mine' : ''}`}
          title={c.agent && c.mine ? 'You and DEX' : c.agent ? 'DEX reacted' : 'You reacted — tap to take it back'}
          aria-pressed={c.mine}
          onClick={() => onToggle(c.emoji, !c.mine)}
        >
          <span className="cx-react__emoji">{c.emoji}</span>
          {c.count > 1 && <span className="cx-react__count">{c.count}</span>}
        </button>
      ))}
    </div>
  );
});

/** The hover smiley, its quick row, and the full picker behind "+". */
export function ReactTrigger({ mine, onPick, align }: {
  /** Emoji you've already put on this message (shown selected; picking one again takes it back). */
  mine: string[];
  onPick: (emoji: string, on: boolean) => void;
  align: 'start' | 'end';
}): React.ReactElement {
  const [open, setOpen] = useState<'quick' | 'all' | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const pick = (emoji: string) => {
    const on = !mine.includes(emoji);
    if (on) noteRecentEmoji(emoji);
    onPick(emoji, on);
    setOpen(null);
  };

  return (
    <div className={`cx-reactor cx-reactor--${align}${open ? ' cx-reactor--open' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="cx-reactor__btn"
        aria-label="React"
        title="React"
        aria-expanded={open !== null}
        onClick={() => setOpen((o) => (o ? null : 'quick'))}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="7.3" cy="8.4" r="5.3" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.2 9.8c.5.8 1.2 1.2 2.1 1.2s1.6-.4 2.1-1.2M5.6 6.9h.01M9 6.9h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M13 1.5v3M11.5 3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      {open === 'quick' && (
        <div className="cx-quick" role="menu" aria-label="Reactions">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} type="button" role="menuitem" className={`cx-quick__emoji${mine.includes(e) ? ' cx-quick__emoji--on' : ''}`} onClick={() => pick(e)}>{e}</button>
          ))}
          <button type="button" className="cx-quick__more" aria-label="All emoji" title="All emoji" onClick={() => setOpen('all')}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}
      {open === 'all' && <EmojiPicker mine={mine} onPick={pick} />}
    </div>
  );
}

/** Every emoji: recents, search, and Unicode's categories. */
export function EmojiPicker({ mine, onPick }: { mine: string[]; onPick: (emoji: string) => void }): React.ReactElement {
  const categories = useMemo(() => emojiCategories(), []);
  const recents = useMemo(() => recentEmoji(), []);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(recents.length ? 'recent' : categories[0].id);
  const found = useMemo(() => searchEmoji(query), [query]);
  const shown = query.trim() ? found : tab === 'recent' ? recents : categories.find((c) => c.id === tab)?.emoji ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="cx-picker" role="dialog" aria-label="Pick an emoji">
      <input
        ref={inputRef}
        className="cx-picker__search"
        type="search"
        placeholder="Search emoji"
        aria-label="Search emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!query.trim() && (
        <div className="cx-picker__tabs" role="tablist">
          {recents.length > 0 && (
            <button type="button" role="tab" aria-selected={tab === 'recent'} title="Recent" className={`cx-picker__tab${tab === 'recent' ? ' cx-picker__tab--on' : ''}`} onClick={() => setTab('recent')}>🕘</button>
          )}
          {categories.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} title={c.label} className={`cx-picker__tab${tab === c.id ? ' cx-picker__tab--on' : ''}`} onClick={() => setTab(c.id)}>{c.icon}</button>
          ))}
        </div>
      )}
      <div className="cx-picker__grid">
        {shown.length === 0 && <p className="cx-picker__empty">{query.trim() ? `No emoji for “${query}”.` : 'Nothing here yet.'}</p>}
        {shown.map((e) => (
          <button key={e} type="button" className={`cx-picker__emoji${mine.includes(e) ? ' cx-picker__emoji--on' : ''}`} onClick={() => onPick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
}
