/**
 * subagents — folds a session's subagent_start/subagent_step/subagent_done
 * events (session-schemas.ts) into per-subagent records.
 *
 * Shared between the renderer (chat mention rows, the Subagents tab) and the
 * main-process Firebase bridge (which mirrors the same records to Firestore
 * for the phone), so both sides agree on one shape. Pure and dependency-free,
 * like session-schemas.ts itself, so it bundles into either side with no
 * extra cost.
 *
 * Folded incrementally (like logs/transcript.ts's Transcript) rather than
 * recomputed from the full event array on every call: a long session's
 * output only grows, and refolding it from scratch on each new event would
 * cost O(events²) over the session's life.
 */
import type { HlEvent } from './session-schemas';

export type SubagentStatus = 'active' | 'done';

export interface SubagentStep {
  at?: number;
  kind: 'tool_call' | 'tool_result';
  name?: string;
  preview?: string;
  ok?: boolean;
  ms?: number;
}

export interface Subagent {
  id: string;
  name: string;
  subagentType?: string;
  prompt: string;
  status: SubagentStatus;
  ok?: boolean;
  summary?: string;
  startedAt?: number;
  endedAt?: number;
  steps: SubagentStep[];
}

export interface SubagentsState {
  byId: Map<string, Subagent>;
  /** Insertion order, so listings and "started together" grouping stay stable. */
  order: string[];
}

export const EMPTY_SUBAGENTS: SubagentsState = { byId: new Map(), order: [] };

export function foldSubagentEvent(state: SubagentsState, e: HlEvent): SubagentsState {
  if (e.type === 'subagent_start') {
    if (state.byId.has(e.id)) return state; // a resumed session replaying the same event
    const byId = new Map(state.byId);
    byId.set(e.id, {
      id: e.id,
      name: e.name || 'Subagent',
      subagentType: e.subagentType,
      prompt: e.prompt ?? '',
      status: 'active',
      startedAt: e.at,
      steps: [],
    });
    return { byId, order: [...state.order, e.id] };
  }
  if (e.type === 'subagent_step') {
    const existing = state.byId.get(e.id);
    if (!existing) return state;
    const byId = new Map(state.byId);
    byId.set(e.id, {
      ...existing,
      steps: [...existing.steps, { at: e.at, kind: e.kind, name: e.name, preview: e.preview, ok: e.ok, ms: e.ms }],
    });
    return { byId, order: state.order };
  }
  if (e.type === 'subagent_done') {
    const existing = state.byId.get(e.id);
    if (!existing) return state;
    const byId = new Map(state.byId);
    byId.set(e.id, { ...existing, status: 'done', ok: e.ok, summary: e.summary, endedAt: e.at });
    return { byId, order: state.order };
  }
  return state;
}

export function buildSubagents(events: readonly HlEvent[]): SubagentsState {
  return events.reduce(foldSubagentEvent, EMPTY_SUBAGENTS);
}

export function subagentsList(state: SubagentsState): Subagent[] {
  return state.order.map((id) => state.byId.get(id)).filter((s): s is Subagent => Boolean(s));
}
