import { ExecutionPlan, TaskStatus } from '../events/types';
import { shapeOf } from '../workflows/shape';
import { db } from './db';

/**
 * What Dex has actually been asked to do.
 *
 * Two purposes, and the second is the interesting one:
 *
 *   1. Answering "what do I use this for" — a searchable history, and a weekly
 *      shape of it. Useful on its own.
 *   2. Noticing repetition. When the same *shape* of request comes round for
 *      the third time, that is a task worth saving as a workflow, and Dex can
 *      offer rather than waiting to be told.
 *
 * Local only. This never leaves the machine and there is nowhere for it to go.
 */

export interface TaskRecord {
  requestId: string;
  text: string;
  intent?: string;
  status?: TaskStatus;
  stepCount: number;
  durationMs?: number;
  workflow?: string;
  startedAt: number;
}

export interface UsageSummary {
  since: number;
  totalTasks: number;
  completed: number;
  failed: number;
  cancelled: number;
  brainCalls: number;
  workflowRuns: number;
  byDay: Array<{ day: string; tasks: number }>;
  topActions: Array<{ action: string; capability: string; runs: number; failures: number }>;
  byTier: Array<{ capability: string; runs: number }>;
  repeated: Array<{ shape: string; example: string; times: number; saved: boolean }>;
}

export class Telemetry {
  /** Repeats below this are coincidence; at this many it is a habit. */
  static readonly SUGGEST_AFTER = 3;

  startTask(input: {
    requestId: string;
    sessionId: string;
    source: string;
    text: string;
    provider?: string;
    workflow?: string;
  }): void {
    const { shape } = shapeOf(input.text);
    db()
      .prepare(
        `INSERT OR REPLACE INTO tasks
         (request_id, session_id, source, text, shape, provider, workflow, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.requestId,
        input.sessionId,
        input.source,
        input.text,
        shape,
        input.provider ?? null,
        input.workflow ?? null,
        Date.now(),
      );
  }

  planned(requestId: string, plan: ExecutionPlan): void {
    db()
      .prepare('UPDATE tasks SET intent = ?, step_count = ? WHERE request_id = ?')
      .run(plan.intent, plan.steps.length, requestId);
  }

  step(input: {
    requestId: string;
    stepId: string;
    capability: string;
    action: string;
    tier: number;
    status: string;
    verification?: string;
    escalatedTo?: string;
  }): void {
    db()
      .prepare(
        `INSERT OR REPLACE INTO steps
         (request_id, step_id, capability, action, tier, status, verification, escalated_to, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.requestId,
        input.stepId,
        input.capability,
        input.action,
        input.tier,
        input.status,
        input.verification ?? null,
        input.escalatedTo ?? null,
        Date.now(),
      );
  }

  finishTask(requestId: string, status: TaskStatus): void {
    db()
      .prepare(
        `UPDATE tasks
         SET status = ?, finished_at = ?, duration_ms = ? - started_at
         WHERE request_id = ?`,
      )
      .run(status, Date.now(), Date.now(), requestId);
  }

  /**
   * What the owner thought of a task.
   *
   * The only signal here that Dex did not generate itself. Verification says
   * whether a step did what it claimed; this says whether the whole thing was
   * what the owner wanted, and those are different questions — a task can
   * verify every step and still answer the wrong one.
   *
   * Recorded against the request, so it survives into the history and can rank
   * a saved workflow later.
   */
  recordFeedback(requestId: string, verdict: 1 | -1 | null): void {
    db()
      .prepare('UPDATE tasks SET feedback = ? WHERE request_id = ?')
      .run(verdict, requestId);
  }

  /** How many times this shape of request has succeeded before. */
  timesRepeated(text: string): number {
    const { shape } = shapeOf(text);
    const row = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE shape = ? AND status = 'COMPLETED' AND workflow IS NULL`,
      )
      .get(shape) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  recent(limit = 20): TaskRecord[] {
    return (db()
      .prepare(
        `SELECT request_id, text, intent, status, step_count, duration_ms, workflow, started_at
         FROM tasks ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>).map((r) => ({
      requestId: String(r.request_id),
      text: String(r.text),
      intent: r.intent ? String(r.intent) : undefined,
      status: r.status ? (String(r.status) as TaskStatus) : undefined,
      stepCount: Number(r.step_count ?? 0),
      durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
      workflow: r.workflow ? String(r.workflow) : undefined,
      startedAt: Number(r.started_at),
    }));
  }

