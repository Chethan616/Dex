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
    expect(classifyTool('mcp__github__create_issue')).toMatchObject({ kind: 'mcp', orb: 'connecting', display: 'GitHub · create issue' });
    expect(classifyTool('mcp__remote_kiwi__search-flight').display).toBe('Kiwi.com flights · search flight');
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

describe('the Windows tools, in plain words', () => {
  it('says what each step did, with the app and the control', () => {
    expect(classifyTool('mcp__windows__ui_invoke', { window: { process: 'Spotify.exe' }, target: { name: 'Shuffle' } }))
      .toMatchObject({ kind: 'desktop', active: 'Pressing “Shuffle” in Spotify', done: 'Pressed “Shuffle” in Spotify', display: '' });
    expect(classifyTool('mcp__windows__system_info', { topic: 'wifi' })).toMatchObject({ done: 'Read your Wi-Fi adapter' });
    expect(classifyTool('mcp__windows__media', { action: 'shuffle', value: true })).toMatchObject({ done: 'Turned shuffle on' });
    expect(classifyTool('mcp__windows__system_change', { action: 'dns_set', args: { adapter: 'Wi-Fi', servers: ['1.1.1.1'] } })).toMatchObject({ done: 'Changed Wi-Fi DNS servers' });
    expect(classifyTool('mcp__windows__app_launch', { app: 'C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe' })).toMatchObject({ done: 'Opened Spotify in the background' });
  });

  it('names the control from the result once a handle is all the call had', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'tool_call', name: 'mcp__windows__ui_invoke', args: { window: { hwnd: 7 }, target: 'e17' } });
    const before = t.blocks[0];
    expect(before.kind === 'tool' && before.meta.active).toBe('Pressing a control in the app');
    t = appendEvent(t, { type: 'tool_result', name: 'mcp__windows__ui_invoke', ok: true, preview: '{"method":"invoke","element":{"name":"Like \\"song\\"","role":"Button"}}' });
    const after = t.blocks[0];
    expect(after.kind === 'tool' && after.meta.done).toBe('Pressed “Like "song"” in the app');
  });

  it('names the app from the result, and a window PowerShell hosts by its title', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'tool_call', name: 'mcp__windows__ui_toggle', args: { window: { hwnd: 7 }, target: 'e4', state: 'on' } });
    t = appendEvent(t, { type: 'tool_result', name: 'mcp__windows__ui_toggle', ok: true, preview: '{"was":"off","now":"on","element":{"name":"Enable shuffle","role":"CheckBox"},"window":{"hwnd":7,"title":"DEX desk fixture","process":"powershell.exe"}}' });
    t = appendEvent(t, { type: 'tool_call', name: 'mcp__windows__window_tree', args: { window: { hwnd: 9 } } });
    t = appendEvent(t, { type: 'tool_result', name: 'mcp__windows__window_tree', ok: true, preview: '{"window":{"hwnd":9,"title":"Spotify Premium","process":"Spotify.exe"},"nodes":[]}' });
    const [toggle, tree] = t.blocks;
    expect(toggle.kind === 'tool' && toggle.meta.done).toBe('Turned “Enable shuffle” on in DEX desk fixture');
    expect(tree.kind === 'tool' && tree.meta.done).toBe('Read what’s in Spotify');
  });
});

describe('changes to the PC', () => {
  it('folds an undo onto the change it undid', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'desk_change', entry: '1700000000000-dns_set', title: "Set Wi-Fi's DNS to 1.1.1.1", reason: 'Lookups time out', undoable: true });
    expect(t.blocks[0]).toMatchObject({ kind: 'change', undoable: true, undone: false });
    t = appendEvent(t, { type: 'desk_change', entry: '1700000000999-dns_set', title: "Undid: Set Wi-Fi's DNS to 1.1.1.1", undoable: false, undoes: '1700000000000-dns_set' });
    expect(t.blocks[0]).toMatchObject({ undone: true });
    expect(t.blocks[1]).toMatchObject({ kind: 'change', undoes: '1700000000000-dns_set' });
  });
});
