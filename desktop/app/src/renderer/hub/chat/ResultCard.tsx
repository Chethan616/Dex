/**
 * ResultCard — a typed card for a recognised MCP result (mcpResults.ts):
 * calendar events, tasks and mail lists from DEX's Google/Microsoft
 * connections, shown the way Gemini's does (UI/claude_see_this_if_u_have_
 * time_do_this_simple_basic_ui_thing_3…png) — a provider header strip, then
 * each item's title, a time range or subtitle, and a button that opens it.
 */
import React from 'react';
import type { CalendarCardItem, MailCardItem, ResultCardData, TaskCardItem } from './mcpResults';

function CalendarIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MailIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M2 4l6 5 6-5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TasksIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5 8.2l1.8 1.8L11 6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OpenIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M6.5 4.5h-2a1.5 1.5 0 00-1.5 1.5v5a1.5 1.5 0 001.5 1.5h5A1.5 1.5 0 0011 11v-2M9.5 3h3.5v3.5M12.7 3.3L7.5 8.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const HEADER: Record<ResultCardData['kind'], { label: (provider: string) => string; icon: React.ReactElement }> = {
  calendar: { label: (p) => (p === 'microsoft' ? 'Outlook Calendar' : 'Calendar'), icon: <CalendarIcon /> },
  mail: { label: (p) => (p === 'microsoft' ? 'Outlook Mail' : 'Gmail'), icon: <MailIcon /> },
  tasks: { label: (p) => (p === 'microsoft' ? 'Microsoft To Do' : 'Google Tasks'), icon: <TasksIcon /> },
};

/** "Tue, Sep 28, 2027" for an all-day date; "Tue, Sep 28, 2027 · 9:00 – 10:00am" for a timed one. */
function formatEventTime(start: string | undefined, end: string | undefined): string | undefined {
  if (!start) return undefined;
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return undefined;
  const day = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (isAllDay) return day;
  const startTime = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const e = end ? new Date(end) : undefined;
  const endTime = e && !Number.isNaN(e.getTime()) ? e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : undefined;
  return endTime ? `${day} · ${startTime} – ${endTime}` : `${day} · ${startTime}`;
}

function CalendarRow({ item, onOpenUrl }: { item: CalendarCardItem; onOpenUrl?: (url: string) => void }): React.ReactElement {
  const when = formatEventTime(item.start, item.end);
  const subtitle = [when, item.location].filter(Boolean).join(' · ') || undefined;
  return (
    <div className="cx-card__row">
      <div className="cx-card__row-text">
        <span className="cx-card__row-title">{item.title}</span>
        {subtitle && <span className="cx-card__row-sub">{subtitle}</span>}
      </div>
      {item.link && onOpenUrl && (
        <button type="button" className="cx-card__action" title="Open" onClick={() => onOpenUrl(item.link!)}><OpenIcon /></button>
      )}
    </div>
  );
}

function MailRow({ item }: { item: MailCardItem }): React.ReactElement {
  return (
    <div className="cx-card__row">
      <div className="cx-card__row-text">
        <span className="cx-card__row-title">{item.unread && <span className="cx-card__unread-dot" aria-hidden="true" />}{item.subject}</span>
        <span className="cx-card__row-sub">{[item.from, item.date].filter(Boolean).join(' · ')}</span>
        {item.snippet && <span className="cx-card__row-snippet">{item.snippet}</span>}
      </div>
    </div>
  );
}

function TaskRow({ item }: { item: TaskCardItem }): React.ReactElement {
  const done = item.status === 'completed';
  return (
    <div className="cx-card__row">
      <div className="cx-card__row-text">
        <span className={`cx-card__row-title${done ? ' cx-card__row-title--done' : ''}`}>{item.title}</span>
        {item.due && <span className="cx-card__row-sub">Due {new Date(item.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
      </div>
    </div>
  );
}

export function ResultCard({ card, onOpenUrl }: { card: ResultCardData; onOpenUrl?: (url: string) => void }): React.ReactElement | null {
  if (card.items.length === 0) return null;
  const head = HEADER[card.kind];
  return (
    <div className="cx-card">
      <div className="cx-card__head">
        <span className="cx-card__icon">{head.icon}</span>
        <span className="cx-card__label">{head.label(card.provider)}</span>
      </div>
      <div className="cx-card__body">
        {card.kind === 'calendar' && card.items.map((it, i) => <CalendarRow key={it.id ?? i} item={it} onOpenUrl={onOpenUrl} />)}
        {card.kind === 'mail' && card.items.map((it, i) => <MailRow key={it.id ?? i} item={it} />)}
        {card.kind === 'tasks' && card.items.map((it, i) => <TaskRow key={it.id ?? i} item={it} />)}
      </div>
    </div>
  );
}
