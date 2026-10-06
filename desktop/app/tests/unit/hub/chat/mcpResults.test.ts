import { describe, expect, it } from 'vitest';
import { detectResultCard } from '../../../../src/renderer/hub/chat/mcpResults';

const j = (v: unknown) => JSON.stringify(v, null, 2);

describe('mcpResults.detectResultCard', () => {
  it('google tasks_list becomes a tasks card', () => {
    const card = detectResultCard('mcp__google__tasks_list', j([
      { id: 't1', title: 'Cancel AI Plus subscription', due: '2027-10-03T00:00:00Z', status: 'needsAction' },
    ]));
    expect(card).toEqual({ kind: 'tasks', provider: 'google', items: [{ id: 't1', title: 'Cancel AI Plus subscription', due: '2027-10-03T00:00:00Z', status: 'needsAction' }] });
  });

  it('microsoft todo_tasks becomes a tasks card', () => {
    const card = detectResultCard('mcp__microsoft__todo_tasks', j([
      { id: 'w1', title: 'Renew passport', status: 'notStarted', dueDate: '2026-11-01T00:00:00' },
    ]));
    expect(card).toEqual({ kind: 'tasks', provider: 'microsoft', items: [{ id: 'w1', title: 'Renew passport', due: '2026-11-01T00:00:00', status: 'notStarted' }] });
  });

  it("microsoft calendar_create's own result (no `end` field) still becomes a single-item calendar card", () => {
    const card = detectResultCard('mcp__microsoft__calendar_create', j({ id: 'e9', subject: 'Standup', start: '2026-10-07T09:00:00' }));
    expect(card).toEqual({ kind: 'calendar', provider: 'microsoft', items: [{ id: 'e9', title: 'Standup', start: '2026-10-07T09:00:00', end: undefined, location: undefined, link: undefined }] });
  });

  it('an empty list produces no card (nothing to show)', () => {
    expect(detectResultCard('mcp__google__gmail_search', j([]))).toBeNull();
    expect(detectResultCard('mcp__google__calendar_list_events', j({ events: [] }))).toBeNull();
  });

  it('a tool name from an unknown server is never matched', () => {
    expect(detectResultCard('mcp__slack__list_channels', j([{ id: 'c1' }]))).toBeNull();
  });

  it("Codex's generic 'MCP' tool name is never matched (it collapses every MCP call, see codex/adapter.ts)", () => {
    expect(detectResultCard('MCP', j([{ id: 'm1', subject: 'x' }]))).toBeNull();
  });

  it('a plain (non-MCP) tool name is never matched', () => {
    expect(detectResultCard('Bash', j({ events: [{ summary: 'x' }] }))).toBeNull();
  });
});
