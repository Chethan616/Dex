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