  search(term: string, limit = 20): TaskRecord[] {
    return (db()
      .prepare(
        `SELECT request_id, text, intent, status, step_count, duration_ms, workflow, started_at
         FROM tasks WHERE text LIKE ? OR intent LIKE ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(`%${term}%`, `%${term}%`, limit) as Array<Record<string, unknown>>).map((r) => ({
      requestId: String(r.request_id),
      text: String(r.text),
      intent: r.intent ? String(r.intent) : undefined,
      status: r.status ? (String(r.status) as TaskStatus) : undefined,
      stepCount: Number(r.step_count ?? 0),
      durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
      workflow: r.workflow ? String(r.workflow) : undefined,
      startedAt: Number(r.started_at),
    }));
  }

  summary(days = 7): UsageSummary {
    const since = Date.now() - days * 86_400_000;
    const one = (sql: string, ...args: unknown[]) =>
      Number((db().prepare(sql).get(...args) as { n?: number } | undefined)?.n ?? 0);

    const repeated = (db()
      .prepare(
        `SELECT t.shape AS shape, MAX(t.text) AS example, COUNT(*) AS n,
                (SELECT COUNT(*) FROM workflows w WHERE w.shape = t.shape) AS saved
         FROM tasks t
         WHERE t.started_at >= ? AND t.status = 'COMPLETED' AND t.workflow IS NULL
         GROUP BY t.shape HAVING n >= 2
         ORDER BY n DESC LIMIT 10`,
      )
      .all(since) as Array<Record<string, unknown>>).map((r) => ({
      shape: String(r.shape),
      example: String(r.example),
      times: Number(r.n),
      saved: Number(r.saved) > 0,
    }));

    return {
      since,
      totalTasks: one('SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ?', since),
      completed: one("SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ? AND status = 'COMPLETED'", since),
      failed: one("SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ? AND status = 'FAILED'", since),
      cancelled: one("SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ? AND status = 'CANCELLED'", since),
      // A task run from a saved workflow costs no planning call. The gap
      // between these two numbers is what the workflows have saved.
      brainCalls: one('SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ? AND workflow IS NULL', since),
      workflowRuns: one('SELECT COUNT(*) AS n FROM tasks WHERE started_at >= ? AND workflow IS NOT NULL', since),
      byDay: (db()
        .prepare(
          `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
           FROM tasks WHERE started_at >= ? GROUP BY day ORDER BY day`,
        )
        .all(since) as Array<Record<string, unknown>>).map((r) => ({
        day: String(r.day),
        tasks: Number(r.n),
      })),
      topActions: (db()
        .prepare(
          `SELECT action, capability, COUNT(*) AS runs,
                  SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failures
           FROM steps WHERE ts >= ?
           GROUP BY action, capability ORDER BY runs DESC LIMIT 10`,
        )
        .all(since) as Array<Record<string, unknown>>).map((r) => ({
        action: String(r.action),
        capability: String(r.capability),
        runs: Number(r.runs),
        failures: Number(r.failures ?? 0),
      })),
      byTier: (db()
        .prepare(
          `SELECT capability, COUNT(*) AS n FROM steps WHERE ts >= ?
           GROUP BY capability ORDER BY n DESC`,
        )
        .all(since) as Array<Record<string, unknown>>).map((r) => ({
        capability: String(r.capability),
        runs: Number(r.n),
      })),
      repeated,
    };
  }
}
