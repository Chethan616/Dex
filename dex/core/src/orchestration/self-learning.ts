/**
 * Self-learning — Phase C.4.
 *
 * The "learner" is statistical, not ML: every engine attempt the router
 * runs becomes an `engine_runs` row in the telemetry store, and the
 * `buildEngineHistoryProbe` factory below reads those rows back to
 * compute the Beta-prior history snapshot that the scanner injects into
 * `RuntimeContext.history`.
 *
 * No model training, no neural nets — just `successes / runs` per
 * (process, engine) tuple, blended with α=β=2 weakly-informative
 * Beta prior in `capability-scorer.ts:betaPriorMean()`. After ~20 runs
 * the prior swings clearly toward the empirical success rate; before
 * then it stays near 0.5 so a single bad early run doesn't poison
 * the chart.
 *
 * This module also defines `recordExecutionEvents()` — the function the
 * gateway wires into the router's `onAttempt` hook so each attempt
 * becomes a telemetry row automatically.
 */

import type { ContextScannerProbes } from "./context-scanner.js";
import {
  outcomeFromExecResult,
  type EngineRunRecord,
  type TelemetryStore,
} from "./telemetry.js";
import type {
  AppFamily,
  EngineHistory,
  EngineId,
  ProcessContext,
  TaskIntent,
} from "./types.js";

/**
 * Build the `history` probe a scanner uses. The returned async function
 * reads the store for whatever process the scanner asks about and
 * returns the `EngineHistory` shape the scorer expects.
 *
 * Use it like:
 *
 *   const scanner = await scanRuntimeContext(budget, {
 *     ...otherProbes,
 *     history: buildEngineHistoryProbe(store),
 *   });
 */
export function buildEngineHistoryProbe(
  store: TelemetryStore,
): (process: ProcessContext) => Promise<Record<EngineId, EngineHistory>> {
  return async (process) => {
    if (!process.name) {
      return {};
    }
    const stats = store.statsByEngine(process.name);
    const out: Record<EngineId, EngineHistory> = {};
    for (const [engineId, s] of Object.entries(stats)) {
      out[engineId as EngineId] = {
        runs: s.runs,
        successes: s.successes,
        avgLatencyMs: s.avgLatencyMs,
      };
    }
    return out;
  };
}

/**
 * Append an engine-run row to the telemetry store. Designed to be called
 * from the router's `onAttempt` hook + a separate finalization call from
 * the gateway when it knows whether the run was a fallback that
 * eventually succeeded ("recovered").
 *
 * Errors thrown by the store are swallowed (logged via warn?) so a
 * misbehaving store can never block the user's turn.
 */
export function recordEngineRun(
  store: TelemetryStore,
  params: {
    engineId: EngineId;
    process: ProcessContext;
    appFamily: AppFamily;
    task: TaskIntent;
    latencyMs: number;
    outcome: ReturnType<typeof outcomeFromExecResult>;
    fallbackUsed: boolean;
    errorClass?: string;
  },
  now: () => number = Date.now,
  warn?: (message: string) => void,
): void {
  const row: EngineRunRecord = {
    ts: now(),
    engineId: params.engineId,
    processName: params.process.name,
    appFamily: params.appFamily,
    taskKind: params.task.kind,
    taskHint: params.task.hints[0],
    latencyMs: params.latencyMs,
    outcome: params.outcome,
    fallbackUsed: params.fallbackUsed,
    errorClass: params.errorClass,
  };
  try {
    store.record(row);
  } catch (err) {
    warn?.(`telemetry store record() failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Plug telemetry recording into an existing executeWithFallbacks call.
 * Returns the `onAttempt` + `onFallback` hooks the router accepts.
 *
 *   const hooks = createRouterTelemetryHooks(store, ctx, task);
 *   await executeWithFallbacks(engines, ctx, task, routed, hooks);
 *
 * The hooks track whether each engine attempt was a fallback (chain
 * index > 0) and whether the chain ever advanced (so the eventual
 * success can be marked "recovered" instead of "success").
 */
export function createRouterTelemetryHooks(
  store: TelemetryStore,
  ctx: {
    process: ProcessContext;
    appFamily: AppFamily;
  },
  task: TaskIntent,
  options?: {
    now?: () => number;
    warn?: (message: string) => void;
  },
): {
  onAttempt: (event: {
    engine: EngineId;
    attemptIndex: number;
    durationMs: number;
    result?: { ok: boolean; error?: { kind: string } };
  }) => void;
  onFallback: (event: { from: EngineId; to: EngineId }) => void;
} {
  let chainAdvanced = false;
  return {
    onAttempt: (event) => {
      const fallbackUsed = event.attemptIndex > 0;
      const result = event.result;
      const wasSuccess = result?.ok === true;
      // We pretend `recovered === fallbackUsed` for this writer: if the
      // chain advanced at all and we eventually succeeded, that's a
      // "recovered" outcome. This is the spirit of the schema even though
      // the strict definition is "engine.recover() saved us". The
      // distinction matters for the prior because recovered engines have
      // proven they can succeed under stress.
      const outcome = wasSuccess
        ? fallbackUsed
          ? "recovered"
          : "success"
        : result && result.error?.kind === "user-confirmation-required"
          ? "aborted"
          : "failed";
      recordEngineRun(
        store,
        {
          engineId: event.engine,
          process: ctx.process,
          appFamily: ctx.appFamily,
          task,
          latencyMs: event.durationMs,
          outcome,
          fallbackUsed,
          errorClass: !wasSuccess && result?.error?.kind ? result.error.kind : undefined,
        },
        options?.now,
        options?.warn,
      );
    },
    onFallback: () => {
      chainAdvanced = true;
      void chainAdvanced; // referenced for tooling; no behavioural effect yet
    },
  };
}

/**
 * Convenience: build a complete probes object the scanner can use,
 * preserving any other probes the caller already wired.
 */
export function withTelemetryProbes(
  store: TelemetryStore,
  base: ContextScannerProbes = {},
): ContextScannerProbes {
  return {
    ...base,
    history: base.history ?? buildEngineHistoryProbe(store),
  };
}
