/**
 * Turns — the chat's shape (docs/unify/PLAN.md §3.12).
 *
 * The transcript is a flat list of blocks. The chat shows it the way Codex
 * does: your message, then DEX's work folded under "Worked for 3m 45s", then
 * its reply, then the files it made. This splits the blocks into those turns
 * and pulls out what the minibar lists (outputs, sources).
 */
import type { Block } from '../../logs/transcript';
import { detectResultCard, type ResultCardData } from './mcpResults';

type Of<K extends Block['kind']> = Extract<Block, { kind: K }>;

export interface FileItem {
  name: string;
  path: string;
  size?: number;
  mime?: string;
}

export interface Turn {
  /** Stable React key: the id of the turn's first block. */
  key: number;
  user: Of<'user'> | null;
  /** Tool calls, interim notes, screenshots, quiet notices: under "Worked for". */
  work: Block[];
  /** The answer, in full: prose after the last tool call, plus a summary that adds to it. */
  reply: string;
  /** The block the reply is streaming into, while it is. */
  replyStreaming: boolean;
  /** When the reply's first words arrived: what a reaction on it is keyed by (shared/reactions.ts). */
  replyAt?: number;
  files: FileItem[];
  docs: Array<Of<'canvas'>>;
  finds: Array<Of<'artifact'>>;
  /** From the agent's UI kit (shared/widgets.ts): questions, cards, link buttons, facts. */
  widgets: Array<Of<'widget'>>;
  /** Shown in the open, never folded: errors and things that need you. */
  alerts: Array<Of<'error'> | Of<'notice'>>;
  startAt?: number;
  endAt?: number;
  /** DEX is still working on this turn. */
  live: boolean;
  /** A recognised MCP result (calendar/mail/tasks — mcpResults.ts), shown as a card instead of just a generic tool row. */
  resultCards: ResultCardData[];
  /** Follow-up suggestions derived from which MCP tool this turn used (no extra LLM call — see followUpChips below). */
  chips: FollowUpChip[];
}

export interface FollowUpChip {
  label: string;
  prompt: string;
}

function fileOf(b: Of<'file'>): FileItem {
  return { name: b.name || b.path.split(/[\\/]/).pop() || b.path, path: b.path, size: b.size || undefined, mime: b.mime || undefined };
}

function latest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function buildTurn(user: Of<'user'> | null, agent: Block[], live: boolean, fallbackStart?: number): Turn {
  // Everything after the last tool call (or screenshot) is the reply; before
  // it, prose is DEX narrating its work.
  let lastWork = -1;
  agent.forEach((b, i) => { if (b.kind === 'tool' || b.kind === 'image') lastWork = i; });

  const turn: Turn = {
    key: user?.id ?? agent[0]?.id ?? 0,
    user,
    work: [],
    reply: '',
    replyStreaming: false,
    files: [],
    docs: [],
    finds: [],
    widgets: [],
    alerts: [],
    startAt: user?.at ?? fallbackStart ?? agent[0]?.at,
    endAt: undefined,
    live,
    resultCards: [],
    chips: [],
  };
  const replyParts: string[] = [];
  let lastText: Of<'text'> | null = null;
  const seen = new Set<string>();

  for (let i = 0; i < agent.length; i += 1) {
    const b = agent[i];
    turn.endAt = latest(turn.endAt, b.endAt ?? b.at);
    switch (b.kind) {
      case 'text':
        if (i > lastWork) { replyParts.push(b.text.trim()); lastText = b; turn.replyAt ??= b.at; }
        else turn.work.push(b);
        break;
      case 'done':
        if (!b.echo && b.summary.trim()) { replyParts.push(b.summary.trim()); turn.replyAt ??= b.at; }
        break;
      case 'file': {
        const key = b.path.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          turn.files.push(fileOf(b));
        }
        break;
      }
      case 'canvas':
        turn.docs.push(b);
        break;
      case 'artifact':
        turn.finds.push(b);
        break;
      case 'widget':
        turn.widgets.push(b);
        break;
      case 'error':
        turn.alerts.push(b);
        break;
      case 'notice':
        if (b.level === 'blocking') turn.alerts.push(b);
        else turn.work.push(b);
        break;
      case 'user':
        break;
      default:
        turn.work.push(b);
    }
  }

  turn.reply = replyParts.filter(Boolean).join('\n\n');
  turn.replyStreaming = live && lastText !== null && agent[agent.length - 1] === lastText;

  // Recognised MCP results (mcpResults.ts) become cards instead of plain tool
  // rows — only once the tool is actually done, and only for a turn that has
  // settled into its reply, so a card never flashes up mid-stream.
  if (!live) {
    for (const b of turn.work) {
      if (b.kind !== 'tool' || !b.result || !b.result.ok) continue;
      const card = detectResultCard(b.name, b.result.preview);
      if (card) turn.resultCards.push(card);
    }
    if (turn.reply) turn.chips = chipsForTools(turn.work.filter((b): b is Of<'tool'> => b.kind === 'tool').map((b) => b.name));
  }
  return turn;
}

