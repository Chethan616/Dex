/**
 * transcript — folds a session's raw HlEvent stream into chat blocks.
 *
 * The logs window used to show the xterm rendering of these events. The chat
 * view keeps every detail (each tool call with its full arguments, result
 * preview, duration and outcome; files; skills; usage) but groups them the way
 * a chat app does: the user's messages, the agent's prose, and tool cards.
 *
 * `appendEvent` is incremental and structurally shared: it returns a new array
 * whose untouched blocks are the same objects as before, so memoised block
 * components skip re-rendering while text streams into the last block. Engines
 * emit prose as many small `thinking` deltas (Claude Code sends one per
 * token), which is why consecutive text is merged rather than one block each.
 */
import type { OrbState } from 'thinking-orbs';

export type ToolKind = 'search' | 'browse' | 'mcp' | 'read' | 'write' | 'run' | 'desktop' | 'agent' | 'other';

export interface ToolMeta {
  kind: ToolKind;
  /** Past-tense verb for a finished call ("Searched the web"). */
  done: string;
  /** Present-tense verb for a running call ("Searching the web"). */
  active: string;
  orb: OrbState;
  /** For MCP tools: "server · tool". */
  display?: string;
}

const KIND_META: Record<ToolKind, Omit<ToolMeta, 'kind' | 'display'>> = {
  search:  { done: 'Searched the web',  active: 'Searching the web', orb: 'searching' },
  browse:  { done: 'Used the browser',  active: 'Browsing',          orb: 'weaving' },
  mcp:     { done: 'Called',            active: 'Calling',           orb: 'connecting' },
  read:    { done: 'Read',              active: 'Reading',           orb: 'solving' },
  write:   { done: 'Edited',            active: 'Editing',           orb: 'composing' },
  run:     { done: 'Ran',               active: 'Running',           orb: 'working' },
  desktop: { done: 'Used the desktop',  active: 'Using the desktop', orb: 'shaping' },
  agent:   { done: 'Delegated',         active: 'Delegating',        orb: 'listening' },
  other:   { done: 'Used',              active: 'Using',             orb: 'working' },
};

const RULES: Array<[RegExp, ToolKind]> = [
  [/^mcp__|(^|_)mcp(_|$)/i, 'mcp'],
  [/web_?search|search_?web|google|bing|tavily|exa_|brave/i, 'search'],
  [/web_?fetch|fetch_?url|navigate|goto|open_?url|browser|page|click|scroll|type_?text|playwright|cdp|tab_/i, 'browse'],
  [/screenshot|computer|desktop|uia|mouse|keyboard|window|app_?launch/i, 'desktop'],
  [/^(task|agent|subagent|delegate)|todo/i, 'agent'],
  [/edit|write|patch|str_?replace|create_?file|apply|notebook/i, 'write'],
  [/bash|shell|exec|powershell|cmd|terminal|command|^run/i, 'run'],
  [/read|cat|view|glob|grep|find|list|ls$|search_?files|^fs|file/i, 'read'],
];

export function classifyTool(name: string): ToolMeta {
  let kind: ToolKind = 'other';
  for (const [re, k] of RULES) {
    if (re.test(name)) { kind = k; break; }
  }
  const meta: ToolMeta = { kind, ...KIND_META[kind] };
  if (kind === 'mcp') {
    const parts = name.replace(/^mcp__/, '').split('__');
    meta.display = parts.length > 1 ? `${parts[0]} · ${parts.slice(1).join(' ')}` : parts[0];
  }
  return meta;
}

export interface ToolResult {
  ok: boolean;
  preview: string;
  ms: number;
}

export type Block =
  | { kind: 'user'; id: number; text: string; attachments?: Array<{ name: string; mime: string; size: number }> }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'tool'; id: number; name: string; meta: ToolMeta; summary: string; args: unknown; iteration: number; result?: ToolResult }
  /**
   * `echo`: the summary only repeats the reply just above it (Codex reports
   * its last message as the summary). Shown as a compact "Done" footer then,
   * not the whole answer a second time.
   */
  | { kind: 'done'; id: number; summary: string; iterations: number; echo?: boolean }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'notice'; id: number; level: 'info' | 'blocking' | 'skill' | 'harness' | 'confirm'; title: string; detail?: string }
  | { kind: 'file'; id: number; name: string; path: string; size: number; mime: string }
  | { kind: 'image'; id: number; path: string; caption?: string }
  | { kind: 'canvas'; id: number; title: string; markdown: string }
  | { kind: 'artifact'; id: number; title: string; note?: string; count: number; items: Array<{ label: string; detail?: string }> };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  model?: string;
  turns: number;
}

