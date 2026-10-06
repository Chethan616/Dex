import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const cliSpawnMocks = vi.hoisted(() => ({
  runCliCapture: vi.fn(),
  spawnCli: vi.fn(),
}));

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/hl/engines/cliSpawn', () => cliSpawnMocks);
vi.mock('../../../src/main/hl/engines/pathEnrich', () => ({
  enrichedEnv: vi.fn((env?: NodeJS.ProcessEnv) => env ?? process.env),
}));

async function claudeCodeAdapter(): Promise<EngineAdapter> {
  const { get } = await import('../../../src/main/hl/engines/registry');
  await import('../../../src/main/hl/engines/claude-code/adapter');
  const adapter = get('claude-code');
  if (!adapter) throw new Error('claude-code adapter not registered');
  return adapter;
}

function spawnContext(resumeSessionId?: string): SpawnContext {
  return {
    prompt: 'Open the docs and summarize the page.',
    harnessDir: '/tmp/harness',
    sessionId: 'session-123',
    targetId: 'target-123',
    cdpPort: 9222,
    resumeSessionId,
    attachmentRefs: [],
  };
}

describe('claude-code adapter auth probing', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('surfaces transport failures from runCliCapture during auth probing', async () => {
    cliSpawnMocks.runCliCapture.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: '',
      error: 'spawn claude ENOENT',
      code: null,
    });

    const adapter = await claudeCodeAdapter();

    await expect(adapter.probeAuthed()).resolves.toEqual({
      authed: false,
      error: 'spawn claude ENOENT',
    });
  });

  it('does not fail a task because the auth check was slow', async () => {
    // A cold `claude auth status` took >5s and a phone task was failed as
    // "not authenticated" before it ran. A timeout is "unknown", not "no".
    cliSpawnMocks.runCliCapture.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: '',
      error: 'Timed out after 15000ms',
      code: null,
    });

    const adapter = await claudeCodeAdapter();

    await expect(adapter.probeAuthed()).resolves.toEqual({ authed: true });
  });
});

describe('claude-code adapter spawn args', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses Claude Code stream-json mode and --resume for paused sessions', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = spawnContext('claude-session-123');
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    // The prompt is deliberately absent from argv and delivered over stdin
    // instead — cmd.exe truncates a multi-line argument, which silently cost
    // the agent its `Task:` line on Windows. See claudeCodeStdinPrompt.test.ts.
    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--resume',
      'claude-session-123',
    ]);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });

  // Regression: wrapPrompt used to say "save a report to ./outputs/" with no
  // qualification — a direct, unconditional instruction that always beat
  // dex-canvas, since the agent never had a reason to open its skill doc
  // when this line already told it exactly what to do. A report asked for
  // in chat was never once rendered as a canvas; it was always a file.
  it('names dex-canvas/dex-find/dex-registry directly rather than only pointing at AGENTS.md, and no longer tells the agent to always save a report as a file', async () => {
    const adapter = await claudeCodeAdapter();
    const wrappedPrompt = adapter.wrapPrompt(spawnContext());

    expect(wrappedPrompt).toMatch(/dex-canvas show/);
    expect(wrappedPrompt).toMatch(/dex-find/);
    expect(wrappedPrompt).toMatch(/dex-registry/);
    expect(wrappedPrompt).not.toMatch(/When the user asks you to produce a file \(a report,/);
  });
});

describe('claude-code adapter streaming text', () => {
  it('keeps whitespace-only deltas so words and table rows stay apart', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = { iter: 0, pendingTools: new Map(), harnessHelpersPath: '', harnessToolsPath: '', harnessSkillPath: '' };
    const delta = (text: string) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
    const text = ['(114', ' ', 'users)', '\n', '| a |', '']
      .flatMap((d) => adapter.parseLine(delta(d), ctx as never).events)
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(text).toBe('(114 users)\n| a |');
  });
});