/**
 * Follow-up suggestions, derived from which MCP tool this turn actually
 * called — not from the reply's content and no extra LLM call, so a chip
 * never promises something DEX didn't just demonstrate it can do. Mirrors
 * the MCP tool-name convention mcpResults.ts matches against.
 */
const CHIP_RULES: Array<{ match: RegExp; chips: FollowUpChip[] }> = [
  {
    match: /^mcp__(google|microsoft)__(calendar|meet)/,
    chips: [
      { label: 'Show my week', prompt: 'Show my calendar for this week' },
      { label: 'Any conflicts?', prompt: 'Are there any conflicts on my calendar this week?' },
    ],
  },
  {
    match: /^mcp__google__gmail_|^mcp__microsoft__mail_/,
    chips: [
      { label: 'Show unread emails', prompt: 'Show me my unread emails' },
      { label: 'Anything urgent?', prompt: 'Is there anything urgent in my inbox?' },
    ],
  },
  {
    match: /^mcp__google__tasks_|^mcp__microsoft__todo_/,
    chips: [{ label: 'Show all tasks', prompt: 'Show me all my open tasks' }],
  },
  {
    match: /^mcp__remote_kiwi__/,
    chips: [
      { label: 'Cheaper days?', prompt: 'Which nearby days are cheaper for this trip?' },
      { label: 'Find a hotel there', prompt: 'Find me a hotel there for those dates' },
    ],
  },
  {
    match: /^mcp__remote_trivago__/,
    chips: [
      { label: 'Cheaper options', prompt: 'Show me cheaper options' },
      { label: 'Closest to the centre', prompt: 'Which of these is closest to the centre?' },
    ],
  },
];

function chipsForTools(toolNames: string[]): FollowUpChip[] {
  const chips: FollowUpChip[] = [];
  const seen = new Set<string>();
  for (const name of toolNames) {
    for (const rule of CHIP_RULES) {
      if (!rule.match.test(name)) continue;
      for (const chip of rule.chips) {
        if (seen.has(chip.label)) continue;
        seen.add(chip.label);
        chips.push(chip);
      }
    }
  }
  return chips.slice(0, 3);
}

/** Split blocks into turns. `running`: DEX is working on the last one. */
export function toTurns(blocks: Block[], running: boolean, sessionStart?: number): Turn[] {
  const turns: Turn[] = [];
  let user: Of<'user'> | null = null;
  let agent: Block[] = [];
  let started = false;
  const flush = (live: boolean) => {
    if (!started) return;
    turns.push(buildTurn(user, agent, live, turns.length === 0 ? sessionStart : turns[turns.length - 1].endAt));
  };
  for (const b of blocks) {
    if (b.kind === 'user') {
      flush(false);
      user = b;
      agent = [];
      started = true;
    } else {
      agent.push(b);
      started = true;
    }
  }
  flush(running);
  return turns;
}

/** "3m 45s", "12s", "1h 5m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Every file the task made, newest last, once each. */
export function allOutputs(turns: Turn[]): FileItem[] {
  const byPath = new Map<string, FileItem>();
  for (const t of turns) for (const f of t.files) {
    byPath.delete(f.path.toLowerCase());
    byPath.set(f.path.toLowerCase(), f);
  }
  return [...byPath.values()];
}

export type Source =
  | { kind: 'site'; url: string; host: string }
  | { kind: 'search'; query: string }
  | { kind: 'tool'; name: string };

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

function urlIn(args: unknown, summary: string): string | null {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  for (const k of ['url', 'href', 'uri']) {
    if (typeof a[k] === 'string' && hostOf(a[k] as string)) return a[k] as string;
  }
  const m = /https?:\/\/[^\s"'`)<>]+/.exec(summary);
  return m && hostOf(m[0]) ? m[0] : null;
}

/**
 * What DEX drew on: sites it opened (and the tabs you share), searches it ran,
 * and connected tools (MCP servers). Once each, in the order first used.
 */
export function collectSources(blocks: Block[], extraUrls: string[] = []): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const add = (key: string, s: Source) => { if (!seen.has(key)) { seen.add(key); out.push(s); } };
  for (const b of blocks) {
    if (b.kind !== 'tool') continue;
    if (b.meta.kind === 'search') {
      const a = b.args && typeof b.args === 'object' ? (b.args as Record<string, unknown>) : {};
      const query = typeof a.query === 'string' ? a.query : b.summary;
      if (query) add(`q:${query.toLowerCase()}`, { kind: 'search', query });
      continue;
    }
    if (b.meta.kind === 'mcp') {
      const server = (b.meta.display ?? b.name).split(' · ')[0];
      add(`t:${server}`, { kind: 'tool', name: server });
      continue;
    }
    const url = urlIn(b.args, b.summary);
    const host = url ? hostOf(url) : null;
    if (url && host) add(`s:${host}`, { kind: 'site', url, host });
  }
  for (const url of extraUrls) {
    const host = hostOf(url);
    if (host) add(`s:${host}`, { kind: 'site', url, host });
  }
  return out;
}
