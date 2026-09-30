import { describe, expect, it } from 'vitest';
import { appendEvent, buildTranscript, classifyTool, EMPTY_TRANSCRIPT } from '../../../src/renderer/logs/transcript';

describe('transcript', () => {
  it('merges streamed prose deltas into one block and keeps earlier blocks by identity', () => {
    let t = buildTranscript('find my resume', []);
    const userBlock = t.blocks[0];
    t = appendEvent(t, { type: 'thinking', text: 'Looking ' });
    t = appendEvent(t, { type: 'thinking', text: 'for it.' });
    expect(t.blocks).toHaveLength(2);
    expect(t.blocks[1]).toMatchObject({ kind: 'text', text: 'Looking for it.' });
    expect(t.blocks[0]).toBe(userBlock);
  });

  it('pairs a tool result with its call even when prose came in between', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'tool_call', name: 'WebSearch', args: { preview: 'dex agents' }, iteration: 1 });
    t = appendEvent(t, { type: 'thinking', text: 'Searching…' });
    t = appendEvent(t, { type: 'tool_result', name: 'WebSearch', ok: true, preview: '10 results', ms: 840 });
    const tool = t.blocks[0];
    expect(tool.kind).toBe('tool');
    if (tool.kind !== 'tool') return;
    expect(tool.summary).toBe('dex agents');
    expect(tool.result).toEqual({ ok: true, preview: '10 results', ms: 840 });
  });

  it('does not repeat the opening prompt when the engine echoes it', () => {
    const t = buildTranscript('hi', [{ type: 'user_input', text: 'hi' }, { type: 'user_input', text: 'and more' }]);
    expect(t.blocks.map((b) => b.kind)).toEqual(['user', 'user']);
    expect(t.blocks[1]).toMatchObject({ text: 'and more' });
  });

  it('accumulates usage instead of adding blocks', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'turn_usage', inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, costUsd: 0.01 });
    t = appendEvent(t, { type: 'turn_usage', inputTokens: 50, outputTokens: 5, cachedInputTokens: 10, costUsd: 0.02 });
    expect(t.blocks).toHaveLength(0);
    expect(t.usage).toMatchObject({ inputTokens: 150, outputTokens: 25, cachedInputTokens: 10, turns: 2 });
    expect(t.usage.costUsd).toBeCloseTo(0.03);
  });

  it('gives each kind of action its own orb', () => {
    expect(classifyTool('WebSearch').orb).toBe('searching');
    expect(classifyTool('mcp__github__create_issue')).toMatchObject({ kind: 'mcp', orb: 'connecting', display: 'github · create_issue' });
    expect(classifyTool('Bash').kind).toBe('run');
    expect(classifyTool('Edit').kind).toBe('write');
    expect(classifyTool('Read').kind).toBe('read');
    expect(classifyTool('navigate').kind).toBe('browse');
    expect(classifyTool('screenshot').kind).toBe('desktop');
  });
});

describe('done echo', () => {
  it('marks a summary that repeats the last reply as an echo', () => {
    const answer = 'I searched Google Flights.\n\n| Flight | Price |\n|---|---|\n| Etihad | $621 |';
    const t = buildTranscript('find me a flight', [
      { type: 'thinking', text: answer } as never,
      { type: 'done', summary: answer, iterations: 13 } as never,
    ]);
    const done = t.blocks.find((b) => b.kind === 'done');
    expect(done && done.kind === 'done' && done.echo).toBe(true);
  });

  it('still spots the echo when streaming dropped a space', () => {
    const t = buildTranscript('how many users', [
      { type: 'thinking', text: 'There are **114users** on the list.' } as never,
      { type: 'done', summary: 'There are 114 users on the list.', iterations: 2 } as never,
    ]);
    const done = t.blocks.find((b) => b.kind === 'done');
    expect(done && done.kind === 'done' && done.echo).toBe(true);
  });

  it('keeps a real summary', () => {
    const t = buildTranscript('x', [
      { type: 'thinking', text: 'Opening the page now.' } as never,
      { type: 'done', summary: 'Downloaded the syllabus to Downloads/cns.pdf.', iterations: 3 } as never,
    ]);
    const done = t.blocks.find((b) => b.kind === 'done');
    expect(done && done.kind === 'done' && done.echo).toBe(false);
  });
});

describe('user attachments', () => {
  it('rides on the user message it was sent with', () => {
    const t = buildTranscript('what is in this photo?', [
      { type: 'user_attachments', items: [{ name: 'cat.jpg', mime: 'image/jpeg', size: 1200 }] } as never,
      { type: 'thinking', text: 'A cat.' } as never,
      { type: 'user_input', text: 'and this pdf?' } as never,
      { type: 'user_attachments', items: [{ name: 'doc.pdf', mime: 'application/pdf', size: 9000 }] } as never,
    ]);
    const users = t.blocks.filter((b) => b.kind === 'user');
    expect(users).toHaveLength(2);
    expect(users[0].kind === 'user' && users[0].attachments?.map((a) => a.name)).toEqual(['cat.jpg']);
    expect(users[1].kind === 'user' && users[1].attachments?.map((a) => a.name)).toEqual(['doc.pdf']);
  });
});

describe('times', () => {
  it('records when each block started and when it last changed', () => {
    const t = buildTranscript('go', [
      { type: 'thinking', text: 'Look', at: 1000 },
      { type: 'thinking', text: 'ing', at: 1500 },
      { type: 'tool_call', name: 'Bash', args: { command: 'ls' }, iteration: 1, at: 2000 },
      { type: 'tool_result', name: 'Bash', ok: true, preview: 'a', ms: 5, at: 4000 },
      { type: 'done', summary: 'ok', iterations: 1, at: 5000 },
    ]);
    const [, text, tool, done] = t.blocks;
    expect(text).toMatchObject({ kind: 'text', text: 'Looking', at: 1000, endAt: 1500 });
    expect(tool).toMatchObject({ kind: 'tool', at: 2000, endAt: 4000 });
    expect(done).toMatchObject({ kind: 'done', at: 5000, endAt: 5000 });
  });

  it('leaves times off events recorded before they carried any', () => {
    const t = appendEvent(EMPTY_TRANSCRIPT, { type: 'thinking', text: 'old' });
    expect(t.blocks[0].at).toBeUndefined();
  });
});
