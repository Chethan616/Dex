/**
 * Grid view used to re-render every AgentPane on every sessions refetch or
 * unrelated session's output event, because HubApp recreates the whole
 * `sessions` array (and per-row callback props) by reference each time —
 * see AgentPane.tsx's areAgentPanePropsEqual for the fix. This tests that
 * comparator directly: it's the actual novel logic, and far cheaper to
 * verify this way than by rendering the full component (heavy IPC/
 * ResizeObserver dependencies) and counting renders.
 */
import { describe, it, expect } from 'vitest';
import { areAgentPanePropsEqual, type AgentPaneProps } from '../../../src/renderer/hub/AgentPane';
import type { AgentSession } from '../../../src/renderer/hub/types';

function session(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 's1',
    prompt: 'do the thing',
    status: 'running',
    createdAt: 0,
    output: [],
    ...overrides,
  };
}

function props(overrides?: Partial<AgentPaneProps>): AgentPaneProps {
  return {
    session: session(),
    focused: false,
    ...overrides,
  };
}

describe('areAgentPanePropsEqual', () => {
  it('is equal when session is the exact same reference', () => {
    const s = session();
    expect(areAgentPanePropsEqual(props({ session: s }), props({ session: s }))).toBe(true);
  });

  it('is equal for a new session object with identical meaningful fields (the actual bug this fixes)', () => {
    // Simulates useSessionsQuery/listAll() handing back a freshly
    // deserialized object every refetch even when nothing changed.
    const a = session();
    const b = { ...session() };
    expect(a).not.toBe(b);
    expect(areAgentPanePropsEqual(props({ session: a }), props({ session: b }))).toBe(true);
  });

  it('is NOT equal when status changes', () => {
    const a = session({ status: 'running' });
    const b = session({ status: 'idle' });
    expect(areAgentPanePropsEqual(props({ session: a }), props({ session: b }))).toBe(false);
  });

  it('is NOT equal when the output array reference changes (new events arrived)', () => {
    const a = session({ output: [] });
    const b = session({ output: [{ type: 'thinking', text: 'hi' }] });
    expect(areAgentPanePropsEqual(props({ session: a }), props({ session: b }))).toBe(false);
  });

  it('is equal when the output array reference is unchanged, even if other unrelated fields differ by identity elsewhere', () => {
    const out = [{ type: 'thinking' as const, text: 'hi' }];
    const a = session({ output: out });
    const b = { ...session({ output: out }) };
    expect(areAgentPanePropsEqual(props({ session: a }), props({ session: b }))).toBe(true);
  });

  it('is NOT equal when focused changes', () => {
    const s = session();
    expect(areAgentPanePropsEqual(props({ session: s, focused: false }), props({ session: s, focused: true }))).toBe(false);
  });

  it('is NOT equal when followUpShortcut changes', () => {
    const s = session();
    expect(areAgentPanePropsEqual(
      props({ session: s, followUpShortcut: 'Ctrl+K' }),
      props({ session: s, followUpShortcut: 'Ctrl+L' }),
    )).toBe(false);
  });

  it('ignores callback prop identity entirely — a brand-new function every render never blocks the memo bail-out', () => {
    const s = session();
    const prev = props({ session: s, onRerun: () => {}, onDismiss: () => {}, onCancel: () => {} });
    const next = props({ session: s, onRerun: () => {}, onDismiss: () => {}, onCancel: () => {} });
    expect(prev.onRerun).not.toBe(next.onRerun);
    expect(areAgentPanePropsEqual(prev, next)).toBe(true);
  });

  it('is NOT equal when a cost/usage field changes', () => {
    const a = session({ costUsd: 0.01 });
    const b = session({ costUsd: 0.02 });
    expect(areAgentPanePropsEqual(props({ session: a }), props({ session: b }))).toBe(false);
  });
});
