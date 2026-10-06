/**
 * subagents (renderer) — turns a session's subagent_start/subagent_step/
 * subagent_done events into display-ready records: the live "current
 * activity" line shown on the Subagents tab ("inspecting pointerInput.kt"),
 * and grouped mention lines for the chat ("Pdf selection review, Xlsx ui
 * review and Glass contrast review started working" — UI/claude_see_this_i_
 * missed_inprompt...png).
 *
 * The fold itself (src/shared/subagents.ts) is shared with the main-process
 * Firebase bridge, which mirrors the same records to Firestore for the
 * phone; this file is the renderer-only display layer on top of it.
 */
import { useMemo, useRef } from 'react';
import {
  buildSubagents,
  foldSubagentEvent,
  subagentsList,
  EMPTY_SUBAGENTS,
  type Subagent,
  type SubagentsState,
} from '../../shared/subagents';
import type { HlEvent as SharedHlEvent } from '../../shared/session-schemas';
import type { AgentSession } from './types';

export type { Subagent, SubagentStep, SubagentStatus } from '../../shared/subagents';

/**
 * Incrementally folded, the same way useTranscript (hub/chat/ChatView.tsx)
 * folds the chat transcript: a running session's output only ever grows, so
 * refolding the whole array on every render would be wasted work once a
 * session has a few hundred events.
 */
export function useSubagents(session: AgentSession): Subagent[] {
  const cache = useRef<{ id: string; count: number; last: unknown; state: SubagentsState } | null>(null);
  return useMemo(() => {
    const events = session.output as unknown as SharedHlEvent[];
    const c = cache.current;
    let state: SubagentsState;
    let from: number;
    if (c && c.id === session.id && events.length >= c.count && (c.count === 0 || events[c.count - 1] === c.last)) {
      state = c.state;
      from = c.count;
    } else {
      state = EMPTY_SUBAGENTS;
      from = 0;
    }
    for (let i = from; i < events.length; i += 1) state = foldSubagentEvent(state, events[i]);
    cache.current = { id: session.id, count: events.length, last: events[events.length - 1], state };
    return subagentsList(state);
  }, [session.id, session.output]);
}

/** Non-incremental version, for places (the Firebase bridge mirror, tests) that just have a plain array. */
export function collectSubagents(events: readonly SharedHlEvent[]): Subagent[] {
  return subagentsList(buildSubagents(events));
}

const VERB: Record<string, string> = {
  read: 'inspecting',
  grep: 'inspecting',
  glob: 'inspecting',
  ls: 'inspecting',
  webfetch: 'reading',
  bash: 'running',
  edit: 'editing',
  write: 'writing',
  multiedit: 'editing',
  notebookedit: 'editing',
  websearch: 'searching',
  task: 'delegating to',
};

function targetOf(preview: string | undefined): string | undefined {
  if (!preview) return undefined;
  const firstLine = preview.split('\n')[0].trim();
  if (!firstLine) return undefined;
  const base = firstLine.split(/[\\/]/).pop() || firstLine;
  return base.length > 48 ? `${base.slice(0, 48)}…` : base;
}

/** The subagent's one-line "what it's doing right now", from its most recent tool call. */
export function currentActivity(a: Subagent): string | null {
  for (let i = a.steps.length - 1; i >= 0; i -= 1) {
    const s = a.steps[i];
    if (s.kind !== 'tool_call') continue;
    const verb = s.name ? (VERB[s.name.toLowerCase()] ?? 'using') : 'working';
    const target = targetOf(s.preview);
    return target ? `${verb} ${target}` : verb.charAt(0).toUpperCase() + verb.slice(1);
  }
  return null;
}

export interface SubagentMentionGroup {
  key: string;
  at: number;
  kind: 'start' | 'done';
  items: Array<{ id: string; name: string }>;
}

/**
 * Groups consecutive subagent_start (or subagent_done) events — nothing
 * else of any other type between them in the raw stream — into one mention
 * line: three Task calls launched in a single turn become one "X, Y and Z
 * started working" row; one that finishes on its own stays its own row.
 */
export function groupSubagentMentions(events: readonly SharedHlEvent[], byId: Map<string, Subagent>): SubagentMentionGroup[] {
  const groups: SubagentMentionGroup[] = [];
  let current: SubagentMentionGroup | null = null;
  for (const raw of events) {
    if (raw.type === 'subagent_start' || raw.type === 'subagent_done') {
      const kind: 'start' | 'done' = raw.type === 'subagent_start' ? 'start' : 'done';
      const id = raw.id;
      const name = byId.get(id)?.name ?? 'Subagent';
      const at = typeof raw.at === 'number' ? raw.at : (current?.at ?? Date.now());
      if (current && current.kind === kind) {
        current.items.push({ id, name });
        continue;
      }
      current = { key: `${kind}-${id}`, at, kind, items: [{ id, name }] };
      groups.push(current);
    } else {
      current = null;
    }
  }
  return groups;
}

/** "a", "a and b", "a, b and c". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Pdf selection review, Xlsx ui review and Glass contrast review started working." */
export function mentionText(group: SubagentMentionGroup): string {
  const verb = group.kind === 'start' ? 'started working' : 'finished';
  return `${joinNames(group.items.map((i) => i.name))} ${verb}`;
}

/**
 * Which turn each mention line belongs under, by timestamp: the turn whose
 * [startAt, endAt] window contains the mention, or the last turn if none
 * does (a mention arriving after the last block's own timestamp — the usual
 * case for a "done" line, since the Task result often lands a beat after
 * the orchestrator's last visible step). Takes a structural slice of Turn
 * rather than importing it, so this module (shared-ish display logic) never
 * has to depend on chat/turns.ts's Block-derived type.
 */
export function assignMentions<T extends { key: number; startAt?: number; endAt?: number }>(
  turns: readonly T[],
  groups: readonly SubagentMentionGroup[],
): Map<number, SubagentMentionGroup[]> {
  const out = new Map<number, SubagentMentionGroup[]>();
  for (const g of groups) {
    const turn = turns.find((t) => (t.startAt ?? -Infinity) <= g.at && g.at <= (t.endAt ?? Infinity)) ?? turns[turns.length - 1];
    if (!turn) continue;
    const list = out.get(turn.key);
    if (list) list.push(g);
    else out.set(turn.key, [g]);
  }
  return out;
}
