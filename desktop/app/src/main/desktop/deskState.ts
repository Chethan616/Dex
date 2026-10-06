/**
 * The hold on a task's hands (docs/desktop-control/PLAN.md §4.1.6).
 *
 * Windows can't suspend an engine process, so Pause there is cooperative:
 * the task is held, and every action the agent takes on the user's things —
 * its browser commands through the CDP broker, its Windows tools through
 * the desktop gate — waits until Resume. Its thinking may carry on; nothing
 * it does lands until the user lets it.
 */
const holds = new Map<string, string>();

export function hold(sessionId: string, reason = 'paused'): void {
  holds.set(sessionId, reason);
}

export function release(sessionId: string): boolean {
  return holds.delete(sessionId);
}

export function isHeld(sessionId: string): boolean {
  return holds.has(sessionId);
}

export function holdReason(sessionId: string): string | null {
  return holds.get(sessionId) ?? null;
}

/** Wait while the task is held — checking every `stepMs`, for at most `maxMs`. */
export async function waitWhileHeld(sessionId: string, opts: { stepMs?: number; maxMs?: number } = {}): Promise<boolean> {
  const step = opts.stepMs ?? 500;
  const deadline = Date.now() + (opts.maxMs ?? 6 * 60 * 60_000);
  while (holds.has(sessionId) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, step));
  }
  return !holds.has(sessionId);
}
