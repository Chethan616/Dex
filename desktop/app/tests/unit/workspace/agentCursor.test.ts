import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveCursor, setCursorVisible } from '../../../src/main/workspace/agentCursor';

function fakeTab() {
  const calls: Array<{ world: number; code: string }> = [];
  return {
    calls,
    wc: {
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: vi.fn(async (world: number, scripts: Array<{ code: string }>) => {
        calls.push({ world, code: scripts[0].code });
        return 120;
      }),
    },
  };
}

describe('agentCursor', () => {
  afterEach(() => { delete process.env.DEX_AGENT_CURSOR; });

  it('moves the cursor in its own isolated world, inside a closed shadow root that takes no clicks', async () => {
    const { wc, calls } = fakeTab();
    await moveCursor(wc, 312.4, 208.6, true);
    expect(calls).toHaveLength(1);
    expect(calls[0].world).toBeGreaterThan(1000);
    expect(calls[0].code).toContain("attachShadow({ mode: 'closed' })");
    expect(calls[0].code).toContain('pointer-events: none');
    expect(calls[0].code).toContain('translate(312px,209px)');
    expect(calls[0].code).toContain('ring');
  });

  it('hides and shows the cursor (around the agent’s screenshots)', async () => {
    const { wc, calls } = fakeTab();
    await setCursorVisible(wc, false);
    await setCursorVisible(wc, true);
    expect(calls[0].code).toContain("'hidden'");
    expect(calls[1].code).not.toContain("'hidden'");
  });

  it('can be turned off, and never throws on a page that is going away', async () => {
    const { wc, calls } = fakeTab();
    process.env.DEX_AGENT_CURSOR = '0';
    await moveCursor(wc, 1, 1);
    expect(calls).toHaveLength(0);
    delete process.env.DEX_AGENT_CURSOR;

    wc.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('navigated'));
    await expect(moveCursor(wc, 5, 5)).resolves.toBeUndefined();
    await expect(moveCursor(wc, Number.NaN, 5)).resolves.toBeUndefined();
  });
});
