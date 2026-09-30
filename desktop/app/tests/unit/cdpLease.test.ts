import { describe, expect, it, vi } from 'vitest';
import { leaseDebugger, withDebugger, type DebuggableContents } from '../../src/main/cdpLease';

function fakeContents(initiallyAttached = false) {
  let attached = initiallyAttached;
  const dbg = {
    attach: vi.fn(() => {
      if (attached) throw new Error('Debugger is already attached');
      attached = true;
    }),
    detach: vi.fn(() => { attached = false; }),
    isAttached: () => attached,
  };
  const wc: DebuggableContents = { isDestroyed: () => false, debugger: dbg };
  return { wc, dbg, drop: () => { attached = false; } };
}

describe('leaseDebugger', () => {
  it('attaches once and detaches only when the last lease is released', () => {
    const { wc, dbg } = fakeContents();
    const a = leaseDebugger(wc);
    const b = leaseDebugger(wc);
    expect(dbg.attach).toHaveBeenCalledTimes(1);
    a();
    a(); // releasing twice is harmless
    expect(dbg.isAttached()).toBe(true);
    b();
    expect(dbg.isAttached()).toBe(false);
  });

  it('never detaches a debugger it did not attach', () => {
    const { wc, dbg } = fakeContents(true);
    leaseDebugger(wc)();
    expect(dbg.detach).not.toHaveBeenCalled();
  });

  it('re-attaches when the page dropped the debugger under a live lease', () => {
    const { wc, dbg, drop } = fakeContents();
    const held = leaseDebugger(wc);
    drop();
    const again = leaseDebugger(wc);
    expect(dbg.attach).toHaveBeenCalledTimes(2);
    again();
    held();
    expect(dbg.isAttached()).toBe(false);
  });

  it('withDebugger releases even when the work throws', async () => {
    const { wc, dbg } = fakeContents();
    await expect(withDebugger(wc, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(dbg.isAttached()).toBe(false);
  });
});
