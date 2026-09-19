// @vitest-environment jsdom
/**
 * Regression test for the bug behind a dex-registry confirmation card (and
 * every other deck card) never appearing in the real app: SessionManager's
 * appendOutput only broadcasts a full 'session-updated' snapshot for a
 * handful of coarse events (turn_usage, stuck-recovery, pause, navigation) —
 * not for ordinary tool_call / artifact / screenshot / confirmation /
 * task_state events, which stream one at a time over the separate
 * 'session-output' channel instead. The floating Logs window listens to that
 * channel directly; the main app's session query cache did not, so
 * AgentSession.output — what deckHasContent/hasPendingConfirmation/
 * PreviewDeck all read — was frozen at whatever it was on the last full
 * fetch or coarse broadcast. See useSessionsQuery.ts for the fix.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionsQuery } from '../../../src/renderer/hub/useSessionsQuery';
import type { AgentSession, HlEvent } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 's1',
    prompt: 'do the thing',
    status: 'running',
    createdAt: 0,
    output: [],
    ...overrides,
  } as AgentSession;
}

function installElectronApi(initial: AgentSession[]): {
  fireSessionUpdated: (session: AgentSession) => void;
  fireSessionOutput: (id: string, event: HlEvent) => void;
} {
  let updatedCb: ((session: AgentSession) => void) | null = null;
  let outputCb: ((id: string, event: HlEvent) => void) | null = null;

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sessions: { listAll: vi.fn(async () => initial) },
      on: {
        sessionUpdated: (cb: (session: AgentSession) => void) => {
          updatedCb = cb;
          return () => { updatedCb = null; };
        },
        sessionOutput: (cb: (id: string, event: HlEvent) => void) => {
          outputCb = cb;
          return () => { outputCb = null; };
        },
      },
    },
  });

  return {
    fireSessionUpdated: (session) => updatedCb?.(session),
    fireSessionOutput: (id, event) => outputCb?.(id, event),
  };
}

let latest: ReturnType<typeof useSessionsQuery> | null = null;
function Probe(): null {
  latest = useSessionsQuery();
  return null;
}

function renderProbe(): { root: Root; qc: QueryClient } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { root, qc };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const SESSIONS_KEY = ['sessions'] as const;

async function waitForData(qc: QueryClient): Promise<AgentSession[]> {
  for (let i = 0; i < 20; i++) {
    const data = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
    if (data != null) return data;
    await flush();
  }
  throw new Error('query never resolved');
}

async function fire(cb: () => void): Promise<void> {
  await act(async () => {
    cb();
    // react-query's notifyManager batches observer updates onto a macrotask
    // in this environment, not just a microtask — a bare Promise.resolve()
    // chain resolves before that fires, which is harmless for the cache
    // assertions below (they read the QueryClient directly) but leaves
    // Probe's own re-render dangling outside this act() call.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useSessionsQuery live output wiring', () => {
  beforeEach(() => {
    latest = null;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('appends events delivered over sessionOutput into that session\'s output array', async () => {
    const { fireSessionOutput } = installElectronApi([baseSession()]);
    const { qc } = renderProbe();
    const initial = await waitForData(qc);

    expect(initial[0].output).toEqual([]);

    await fire(() => {
      fireSessionOutput('s1', { type: 'tool_call', name: 'dex-registry', args: {}, iteration: 1 });
    });

    expect(qc.getQueryData<AgentSession[]>(SESSIONS_KEY)?.[0].output).toEqual([
      { type: 'tool_call', name: 'dex-registry', args: {}, iteration: 1 },
    ]);
  });

  it('does not duplicate an event that arrives via sessionOutput right after a sessionUpdated snapshot already carrying it', async () => {
    // Mirrors real ordering: SessionManager pushes the event into session.output,
    // conditionally emits 'session-updated' with that full (already-updated)
    // session, then unconditionally emits 'session-output' with the same event.
    const confirmEvent: HlEvent = { type: 'confirmation', id: 'c1', title: 'Set registry value', detail: '...', status: 'pending', at: 1 };
    const { fireSessionUpdated, fireSessionOutput } = installElectronApi([baseSession()]);
    const { qc } = renderProbe();
    await waitForData(qc);

    await fire(() => {
      fireSessionUpdated(baseSession({ status: 'stuck', output: [confirmEvent] }));
      fireSessionOutput('s1', confirmEvent);
    });

    const after = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
    // The local, incrementally-built array must win — not a second copy of
    // the event that the coarse snapshot happened to also be carrying.
    expect(after?.[0].output).toEqual([confirmEvent]);
    // Non-output fields from the snapshot still land.
    expect(after?.[0].status).toBe('stuck');
  });

  it('ignores a sessionOutput event for a session not yet in the cache', async () => {
    const { fireSessionOutput } = installElectronApi([baseSession()]);
    const { qc } = renderProbe();
    await waitForData(qc);

    await fire(() => {
      fireSessionOutput('unknown-session', { type: 'tool_call', name: 'dex-sh', args: {}, iteration: 1 });
    });

    const after = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
    expect(after?.length).toBe(1);
    expect(after?.[0].output).toEqual([]);
  });
});
