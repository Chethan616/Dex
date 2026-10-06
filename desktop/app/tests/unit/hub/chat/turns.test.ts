import { describe, expect, it } from 'vitest';
import { buildTranscript } from '../../../../src/renderer/logs/transcript';
import { allOutputs, collectSources, formatDuration, toTurns } from '../../../../src/renderer/hub/chat/turns';

const run = [
  { type: 'thinking', text: 'Let me look at the repo.', at: 1_000 },
  { type: 'tool_call', name: 'Bash', args: { command: 'git status' }, iteration: 1, at: 2_000 },
  { type: 'tool_result', name: 'Bash', ok: true, preview: 'clean', ms: 40, at: 3_000 },
  { type: 'tool_call', name: 'WebSearch', args: { query: 'mealmuse vercel' }, iteration: 2, at: 4_000 },
  { type: 'tool_result', name: 'WebSearch', ok: true, preview: '…', ms: 40, at: 5_000 },
  { type: 'tool_call', name: 'browser_navigate', args: { url: 'https://vercel.com/docs' }, iteration: 3, at: 6_000 },
  { type: 'tool_result', name: 'browser_navigate', ok: true, preview: '', ms: 40, at: 7_000 },
  { type: 'file_output', name: 'Report.pdf', path: 'C:/Users/me/Report.pdf', size: 2048, mime: 'application/pdf', at: 8_000 },
  { type: 'thinking', text: 'Done. The **report** is ready.', at: 9_000 },
  { type: 'done', summary: 'Done. The report is ready.', iterations: 3, at: 10_000 },
  { type: 'user_input', text: 'make it shorter', at: 20_000 },
  { type: 'thinking', text: 'Shortening', at: 21_000 },
];

