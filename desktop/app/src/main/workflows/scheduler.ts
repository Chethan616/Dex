/**
 * Starts scheduled workflows when they're due (shared/workflows.ts `isDue`):
 * a look every 30 seconds, so a 7:30 routine starts by 7:30:30. A run that
 * was missed while the PC slept still starts within CATCH_UP_MS; one missed
 * by more waits for its next time instead of surprising the user at noon.
 *
 * The run is recorded before the task starts, so a slow start (or a crash
 * during it) can never start the same run twice.
 */
import { isDue, type Workflow } from '../../shared/workflows';
import type { WorkflowStore } from './store';

export const TICK_MS = 30_000;

export interface SchedulerDeps {
  store: WorkflowStore;
  /** Start a task running this workflow; resolves to its session id. */
  startRun: (workflow: Workflow, by: 'schedule' | 'user') => Promise<string | null>;
  log?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
}

/** One pass: start every workflow that's due now. Returns the ids started. */
export async function runDue(deps: SchedulerDeps): Promise<string[]> {
  const now = (deps.now ?? Date.now)();
  const started: string[] = [];
  for (const w of deps.store.list()) {
    if (!isDue(w, now)) continue;
    deps.store.recordRun(w.id, { at: now, by: 'schedule' });
    try {
      const sessionId = await deps.startRun(w, 'schedule');
      if (sessionId) deps.store.recordRun(w.id, { at: now, by: 'schedule', sessionId });
      started.push(w.id);
      deps.log?.('workflows.scheduled.started', { id: w.id, sessionId });
    } catch (err) {
      deps.log?.('workflows.scheduled.failed', { id: w.id, error: (err as Error).message });
    }
  }
  return started;
}

export function startWorkflowScheduler(deps: SchedulerDeps): () => void {
  let busy = false;
  const tick = (): void => {
    if (busy) return;
    busy = true;
    void runDue(deps).finally(() => { busy = false; });
  };
  const timer = setInterval(tick, TICK_MS);
  // Right away too: DEX starting at 7:45 catches the 7:30 routine now, not in 30 s.
  setTimeout(tick, 5_000);
  return () => clearInterval(timer);
}
