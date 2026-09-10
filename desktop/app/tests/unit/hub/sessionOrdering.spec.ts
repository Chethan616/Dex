import { describe, expect, it } from 'vitest';
import { orderSessionsForSidebar } from '../../../src/renderer/hub/sessionOrdering';
import type { AgentSession } from '../../../src/renderer/hub/types';

function session(id: string, status: AgentSession['status'], createdAt: number, lastActivityAt?: number): AgentSession {
  return {
    id,
    status,
    createdAt,
    lastActivityAt,
    prompt: id,
    output: [],
  };
}

describe('orderSessionsForSidebar', () => {
  it('orders sessions chronologically by the sidebar timestamp', () => {
    const sessions = [
      session('old-running', 'running', 10, 20),
      session('new-stopped', 'stopped', 70),
      session('new-idle', 'idle', 30, 90),
      session('old-stopped', 'stopped', 50),
      session('stuck', 'stuck', 60, 80),
    ];

    expect(orderSessionsForSidebar(sessions).map((s) => s.id)).toEqual([
      'new-idle',
      'stuck',
      'new-stopped',
      'old-stopped',
      'old-running',
    ]);
  });
});

describe('orderSessionsForSidebar — pinning', () => {
  const sessions = [
    session('a', 'idle', 10, 100),
    session('b', 'idle', 20, 90),
    session('c', 'idle', 30, 80),
  ];

  it('leaves order untouched when nothing is pinned', () => {
    expect(orderSessionsForSidebar(sessions).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('floats a pinned session above more recent ones', () => {
    // 'c' is the least recently active, so without pinning it sorts last.
    // Pinning has to beat recency or the row slides away the moment anything
    // else runs, which is the whole point of pinning it.
    expect(orderSessionsForSidebar(sessions, new Set(['c'])).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps pinned sessions in activity order among themselves', () => {
    expect(orderSessionsForSidebar(sessions, new Set(['b', 'c'])).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('ignores pinned ids that no longer exist', () => {
    expect(orderSessionsForSidebar(sessions, new Set(['gone'])).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
