import { describe, expect, it } from 'vitest';
import { detectResultCard, mergeResultCards } from '../../../../src/renderer/hub/chat/mcpResults';

const j = (v: unknown) => JSON.stringify(v, null, 2);

describe('mcpResults.detectResultCard', () => {
  it('google tasks_list becomes a tasks card', () => {
    const card = detectResultCard('mcp__google__tasks_list', j([
      { id: 't1', title: 'Cancel AI Plus subscription', due: '2027-10-03T00:00:00Z', status: 'needsAction' },
    ]));
    expect(card).toEqual({ kind: 'tasks', provider: 'google', items: [{ id: 't1', title: 'Cancel AI Plus subscription', due: '2027-10-03T00:00:00Z', status: 'needsAction', link: 'https://tasks.google.com/' }] });
  });

  it('microsoft todo_tasks becomes a tasks card', () => {
    const card = detectResultCard('mcp__microsoft__todo_tasks', j([
      { id: 'w1', title: 'Renew passport', status: 'notStarted', dueDate: '2026-11-01T00:00:00' },
    ]));
    expect(card).toEqual({ kind: 'tasks', provider: 'microsoft', items: [{ id: 'w1', title: 'Renew passport', due: '2026-11-01T00:00:00', status: 'notStarted', link: 'https://to-do.office.com/tasks/' }] });
  });

  it("microsoft calendar_create's own result (no `end` field) still becomes a single-item calendar card", () => {
    const card = detectResultCard('mcp__microsoft__calendar_create', j({ id: 'e9', subject: 'Standup', start: '2026-10-07T09:00:00' }));
    expect(card).toEqual({ kind: 'calendar', provider: 'microsoft', items: [{ id: 'e9', title: 'Standup', start: '2026-10-07T09:00:00', end: undefined, location: undefined, link: undefined }], wrote: true });
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

describe('one card per kind in a turn', () => {
  const event = { id: 'e1', summary: 'Review final', start: '2026-10-30', end: '2026-10-31', link: 'https://calendar.google.com/event?eid=e1' };
  it('an event added, then the day listed to check it, shows once: the added one', () => {
    const made = detectResultCard('mcp__google__calendar_create_event', j(event))!;
    const listed = detectResultCard('mcp__google__calendar_list_events', j({ events: [event, { id: 'e2', summary: 'Lunch', start: '2026-10-30T13:00:00Z' }] }))!;
    const cards = mergeResultCards([made, listed]);
    expect(cards).toHaveLength(1);
    expect(cards[0].items.map((i) => ('title' in i ? i.title : ''))).toEqual(['Review final']);
  });

  it('a retried create or a repeated list keeps each item once', () => {
    const made = detectResultCard('mcp__google__calendar_create_event', j(event))!;
    expect(mergeResultCards([made, made])[0].items).toHaveLength(1);
    const tasks = detectResultCard('mcp__google__tasks_list', j([{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }]))!;
    const again = detectResultCard('mcp__google__tasks_list', j([{ id: 't2', title: 'B' }, { id: 't3', title: 'C' }]))!;
    const merged = mergeResultCards([tasks, again]);
    expect(merged).toHaveLength(1);
    expect(merged[0].items.map((i) => ('title' in i ? i.title : ''))).toEqual(['A', 'B', 'C']);
  });

  it('keeps different kinds apart, and gives mail a link to the message', () => {
    const mail = detectResultCard('mcp__google__gmail_search', j([{ id: '18c2f', subject: 'Hi', from: 'A' }]))!;
    const tasks = detectResultCard('mcp__google__tasks_list', j([{ id: 't1', title: 'A' }]))!;
    const cards = mergeResultCards([mail, tasks]);
    expect(cards.map((c) => c.kind)).toEqual(['mail', 'tasks']);
    expect((cards[0].items[0] as { link?: string }).link).toBe('https://mail.google.com/mail/u/0/#all/18c2f');
  });
});
