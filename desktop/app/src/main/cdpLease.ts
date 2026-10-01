/**
 * One shared, reference-counted attachment of a WebContents' debugger.
 *
 * Several parts of main talk CDP to the same page through
 * `webContents.debugger`: the agent's broker (long-lived), the idle freeze,
 * the target-id lookup and dex-fill (a few milliseconds each). Electron gives
 * each WebContents exactly one debugger object, and its `detach()` ends the
 * attachment for everyone — so a short user that attached and then detached
 * would silently cut the broker off mid-task. Leasing instead of attaching
 * directly means the debugger stays attached while anyone holds a lease, and
 * is detached only by the last one out (and only if a lease attached it).
 */

/** The slice of Electron's WebContents a lease needs; tests pass a fake. */
export interface DebuggableContents {
  isDestroyed(): boolean;
  readonly debugger: {
    attach(protocolVersion?: string): void;
    detach(): void;
    isAttached(): boolean;
  };
}

const CDP_PROTOCOL_VERSION = '1.3';

interface LeaseState {
  count: number;
  /** A lease attached it, so the last lease detaches it. */
  owned: boolean;
}

const leases = new WeakMap<DebuggableContents, LeaseState>();

/** Attach (if needed) and hold the debugger until the returned release runs. */
export function leaseDebugger(wc: DebuggableContents): () => void {
  const dbg = wc.debugger;
  let state = leases.get(wc);
  if (!state) {
    state = { count: 0, owned: false };
    leases.set(wc, state);
  }
  // Also re-attaches when the page dropped the debugger under a live lease
  // (a renderer crash detaches it for everyone).
  if (!dbg.isAttached()) {
    dbg.attach(CDP_PROTOCOL_VERSION);
    state.owned = true;
  }
  state.count += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = leases.get(wc);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    leases.delete(wc);
    if (!current.owned || wc.isDestroyed()) return;
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      /* navigated away or already gone */
    }
  };
}

/** Run `fn` with the debugger attached, releasing afterwards. */
export async function withDebugger<T>(wc: DebuggableContents, fn: () => Promise<T>): Promise<T> {
  const release = leaseDebugger(wc);
  try {
    return await fn();
  } finally {
    release();
  }
}
