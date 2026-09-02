/**
 * Cooperative cancellation. The Orchestrator checks this before dispatching each
 * step, so a cancelled task stops at the next step boundary rather than hanging.
 * A task always reaches a terminal state — never stuck.
 *
 * Step boundaries alone were not enough, and the gap was expensive rather than
 * merely slow. The single longest-running thing in a task is the planning call,
 * and Stop did not touch it: pressing Stop while the Brain was thinking left the
 * model generating a plan for a task that no longer existed, and the owner paid
 * for every token of it. With Claude Code as the provider that is a CLI process
 * that keeps running, on their own subscription, producing a plan nothing will
 * read.
 *
 * So the registry also holds an AbortSignal per request. Cancelling fires it,
 * and the providers pass it to `fetch`, to the Anthropic SDK, and to the child
 * process they kill. Stop now stops the part that costs money first.
 */
export class CancellationRegistry {
  private cancelled = new Set<string>();
  private controllers = new Map<string, AbortController>();

  /**
   * The signal for this request, created on first use.
   *
   * Already-aborted if `cancel` arrived before anything asked for it — a Stop
   * that lands in the gap between accepting a request and starting the model
   * call must not be forgotten.
   */
  signal(requestId: string): AbortSignal {
    let controller = this.controllers.get(requestId);
    if (!controller) {
      controller = new AbortController();
      this.controllers.set(requestId, controller);
      if (this.cancelled.has(requestId)) controller.abort();
    }
    return controller.signal;
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
    this.controllers.get(requestId)?.abort();
  }

  isCancelled(requestId: string): boolean {
    return this.cancelled.has(requestId);
  }

  /** Called when a task reaches a terminal state, so the set does not grow forever. */
  clear(requestId: string): void {
    this.cancelled.delete(requestId);
    this.controllers.delete(requestId);
  }
}