export interface Transcript {
  blocks: Block[];
  usage: Usage;
  nextId: number;
}

export const EMPTY_TRANSCRIPT: Transcript = {
  blocks: [],
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, turns: 0 },
  nextId: 0,
};

type RawEvent = { type?: string } & Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** One-line summary of a call's arguments: the adapter's `preview` if it gave one. */
function summarizeArgs(args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    for (const key of ['preview', 'query', 'command', 'url', 'file_path', 'path', 'pattern', 'description', 'prompt']) {
      if (typeof a[key] === 'string' && a[key]) return (a[key] as string).split('\n')[0];
    }
    try { return JSON.stringify(a).slice(0, 160); } catch { return ''; }
  }
  return str(args).split('\n')[0];
}

// Whitespace and Markdown markers dropped: streamed deltas sometimes lose a
// space ("114users"), and the summary may be the plain-text version.
const norm = (s: string) => s.replace(/[\s*_`#>|~]+/g, '').toLowerCase();

/** Does `summary` just repeat the agent's last reply in this turn? */
function echoesLastReply(t: Transcript, summary: string): boolean {
  const s = norm(summary);
  if (!s) return false;
  for (let i = t.blocks.length - 1; i >= 0; i -= 1) {
    const b = t.blocks[i];
    if (b.kind === 'user') return false;
    if (b.kind !== 'text') continue;
    const last = norm(b.text);
    if (!last) return false;
    const [shorter, longer] = s.length <= last.length ? [s, last] : [last, s];
    return longer.includes(shorter) && shorter.length >= longer.length * 0.6;
  }
  return false;
}

function push(t: Transcript, block: Block): Transcript {
  return { ...t, blocks: [...t.blocks, block], nextId: t.nextId + 1 };
}

function replaceLast(t: Transcript, block: Block): Transcript {
  const blocks = t.blocks.slice();
  blocks[blocks.length - 1] = block;
  return { ...t, blocks };
}

export function appendEvent(t: Transcript, raw: RawEvent): Transcript {
  const id = t.nextId;
  switch (raw.type) {
    case 'user_input': {
      const text = str(raw.text).trim();
      return text ? push(t, { kind: 'user', id, text }) : t;
    }
    case 'thinking': {
      const text = str(raw.text);
      if (!text) return t;
      const last = t.blocks[t.blocks.length - 1];
      if (last?.kind === 'text') return replaceLast(t, { ...last, text: last.text + text });
      return text.trim() ? push(t, { kind: 'text', id, text: text.replace(/^\s+/, '') }) : t;
    }
    case 'tool_call': {
      const name = str(raw.name) || 'tool';
      return push(t, {
        kind: 'tool',
        id,
        name,
        meta: classifyTool(name),
        summary: summarizeArgs(raw.args),
        args: raw.args,
        iteration: Number(raw.iteration ?? 0),
      });
    }
    case 'tool_result': {
      const name = str(raw.name);
      const result: ToolResult = { ok: raw.ok !== false, preview: str(raw.preview), ms: Number(raw.ms ?? 0) };
      // Pair with the most recent call of that name still waiting — calls can
      // interleave with prose, so look back a little rather than at the tail.
      for (let i = t.blocks.length - 1, seen = 0; i >= 0 && seen < 80; i -= 1, seen += 1) {
        const b = t.blocks[i];
        if (b.kind === 'tool' && !b.result && (b.name === name || !name)) {
          const blocks = t.blocks.slice();
          blocks[i] = { ...b, result };
          return { ...t, blocks };
        }
      }
      return t;
    }
    case 'user_attachments': {
      const items = Array.isArray(raw.items) ? (raw.items as Array<{ name: string; mime: string; size: number }>) : [];
      if (items.length === 0) return t;
      for (let i = t.blocks.length - 1; i >= 0; i -= 1) {
        const b = t.blocks[i];
        if (b.kind === 'user') {
          const blocks = t.blocks.slice();
          blocks[i] = { ...b, attachments: [...(b.attachments ?? []), ...items] };
          return { ...t, blocks };
        }
      }
      return push(t, { kind: 'user', id, text: '', attachments: items });
    }
    case 'done': {
      const summary = str(raw.summary) || 'Task completed';
      return push(t, { kind: 'done', id, summary, iterations: Number(raw.iterations ?? 0), echo: echoesLastReply(t, summary) });
    }
    case 'error':
      return push(t, { kind: 'error', id, message: str(raw.message) || 'Something went wrong' });
    case 'notify':
      return push(t, { kind: 'notice', id, level: raw.level === 'blocking' ? 'blocking' : 'info', title: str(raw.message) });
    case 'skill_written':
      return push(t, { kind: 'notice', id, level: 'skill', title: `${raw.action === 'patch' ? 'Updated' : 'Learned'} a skill: ${str(raw.topic)}`, detail: str(raw.path) });
    case 'skill_used':
      return push(t, { kind: 'notice', id, level: 'skill', title: `Used skill: ${str(raw.topic)}`, detail: str(raw.path) });
    case 'harness_edited': {
      const changed = [
        ...((raw.added as string[] | undefined) ?? []).map((n) => `+${n}`),
        ...((raw.changed as string[] | undefined) ?? []).map((n) => `~${n}`),
        ...((raw.removed as string[] | undefined) ?? []).map((n) => `-${n}`),
      ].join(' ');
      return push(t, { kind: 'notice', id, level: 'harness', title: `Edited its ${str(raw.target)}`, detail: changed || str(raw.path) });
    }
    case 'confirmation':
      return push(t, { kind: 'notice', id, level: 'confirm', title: `${raw.status === 'approved' ? 'Approved' : raw.status === 'denied' ? 'Denied' : 'Asked for approval'}: ${str(raw.title)}`, detail: str(raw.detail) });
    case 'file_output':
      return push(t, { kind: 'file', id, name: str(raw.name), path: str(raw.path), size: Number(raw.size ?? 0), mime: str(raw.mime) });
    case 'screenshot':
      return push(t, { kind: 'image', id, path: str(raw.path), caption: raw.caption ? str(raw.caption) : undefined });
    case 'canvas':
      return push(t, { kind: 'canvas', id, title: str(raw.title), markdown: str(raw.markdown) });
    case 'artifact': {
      const items = Array.isArray(raw.items) ? (raw.items as Array<{ label?: unknown; detail?: unknown }>) : [];
      return push(t, {
        kind: 'artifact',
        id,
        title: str(raw.title),
        note: raw.note ? str(raw.note) : undefined,
        count: Number(raw.total ?? items.length),
        items: items.slice(0, 8).map((it) => ({ label: str(it.label), detail: it.detail ? str(it.detail) : undefined })),
      });
    }
    case 'turn_usage': {
      const u = t.usage;
      return {
        ...t,
        usage: {
          inputTokens: u.inputTokens + Number(raw.inputTokens ?? 0),
          outputTokens: u.outputTokens + Number(raw.outputTokens ?? 0),
          cachedInputTokens: u.cachedInputTokens + Number(raw.cachedInputTokens ?? 0),
          costUsd: u.costUsd + Number(raw.costUsd ?? 0),
          model: raw.model ? str(raw.model) : u.model,
          turns: u.turns + 1,
        },
      };
    }
    default:
      // task_state lives in the hub's preview deck; anything unknown is still
      // in the Raw view.
      return t;
  }
}

export function buildTranscript(prompt: string | undefined, events: RawEvent[]): Transcript {
  let t = EMPTY_TRANSCRIPT;
  if (prompt?.trim()) t = push(t, { kind: 'user', id: 0, text: prompt.trim() });
  const first = prompt?.trim();
  for (const ev of events) {
    // Some engines echo the opening prompt as a user_input; it's already shown.
    if (first && t.blocks.length === 1 && ev.type === 'user_input' && str(ev.text).trim() === first) continue;
    t = appendEvent(t, ev);
  }
  return t;
}
