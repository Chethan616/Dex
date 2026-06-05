/**
 * Telemetry — Phase C.4.
 *
 * Every engine attempt the router runs flows through a `TelemetryStore`.
 * The store records one row per attempt; the self-learner reads it back
 * later to compute the Beta-prior history snapshot the scorer consumes.
 *
 * This file defines the store contract + an in-memory implementation.
 * A SQLite-backed implementation can be layered on top of `TelemetryStore`
 * without changing the rest of the orchestrator (see `kysely-node-sqlite.ts`
 * in core/src/infra for the pattern OpenClaw uses elsewhere). Keeping the
 * production store choice behind an interface means tests + CI never need
 * to touch disk.
 *
 * Schema (matches the SQL design in the orchestration README):
 *
 *   CREATE TABLE engine_runs (
 *     id           INTEGER PRIMARY KEY AUTOINCREMENT,
 *     ts           INTEGER NOT NULL,          -- ms since epoch
 *     engine_id    TEXT    NOT NULL,
 *     process_name TEXT    NOT NULL,
 *     app_family   TEXT    NOT NULL,
 *     task_kind    TEXT    NOT NULL,
 *     task_hint    TEXT,
 *     latency_ms   INTEGER NOT NULL,
 *     outcome      TEXT    NOT NULL,          -- success|failed|recovered|aborted
 *     fallback_used INTEGER NOT NULL DEFAULT 0,
 *     error_class  TEXT
 *   );
 *   CREATE INDEX engine_runs_lookup ON engine_runs (process_name, engine_id);
 */

import type {
  AppFamily,
  EngineId,
  ExecResult,
  TaskKind,
} from "./types.js";

export type EngineRunOutcome = "success" | "failed" | "recovered" | "aborted";

/** One row written by the router after each engine attempt. */
export interface EngineRunRecord {
  /** Local clock at write time, ms since epoch. */
  ts: number;
  engineId: EngineId;
  processName: string;
  appFamily: AppFamily;
  taskKind: TaskKind;
  /** First hint token from the user prompt; used to disambiguate task class. */
  taskHint?: string;
  latencyMs: number;
  outcome: EngineRunOutcome;
  /** True when this run was a fallback (chain index > 0). */
  fallbackUsed: boolean;
  /** Engine error.kind when outcome !== "success". */
  errorClass?: string;
}

/** Aggregate of one (process, engine) bucket, returned by the store. */
export interface EngineRunStats {
  /** Total runs in the bucket. */
  runs: number;
  /** Runs with outcome === "success". */
  successes: number;
  /** Rolling mean of latencyMs across all runs. */
  avgLatencyMs: number;
}

/** Backing store contract. */
export interface TelemetryStore {
  /** Append one engine-run record. Sync to keep the router hot path predictable. */
  record(row: EngineRunRecord): void;

  /**
   * Aggregate stats for every (process_name, engine_id) tuple in the
   * given process. Used by the self-learner to refresh the scanner's
   * `history` probe.
   */
  statsByEngine(processName: string): Record<EngineId, EngineRunStats>;

  /** Total row count (for diagnostics / `dex doctor`). */
  rowCount(): number;

  /** Last N rows in insertion order (for `dex logs` style debugging). */
  recent(limit?: number): EngineRunRecord[];

  /** Clear the store. Mostly useful in tests. */
  clear(): void;
}

/**
 * In-memory `TelemetryStore`. Fast, deterministic, no I/O.
 *
 * Used in tests and as the fallback when:
 *   - DEX_TELEMETRY_DISABLED=1 is set
 *   - the SQLite backing fails to open at startup
 *   - the gateway is running in a sandboxed / read-only filesystem
 *
 * Production callers wire a sqlite-backed store via `wireTelemetryStore()`
 * (see `./self-learning.ts`) so persistence survives process restarts.
 */
export class MemoryTelemetryStore implements TelemetryStore {
  private rows: EngineRunRecord[] = [];

  record(row: EngineRunRecord): void {
    this.rows.push(row);
  }

  rowCount(): number {
    return this.rows.length;
  }

  recent(limit = 50): EngineRunRecord[] {
    if (limit <= 0) return [];
    if (limit >= this.rows.length) return [...this.rows];
    return this.rows.slice(-limit);
  }

  statsByEngine(processName: string): Record<EngineId, EngineRunStats> {
    const out: Record<EngineId, EngineRunStats> = {};
    for (const row of this.rows) {
      if (row.processName !== processName) continue;
      const key = row.engineId;
      const cur = out[key];
      if (!cur) {
        out[key] = {
          runs: 1,
          successes: row.outcome === "success" ? 1 : 0,
          avgLatencyMs: row.latencyMs,
        };
        continue;
      }
      // Running mean: avg_n+1 = avg_n + (x - avg_n) / (n + 1)
      const newRuns = cur.runs + 1;
      cur.runs = newRuns;
      cur.successes += row.outcome === "success" ? 1 : 0;
      cur.avgLatencyMs = cur.avgLatencyMs + (row.latencyMs - cur.avgLatencyMs) / newRuns;
    }
    return out;
  }

  clear(): void {
    this.rows = [];
  }
}

/**
 * Classify an ExecResult into one of the four telemetry outcomes.
 * `recovered` is distinct from `success` so the learner can spot engines
 * that often need a retry — those get a slightly lower prior than engines
 * that succeed on the first try.
 */
export function outcomeFromExecResult(
  result: ExecResult,
  recovered: boolean,
): EngineRunOutcome {
  if (result.ok) {
    return recovered ? "recovered" : "success";
  }
  if (result.error.kind === "user-confirmation-required") {
    return "aborted";
  }
  return "failed";
}
