import { describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

vi.mock('../../../src/main/hl/engines/pathEnrich', () => ({
  enrichedEnv: vi.fn((env?: NodeJS.ProcessEnv) => env ?? process.env),
}));

async function adapterFor(id: string): Promise<EngineAdapter> {
  const { get } = await import('../../../src/main/hl/engines/registry');
  if (id === 'claude-code') await import('../../../src/main/hl/engines/claude-code/adapter');
  if (id === 'codex') await import('../../../src/main/hl/engines/codex/adapter');
  const adapter = get(id);
  if (!adapter) throw new Error(`${id} adapter not registered`);
  return adapter;
}

function ctx(overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    prompt: 'do a thing',
    harnessDir: '/tmp/harness',
    sessionId: 'session-1',
    targetId: 'target-1',
    cdpPort: 9222,
    attachmentRefs: [],
    ...overrides,
  } as SpawnContext;
}

/**
 * Model choice has to survive all the way to the CLI flag, and — just as
 * importantly — must vanish entirely when the user picks "Default", so we
 * never pin a model the engine has moved on from.
 */
describe('model selection reaches the CLI', () => {
  it('claude-code passes --model when one is chosen', async () => {
    const adapter = await adapterFor('claude-code');
    const args = adapter.buildSpawnArgs(ctx({ model: 'opus' }), 'wrapped');

    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
  });

  it('claude-code omits --model entirely for the engine default', async () => {
    const adapter = await adapterFor('claude-code');

    expect(adapter.buildSpawnArgs(ctx(), 'wrapped')).not.toContain('--model');
  });

  it('codex passes --model when one is chosen', async () => {
    const adapter = await adapterFor('codex');
    const args = adapter.buildSpawnArgs(ctx({ model: 'gpt-5.6-sol' }), 'wrapped');

    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-sol');
  });

  it('codex omits --model entirely for the engine default', async () => {
    const adapter = await adapterFor('codex');

    expect(adapter.buildSpawnArgs(ctx(), 'wrapped')).not.toContain('--model');
  });

  it('codex keeps the prompt on stdin and the resume id last when resuming with a model', async () => {
    const adapter = await adapterFor('codex');
    const args = adapter.buildSpawnArgs(ctx({ model: 'gpt-5.6-sol', resumeSessionId: 'sess-7' }), 'wrapped');

    // `-` must stay final: it is what tells codex to read the prompt from
    // stdin, and the resume id has to precede it.
    expect(args[args.length - 1]).toBe('-');
    expect(args[args.length - 2]).toBe('sess-7');
    expect(args).toContain('gpt-5.6-sol');
  });

  it('both engines advertise models for the picker to offer', async () => {
    const claude = await adapterFor('claude-code');
    const codex = await adapterFor('codex');

    expect(claude.selectableModels?.length ?? 0).toBeGreaterThan(0);
    expect(codex.selectableModels?.length ?? 0).toBeGreaterThan(0);
    // Ids must be non-empty: '' is the sentinel the picker uses for "default",
    // so a model literally called '' would be indistinguishable from it.
    for (const m of [...(claude.selectableModels ?? []), ...(codex.selectableModels ?? [])]) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
  });
});
