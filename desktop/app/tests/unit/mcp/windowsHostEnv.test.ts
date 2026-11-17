// @vitest-environment node
/**
 * The Windows server runs as dex.exe with ELECTRON_RUN_AS_NODE=1. Apps the
 * PowerShell host launches inherit its environment, and an Electron app that
 * sees that variable starts as bare Node with no window, so the host must
 * never get it.
 */
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { Host } from '../../../mcp-servers/windows/host.mjs';

// A stand-in host: says ready, then answers each request with what it sees in its env.
const FAKE_HOST = `
const rl = require('readline').createInterface({ input: process.stdin });
console.log(JSON.stringify({ event: 'ready' }));
rl.on('line', (l) => {
  const { id } = JSON.parse(l);
  console.log(JSON.stringify({ id, ok: true, runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, extra: process.env.DEX_TEST_EXTRA ?? null }));
});
`;

describe('Windows host environment', () => {
  let host: { call: (op: string) => Promise<Record<string, unknown>>; stop: () => void } | null = null;
  const saved = process.env.ELECTRON_RUN_AS_NODE;
  afterEach(() => {
    host?.stop();
    if (saved === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = saved;
  });

  it('does not pass ELECTRON_RUN_AS_NODE on to the host or the apps it launches', async () => {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    host = new Host({ command: process.execPath, args: ['-e', FAKE_HOST], env: { ELECTRON_RUN_AS_NODE: '1', DEX_TEST_EXTRA: 'kept' } });
    const res = await host!.call('ping');
    expect(res.runAsNode).toBeNull();
    expect(res.extra).toBe('kept');
  });
});
