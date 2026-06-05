/**
 * Router — Phase C.3.
 *
 * Picks the primary AutomationEngine for a task, returns a fallback
 * chain, and (optionally) drives the chain to completion. The "pick"
 * step is pure-sort: capability-scorer ranks every engine, the router
 * slices the top + next two. The "execute" step is where the fallback
 * logic lives — primary's `recover()` is consulted on a recoverable
 * error, and only after recovery declines do we move down the chain.
 */

import { scoreAll } from "./capability-scorer.js";
import { DEFAULT_EXEC_TIMEOUT_MS } from "./scorer-weights.js";
import type {
  AutomationEngine,
  EngineId,
  ExecError,
  ExecOpts,
  ExecResult,
  RoutedExecution,
  RuntimeContext,
  ScoreBreakdown,
  TaskIntent,
} from "./types.js";

/** Number of fallbacks to keep after the primary. */
const DEFAULT_FALLBACK_COUNT = 2;

/**
 * Pick the primary engine + fallback chain for a (ctx, task) pair.
 * Pure function; no side effects. Returns the full sorted breakdown so
 * telemetry can record what almost-won.
 */
export function route(
  engines: readonly AutomationEngine[],
  ctx: RuntimeContext,
  task: TaskIntent,
  fallbackCount: number = DEFAULT_FALLBACK_COUNT,
): RoutedExecution {
  const scoreBreakdown = scoreAll(engines, ctx, task);
  const primary = scoreBreakdown[0];
  if (!primary) {
    throw new Error(
      "router.route() called with no engines registered. Wire at least one engine in the orchestration registry before routing.",
    );
  }
  const fallbacks = scoreBreakdown.slice(1, 1 + Math.max(0, fallbackCount));
  return { primary, fallbacks, scoreBreakdown };
}

/** Map an EngineId back to its AutomationEngine instance. */
export function findEngine(
  engines: readonly AutomationEngine[],
  id: EngineId,
): AutomationEngine | undefined {
  return engines.find((e) => e.id() === id);
}

export interface ExecuteWithFallbacksOptions {
  /** Per-engine timeout override. Defaults to DEFAULT_EXEC_TIMEOUT_MS[engine]. */
  timeoutMsPerEngine?: Partial<Record<EngineId, number>>;
  /** Hook for telemetry — called once per engine attempt. */
  onAttempt?: (event: AttemptEvent) => void;
  /** Hook for fallback decisions. Telemetry / UI chip transitions read this. */
  onFallback?: (event: FallbackEvent) => void;
  /** Stop after primary fails (no fallback). Default false. */
  noFallback?: boolean;
}

export interface AttemptEvent {
  engine: EngineId;
  /** 0 = primary, 1 = first fallback, etc. */
  attemptIndex: number;
  score: number;
  estimatedLatencyMs: number;
  result?: ExecResult;
  durationMs: number;
}

export interface FallbackEvent {
  from: EngineId;
  to: EngineId;
  /** Why we fell back. */
  reason: ExecError;
}

/**
 * Run the primary engine. If it returns a recoverable error and refuses
 * to recover (or recovery fails), try the first fallback, then the
 * second. Surfaces the first successful result or the last error.
 *
 * The router does NOT itself prompt the user. When an engine returns
 * `kind: "user-confirmation-required"`, we bubble that up immediately
 * — the gateway / Flutter UI is responsible for the approval UX.
 */
export async function executeWithFallbacks(
  engines: readonly AutomationEngine[],
  ctx: RuntimeContext,
  task: TaskIntent,
  routed: RoutedExecution,
  options: ExecuteWithFallbacksOptions = {},
): Promise<ExecResult> {
  const chain: ScoreBreakdown[] = options.noFallback
    ? [routed.primary]
    : [routed.primary, ...routed.fallbacks];

  let lastResult: ExecResult | undefined;
  let previousEngine: EngineId | undefined;

  for (let i = 0; i < chain.length; i++) {
    const breakdown = chain[i]!;
    const engine = findEngine(engines, breakdown.engine);
    if (!engine) {
      // An engine in the chain disappeared between routing + execution
      // (shouldn't happen with a well-formed registry, but defensive).
      const error: ExecError = {
        kind: "engine-unavailable",
        message: `Engine ${breakdown.engine} not found in registry at execute time`,
      };
      if (previousEngine && options.onFallback) {
        options.onFallback({ from: previousEngine, to: breakdown.engine, reason: error });
      }
      lastResult = { ok: false, error, steps: [], durationMs: 0 };
      continue;
    }

    const timeoutMs =
      options.timeoutMsPerEngine?.[breakdown.engine] ??
      (DEFAULT_EXEC_TIMEOUT_MS as Record<EngineId, number | undefined>)[breakdown.engine] ??
      30_000;

    const startedAt = nowMs();
    const opts: ExecOpts = { timeoutMs };

    let result: ExecResult;
    try {
      result = await engine.execute(ctx, task, opts);
    } catch (err) {
      // An engine that throws (rather than returning ok:false) is a bug
      // — but routing still tolerates it so one bad engine can't kill
      // the whole turn. Treat the thrown error as `recoverable` so the
      // next fallback gets a chance.
      result = {
        ok: false,
        error: {
          kind: "recoverable",
          message: err instanceof Error ? err.message : String(err),
        },
        steps: [],
        durationMs: nowMs() - startedAt,
      };
    }

    options.onAttempt?.({
      engine: breakdown.engine,
      attemptIndex: i,
      score: breakdown.score,
      estimatedLatencyMs: breakdown.estimatedLatencyMs,
      result,
      durationMs: result.durationMs,
    });

    lastResult = result;

    if (result.ok) {
      return result;
    }

    // Failed. Decide whether to continue the chain.
    const err = result.error;
    if (err.kind === "user-confirmation-required") {
      // Bubble immediately; routing has nothing to add.
      return result;
    }
    if (err.kind === "fatal") {
      return result;
    }

    // Try engine-internal recovery once.
    if (engine.recover && (err.kind === "recoverable" || err.kind === "timeout")) {
      const recovery = await engine.recover(err);
      if (recovery.kind === "retry") {
        // Retry the same engine ONCE in place.
        const retryStart = nowMs();
        try {
          const retried = await engine.execute(ctx, task, opts);
          options.onAttempt?.({
            engine: breakdown.engine,
            attemptIndex: i,
            score: breakdown.score,
            estimatedLatencyMs: breakdown.estimatedLatencyMs,
            result: retried,
            durationMs: retried.durationMs,
          });
          lastResult = retried;
          if (retried.ok) {
            return retried;
          }
        } catch (retryErr) {
          lastResult = {
            ok: false,
            error: {
              kind: "recoverable",
              message: retryErr instanceof Error ? retryErr.message : String(retryErr),
            },
            steps: [],
            durationMs: nowMs() - retryStart,
          };
        }
      } else if (recovery.kind === "give-up") {
        return lastResult ?? result;
      }
      // `fall-back-to` and `ask-user` recovery actions fall through to the
      // standard chain advancement below; routing doesn't try to honour
      // the engine's specific fallback suggestion yet.
    }

    // Advance the chain.
    if (i + 1 < chain.length) {
      const next = chain[i + 1]!;
      options.onFallback?.({ from: breakdown.engine, to: next.engine, reason: err });
    }
    previousEngine = breakdown.engine;
  }

  // Whole chain exhausted; return the last failure (or a synthesized one).
  return (
    lastResult ?? {
      ok: false,
      error: {
        kind: "engine-unavailable",
        message: "Router exhausted with no engines available",
      },
      steps: [],
      durationMs: 0,
    }
  );
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
