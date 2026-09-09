import { describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

vi.mock('../../../src/main/hl/engines/pathEnrich', () => ({
  enrichedEnv: vi.fn((env?: NodeJS.ProcessEnv) => env ?? process.env),
}));

// The adapter self-registers rather than exporting an instance; same access
// pattern as claudeCodeAdapter.test.ts.
async function claudeCodeAdapter(): Promise<EngineAdapter> {
  const { get } = await import('../../../src/main/hl/engines/registry');
  await import('../../../src/main/hl/engines/claude-code/adapter');
  const adapter = get('claude-code');
  if (!adapter) throw new Error('claude-code adapter not registered');
  return adapter;
}

/**
 * The claude-code adapter used to pass the wrapped prompt as an argv element.
 * On Windows `claude` is a `.cmd` npm shim routed through `cmd.exe /d /s /c`,
 * and cmd.exe stops parsing an argument at a raw newline inside quotes — so a
 * multi-line prompt was truncated in transit.
 *
 * Observed live: the agent received the leading browser instructions, connected
 * to its CDP target correctly, then answered "there's no task in your message
 * yet" — because `Task: ...` is the last line of wrapPrompt and had genuinely
 * been cut off. The codex and browsercode adapters already avoided this by
 * feeding the prompt through stdin; claude-code was the last one on argv.
 */
function ctx(prompt: string, overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    prompt,
    harnessDir: '/tmp/harness',
    sessionId: 'session-123',
    targetId: 'target-abc',
    cdpPort: 9222,
    attachmentRefs: [],
    ...overrides,
  } as SpawnContext;
}

describe('claude-code prompt delivery', () => {
  it('wraps the task into a multi-line prompt ending with the task itself', async () => {
    const adapter = await claudeCodeAdapter();
    const wrapped = adapter.wrapPrompt(ctx('open google and search for open ai'));

    expect(wrapped).toContain('\n');
    expect(wrapped.trimEnd().endsWith('Task: open google and search for open ai')).toBe(true);
  });

  it('sends the prompt via stdin, not argv', async () => {
    const adapter = await claudeCodeAdapter();
    const wrapped = adapter.wrapPrompt(ctx('open google and search for open ai'));

    expect(adapter.getStdinPayload?.(ctx('x'), wrapped)).toBe(wrapped);
  });

  it('keeps the prompt out of argv entirely, so cmd.exe cannot truncate it', async () => {
    const adapter = await claudeCodeAdapter();
    const wrapped = adapter.wrapPrompt(ctx('open google and search for open ai'));
    const args = adapter.buildSpawnArgs(ctx('open google and search for open ai'), wrapped);

    expect(args).not.toContain(wrapped);
    // Nothing carrying a newline may reach argv — that is the exact shape
    // cmd.exe mangles.
    expect(args.some((a) => a.includes('\n'))).toBe(false);
    // And no fragment of the task should leak in either.
    expect(args.some((a) => a.includes('open google'))).toBe(false);
  });

  it('still asks the CLI for stream-json headless output', async () => {
    const adapter = await claudeCodeAdapter();
    const args = adapter.buildSpawnArgs(ctx('t'), 'wrapped');

    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
  });

  it('still passes --resume through when resuming a session', async () => {
    const adapter = await claudeCodeAdapter();
    const args = adapter.buildSpawnArgs(ctx('t', { resumeSessionId: 'sess-9' }), 'wrapped');

    expect(args).toContain('--resume');
    expect(args).toContain('sess-9');
  });
});
