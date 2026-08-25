/**
 * Cooperative cancellation. The Orchestrator checks this before dispatching each
 * step, so a cancelled task stops at the next step boundary rather than hanging.
 * A task always reaches a terminal state — never stuck.
 */
export class CancellationRegistry {
  private cancelled = new Set<string>();

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
  }

  isCancelled(requestId: string): boolean {
    return this.cancelled.has(requestId);
  }

  /** Called when a task reaches a terminal state, so the set does not grow forever. */
  clear(requestId: string): void {
    this.cancelled.delete(requestId);
  }
}
