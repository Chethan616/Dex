/**
 * mcpResults — recognises a finished MCP tool call's result as one of a
 * handful of shapes DEX's own Google/Microsoft MCP servers return (calendar
 * events, tasks, a mail list — see mcp-servers/google/server.mjs and
 * microsoft/server.mjs for the exact shapes this mirrors), so the chat can
 * render a typed card (UI/claude_see_this_if_u_have_time_do_this_simple_
 * basic_ui_thing_3…png) instead of the generic tool row.
 *
 * Claude Code's MCP tool names are `mcp__<server-id>__<tool>` (see
 * mcpBriefing in main/hl/engines/runEngine.ts, which is the same convention
 * Claude Code itself uses) — 'google' and 'microsoft' are the two server ids
 * DEX registers (main/mcp/catalog.ts). A tool's return value comes back as
 * `JSON.stringify(result, null, 2)` inside the tool_result's text content
 * (both servers' `reply()`), so the preview a tool_result block carries is
 * that JSON, parsed here. The top-level preview is capped at 2000 characters
 * upstream (claude-code/adapter.ts) — a long list can truncate mid-JSON, in
 * which case JSON.parse throws and this returns null, same as any other
 * unrecognised shape: the generic tool row is the fallback either way.
 *
 * Codex: its `mcp_tool_call` item type doesn't carry the server/tool it
 * called (only command/path/text/url — codex/adapter.ts's
 * normalizeItemArgs), so Codex tool names never match `mcp__google__…` /
 * `mcp__microsoft__…` and this always falls back to the generic row there.
 */

export type ResultCardKind = 'calendar' | 'mail' | 'tasks';
export type ResultCardProvider = 'google' | 'microsoft';

export interface CalendarCardItem {
  id?: string;
  title: string;
  start?: string;
  end?: string;
  location?: string;
  /** A link to open: the event's own page, or a meeting join link. */
  link?: string;
}

export interface MailCardItem {
  id?: string;
  subject: string;
  from?: string;
  date?: string;
  unread?: boolean;
  snippet?: string;
  /** The message in the mail app. */
  link?: string;
}

export interface TaskCardItem {
  id?: string;
  title: string;
  due?: string;
  status?: string;
  /** Where the task lives. */
  link?: string;
}

/** `wrote`: the tool created or changed these (an event added), rather than listing them. */
export type ResultCardData =
  | { kind: 'calendar'; provider: ResultCardProvider; items: CalendarCardItem[]; wrote?: boolean }
  | { kind: 'mail'; provider: ResultCardProvider; items: MailCardItem[]; wrote?: boolean }
  | { kind: 'tasks'; provider: ResultCardProvider; items: TaskCardItem[]; wrote?: boolean };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function googleEvent(e: unknown): CalendarCardItem | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const title = str(o.summary);
  if (!title) return null;
  return { id: str(o.id), title, start: str(o.start), end: str(o.end), location: str(o.location), link: str(o.link) ?? str(o.meetLink) };
}

