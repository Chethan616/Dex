import { describe, expect, it } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const { get } = await import('../../../src/main/hl/engines/registry');
await import('../../../src/main/hl/engines/codex/adapter');

function codexAdapter(): EngineAdapter {
  const adapter = get('codex');
  if (!adapter) throw new Error('codex adapter not registered');
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

describe('codex adapter spawn args', () => {
  it('uses stdin and the documented noninteractive bypass flag for new sessions', () => {
    const adapter = codexAdapter();
    const ctx = spawnContext();
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ]);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });

  it('puts resume options before the session id for current Codex CLI parsing', () => {
    const adapter = codexAdapter();
    const ctx = spawnContext('thread-123');
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      'thread-123',
      '-',
    ]);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });

  // Regression: wrapPrompt used to say "save a report to ./outputs/" with no
  // qualification — a direct, unconditional instruction that always beat
  // dex-canvas, since the agent never had a reason to open its skill doc
  // when this line already told it exactly what to do.
  it('names dex-canvas/dex-find/dex-registry directly rather than only pointing at AGENTS.md, and no longer tells the agent to always save a report as a file', () => {
    const adapter = codexAdapter();
    const wrappedPrompt = adapter.wrapPrompt(spawnContext());

    expect(wrappedPrompt).toMatch(/dex-canvas show/);
    expect(wrappedPrompt).toMatch(/dex-find/);
    expect(wrappedPrompt).toMatch(/dex-registry/);
    expect(wrappedPrompt).not.toMatch(/When the user asks you to produce a file \(a report,/);
  });
});