describe('chat turns', () => {
  const t = buildTranscript('write the report', run);

  it('folds the work, keeps the reply, and lists the files of each turn', () => {
    const [first, second] = toTurns(t.blocks, true, 0);
    expect(first.user?.text).toBe('write the report');
    expect(first.work.map((b) => b.kind)).toEqual(['text', 'tool', 'tool', 'tool']);
    expect(first.reply).toBe('Done. The **report** is ready.'); // the summary only echoed it
    expect(first.files).toEqual([{ name: 'Report.pdf', path: 'C:/Users/me/Report.pdf', size: 2048, mime: 'application/pdf' }]);
    expect(first.live).toBe(false);
    expect(first.startAt).toBe(0);
    expect(first.endAt).toBe(10_000);

    expect(second.user?.text).toBe('make it shorter');
    expect(second.live).toBe(true);
    expect(second.replyStreaming).toBe(true);
    expect(second.startAt).toBe(20_000);
  });

  it('shows a summary that adds something the reply didn’t say', () => {
    const [turn] = toTurns(buildTranscript('x', [
      { type: 'tool_call', name: 'Bash', args: {}, iteration: 1 },
      { type: 'tool_result', name: 'Bash', ok: true, preview: '', ms: 1 },
      { type: 'done', summary: 'Pushed to GitHub in commit 643b55f.', iterations: 1 },
    ]).blocks, false);
    expect(turn.reply).toBe('Pushed to GitHub in commit 643b55f.');
  });

  it('keeps errors and blocking notices in the open', () => {
    const [turn] = toTurns(buildTranscript('x', [
      { type: 'notify', message: 'Log in to continue', level: 'blocking' },
      { type: 'notify', message: 'fyi', level: 'info' },
      { type: 'error', message: 'boom' },
    ]).blocks, false);
    expect(turn.alerts.map((b) => b.kind)).toEqual(['notice', 'error']);
    expect(turn.work.map((b) => b.kind)).toEqual(['notice']);
  });

  it('lists outputs once each and the sources DEX drew on', () => {
    const turns = toTurns(t.blocks, false);
    expect(allOutputs(turns).map((f) => f.name)).toEqual(['Report.pdf']);
    expect(collectSources(t.blocks, ['https://www.github.com/x/y'])).toEqual([
      { kind: 'search', query: 'mealmuse vercel' },
      { kind: 'site', url: 'https://vercel.com/docs', host: 'vercel.com' },
      { kind: 'site', url: 'https://www.github.com/x/y', host: 'github.com' },
    ]);
  });

  it('formats durations the way Codex does', () => {
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(225_000)).toBe('3m 45s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
});

describe('chat turns: MCP result cards and follow-up chips', () => {
  function turnFor(toolName: string, result: unknown, reply = 'Done.') {
    const [turn] = toTurns(buildTranscript('check my calendar', [
      { type: 'tool_call', name: toolName, args: {}, iteration: 1 },
      { type: 'tool_result', name: toolName, ok: true, preview: JSON.stringify(result, null, 2), ms: 40 },
      { type: 'thinking', text: reply },
      { type: 'done', summary: reply, iterations: 1 },
    ]).blocks, false);
    return turn;
  }

  it('turns a finished calendar_list_events result into a calendar card', () => {
    const turn = turnFor('mcp__google__calendar_list_events', {
      timeZone: 'UTC',
      events: [{ id: 'e1', summary: 'Cancel AI Plus subscription', start: '2027-09-28T09:00:00Z', end: '2027-09-28T10:00:00Z', link: 'https://calendar.google.com/e1' }],
    });
    expect(turn.resultCards).toEqual([
      { kind: 'calendar', provider: 'google', items: [{ id: 'e1', title: 'Cancel AI Plus subscription', start: '2027-09-28T09:00:00Z', end: '2027-09-28T10:00:00Z', location: undefined, link: 'https://calendar.google.com/e1' }] },
    ]);
  });

  it('cards only appear once the turn has settled, not while it is still live', () => {
    const [turn] = toTurns(buildTranscript('x', [
      { type: 'tool_call', name: 'mcp__google__gmail_search', args: {}, iteration: 1 },
      { type: 'tool_result', name: 'mcp__google__gmail_search', ok: true, preview: JSON.stringify([{ id: 'm1', subject: 'Hi' }]), ms: 1 },
    ]).blocks, true); // live
    expect(turn.resultCards).toEqual([]);
  });

  it('a mail list becomes a mail card', () => {
    const turn = turnFor('mcp__microsoft__mail_list', [
      { id: 'm1', subject: 'Invoice', fromName: 'Billing', received: '2026-10-01', isRead: false, preview: 'Your invoice is ready' },
    ]);
    expect(turn.resultCards).toEqual([
      { kind: 'mail', provider: 'microsoft', items: [{ id: 'm1', subject: 'Invoice', from: 'Billing', date: '2026-10-01', unread: true, snippet: 'Your invoice is ready' }] },
    ]);
  });

  it('an unrecognised tool or a non-MCP tool never produces a card', () => {
    expect(turnFor('Bash', { ok: true }).resultCards).toEqual([]);
    expect(turnFor('mcp__google__drive_search', [{ id: 'f1', name: 'x.pdf' }]).resultCards).toEqual([]);
  });

  it('a truncated/invalid JSON preview falls back to no card instead of throwing', () => {
    const [turn] = toTurns(buildTranscript('x', [
      { type: 'tool_call', name: 'mcp__google__calendar_list_events', args: {}, iteration: 1 },
      { type: 'tool_result', name: 'mcp__google__calendar_list_events', ok: true, preview: '{"events": [ { "summary": "cut off', ms: 1 },
      { type: 'done', summary: 'Done', iterations: 1 },
    ]).blocks, false);
    expect(turn.resultCards).toEqual([]);
  });

  it('a calendar tool used this turn offers "Show my week" / "Any conflicts?" chips', () => {
    const turn = turnFor('mcp__google__calendar_list_events', { events: [] });
    expect(turn.chips).toEqual([
      { label: 'Show my week', prompt: 'Show my calendar for this week' },
      { label: 'Any conflicts?', prompt: 'Are there any conflicts on my calendar this week?' },
    ]);
  });

  it('a mail tool offers mail chips, and chips are capped at 3 total', () => {
    const turn = turnFor('mcp__google__gmail_search', []);
    expect(turn.chips.map((c) => c.label)).toEqual(['Show unread emails', 'Anything urgent?']);
  });

  it('no MCP tool used this turn means no chips', () => {
    expect(turnFor('Bash', { ok: true }).chips).toEqual([]);
  });

  it('chips never appear on a turn with no reply yet (still running)', () => {
    const [turn] = toTurns(buildTranscript('x', [
      { type: 'tool_call', name: 'mcp__google__gmail_search', args: {}, iteration: 1 },
      { type: 'tool_result', name: 'mcp__google__gmail_search', ok: true, preview: '[]', ms: 1 },
    ]).blocks, true);
    expect(turn.chips).toEqual([]);
  });
});