describe('claude-code adapter subagents (the Task tool)', () => {
  function freshCtx() {
    return { iter: 0, pendingTools: new Map(), harnessHelpersPath: '', harnessToolsPath: '', harnessSkillPath: '', subagents: new Map() };
  }

  it('turns a Task tool_use into a subagent_start instead of an ordinary tool_call', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    const line = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { description: 'Pdf selection review', prompt: 'Review selection handling', subagent_type: 'general-purpose' } },
        ],
      },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events).toEqual([
      { type: 'subagent_start', id: 'toolu_1', name: 'Pdf selection review', subagentType: 'general-purpose', prompt: 'Review selection handling' },
    ]);
    expect(ctx.subagents.has('toolu_1')).toBe(true);
  });

  it('knows the subagent tool by its newer name, Agent, too', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    const line = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_9', name: 'Agent', input: { description: 'Docs sweep', prompt: 'Find the API', subagent_type: 'Explore' } }] },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events).toEqual([{ type: 'subagent_start', id: 'toolu_9', name: 'Docs sweep', subagentType: 'Explore', prompt: 'Find the API' }]);
  });

  it('launching several subagents in one turn emits one subagent_start per Task call', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    const line = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_a', name: 'Task', input: { description: 'Xlsx ui review', prompt: 'p1' } },
          { type: 'tool_use', id: 'toolu_b', name: 'Task', input: { description: 'Glass contrast review', prompt: 'p2' } },
        ],
      },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events.map((e) => (e as { id: string }).id)).toEqual(['toolu_a', 'toolu_b']);
    expect(events.every((e) => e.type === 'subagent_start')).toBe(true);
  });

  it('routes a nested assistant message (parent_tool_use_id set) to subagent_step, not tool_call', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    ctx.subagents.set('toolu_1', { name: 'Pdf selection review' });
    const line = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'tool_use', id: 'toolu_inner', name: 'Read', input: { file_path: 'pointerInput.kt' } }] },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events).toEqual([
      { type: 'subagent_step', id: 'toolu_1', kind: 'tool_call', name: 'Read', preview: 'pointerInput.kt' },
    ]);
  });

  it('does not bump the top-level iteration counter for a subagent-nested turn', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    ctx.subagents.set('toolu_1', { name: 'Pdf selection review' });
    const line = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'tool_use', id: 'toolu_inner', name: 'Read', input: { file_path: 'x.kt' } }] },
    });
    adapter.parseLine(line, ctx as never);
    expect(ctx.iter).toBe(0);
  });

  it('a nested tool_result becomes a subagent_step, paired with its tool name', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    ctx.subagents.set('toolu_1', { name: 'Pdf selection review' });
    ctx.pendingTools.set('toolu_inner', { name: 'Read', startedAt: Date.now(), iter: 0 });
    const line = JSON.stringify({
      type: 'user',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_inner', content: 'file contents', is_error: false }] },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events).toEqual([
      { type: 'subagent_step', id: 'toolu_1', kind: 'tool_result', name: 'Read', ok: true, preview: 'file contents', ms: expect.any(Number) },
    ]);
  });

  it("the Task call's own top-level tool_result becomes subagent_done, and clears the tracked subagent", async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    ctx.subagents.set('toolu_1', { name: 'Pdf selection review' });
    const line = JSON.stringify({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Reviewed the selection handling; filed two fixes.', is_error: false }] },
    });
    const { events } = adapter.parseLine(line, ctx as never);
    expect(events).toEqual([
      { type: 'subagent_done', id: 'toolu_1', ok: true, summary: 'Reviewed the selection handling; filed two fixes.' },
    ]);
    expect(ctx.subagents.has('toolu_1')).toBe(false);
  });

  it('an ordinary top-level tool_use/tool_result still works unchanged alongside subagents', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = freshCtx();
    const call = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_top', name: 'Bash', input: { command: 'ls' } }] },
    });
    const callEvents = adapter.parseLine(call, ctx as never).events;
    expect(callEvents).toEqual([{ type: 'tool_call', name: 'Bash', args: { preview: 'ls', command: 'ls' }, iteration: 1 }]);
    const result = JSON.stringify({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_top', content: 'a.txt', is_error: false }] },
    });
    const resultEvents = adapter.parseLine(result, ctx as never).events;
    expect(resultEvents).toEqual([{ type: 'tool_result', name: 'Bash', ok: true, preview: 'a.txt', ms: expect.any(Number) }]);
  });
});