function googleMail(m: unknown): MailCardItem | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!('id' in o) && !('subject' in o)) return null;
  const id = str(o.id);
  return {
    id, subject: str(o.subject) ?? '(no subject)', from: str(o.from), date: str(o.date), unread: o.unread === true, snippet: str(o.snippet),
    link: str(o.link) ?? (id ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}` : undefined),
  };
}

function googleTask(t: unknown): TaskCardItem | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const title = str(o.title);
  if (!title) return null;
  return { id: str(o.id), title, due: str(o.due), status: str(o.status), link: str(o.webViewLink) ?? 'https://tasks.google.com/' };
}

function msEvent(e: unknown): CalendarCardItem | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const title = str(o.subject);
  if (!title) return null;
  return { id: str(o.id), title, start: str(o.start), end: str(o.end), location: str(o.location), link: str(o.joinUrl) };
}

function msMail(m: unknown): MailCardItem | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!('id' in o) && !('subject' in o)) return null;
  return {
    id: str(o.id), subject: str(o.subject) ?? '(no subject)', from: str(o.fromName) ?? str(o.from), date: str(o.received), unread: o.isRead === false, snippet: str(o.preview),
    link: str(o.webLink) ?? 'https://outlook.office.com/mail/',
  };
}

function msTask(t: unknown): TaskCardItem | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const title = str(o.title);
  if (!title) return null;
  return { id: str(o.id), title, due: str(o.dueDate), status: str(o.status), link: 'https://to-do.office.com/tasks/' };
}

function mapList<T>(data: unknown, map: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(data)) return null;
  const items = data.map(map).filter((v): v is T => v !== null);
  return items.length > 0 ? items : null;
}

const TOOL_RE = /^mcp__(google|microsoft)__([a-z_]+)$/;

export function detectResultCard(toolName: string, preview: string): ResultCardData | null {
  const m = TOOL_RE.exec(toolName);
  if (!m) return null;
  const provider = m[1] as ResultCardProvider;
  const tool = m[2];
  let data: unknown;
  try {
    data = JSON.parse(preview);
  } catch {
    return null;
  }

  if (provider === 'google') {
    if (tool === 'calendar_list_events') {
      const events = data && typeof data === 'object' ? (data as Record<string, unknown>).events : undefined;
      const items = mapList(events, googleEvent);
      return items ? { kind: 'calendar', provider, items } : null;
    }
    if (tool === 'calendar_create_event' || tool === 'calendar_update_event' || tool === 'meet_create') {
      const item = googleEvent(data);
      return item ? { kind: 'calendar', provider, items: [item], wrote: true } : null;
    }
    if (tool === 'gmail_search') {
      const items = mapList(data, googleMail);
      return items ? { kind: 'mail', provider, items } : null;
    }
    if (tool === 'tasks_list') {
      const items = mapList(data, googleTask);
      return items ? { kind: 'tasks', provider, items } : null;
    }
    if (tool === 'tasks_create') {
      const item = googleTask(data);
      return item ? { kind: 'tasks', provider, items: [item], wrote: true } : null;
    }
    return null;
  }

  // microsoft
  if (tool === 'calendar_list') {
    const items = mapList(data, msEvent);
    return items ? { kind: 'calendar', provider, items } : null;
  }
  if (tool === 'calendar_create' || tool === 'calendar_update') {
    const item = msEvent(data);
    return item ? { kind: 'calendar', provider, items: [item], wrote: true } : null;
  }
  if (tool === 'mail_list') {
    const items = mapList(data, msMail);
    return items ? { kind: 'mail', provider, items } : null;
  }
  if (tool === 'todo_tasks') {
    const items = mapList(data, msTask);
    return items ? { kind: 'tasks', provider, items } : null;
  }
  return null;
}

function itemKey(it: CalendarCardItem | MailCardItem | TaskCardItem): string {
  if (it.id) return it.id;
  if ('subject' in it) return JSON.stringify([it.subject, it.from, it.date]);
  if ('start' in it || 'end' in it || 'location' in it) return JSON.stringify([(it as CalendarCardItem).title, (it as CalendarCardItem).start]);
  return JSON.stringify([it.title, (it as TaskCardItem).due]);
}

/**
 * A turn's cards, one per kind. A task that added an event and then listed
 * the day to check showed the event twice, and a retry after a failed call
 * added a third. Each item is kept once (by id, else its title and time).
 * When the turn created or changed something, that is the card — the list
 * was only the agent checking its work.
 */
export function mergeResultCards(cards: ResultCardData[]): ResultCardData[] {
  const out: ResultCardData[] = [];
  const kinds = [...new Set(cards.map((c) => c.kind))];
  for (const kind of kinds) {
    const same = cards.filter((c) => c.kind === kind);
    const wrote = same.filter((c) => c.wrote);
    const use = wrote.length > 0 ? wrote : same;
    const seen = new Set<string>();
    const items: Array<CalendarCardItem | MailCardItem | TaskCardItem> = [];
    for (const c of use) {
      for (const it of c.items) {
        const k = itemKey(it);
        if (seen.has(k)) continue;
        seen.add(k);
        items.push(it);
      }
    }
    out.push({ kind, provider: use[use.length - 1].provider, items, ...(wrote.length > 0 ? { wrote: true } : {}) } as ResultCardData);
  }
  return out;
}
