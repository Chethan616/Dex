/**
 * Capability scorer — Phase C.2.
 *
 * Given a RuntimeContext (from `./context-scanner.ts`) and a TaskIntent,
 * compute a composite score for every registered AutomationEngine. The
 * router (C.3) sorts the breakdowns descending and picks the top entry
 * as the primary engine. The next two are the fallback chain.
 *
 * The scorer is pure-deterministic — no LLM, no I/O. Total cost is
 * O(engines) per call; with the current four engines that's < 1 ms.
 */

import type {
  AppFamily,
  AutomationEngine,
  EngineId,
  RuntimeContext,
  ScoreBreakdown,
  TaskIntent,
} from "./types.js";
import {
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
  LATENCY_PENALTY_CAP,
  WEIGHTS,
} from "./scorer-weights.js";

/**
 * Hand-tuned base scores per (engine, app family). These numbers are
 * starting heuristics — the Beta-prior history (C.4) refines them per
 * process over time. Update the README table when you tune these.
 */
export const BASE_SCORE_TABLE: Record<EngineId, Record<AppFamily, number>> = {
  shell: {
    browser: 0.2,
    office: 0.1,
    ide: 0.55,
    game: 0.05,
    media: 0.05,
    system: 0.95,
    unknown: 0.4,
  },
  "ufo-uia": {
    browser: 0.1,
    office: 0.92,
    ide: 0.65,
    game: 0.05,
    media: 0.45,
    system: 0.85,
    unknown: 0.55,
  },
  "browser-use": {
    browser: 0.95,
    office: 0.05,
    ide: 0.1,
    game: 0,
    media: 0.2,
    system: 0.05,
    unknown: 0.2,
  },
  omniparser: {
    browser: 0.3,
    office: 0.4,
    ide: 0.45,
    game: 0.92,
    media: 0.7,
    system: 0.3,
    unknown: 0.6,
  },
};

/** Beta-distribution mean given α + observed successes and β + failures. */
export function betaPriorMean(successes: number, failures: number): number {
  const a = BETA_PRIOR_ALPHA + Math.max(0, successes);
  const b = BETA_PRIOR_BETA + Math.max(0, failures);
  return a / (a + b);
}

/**
 * Linear latency penalty. Returns 0 when the engine fits the budget, a
 * negative number capped at -LATENCY_PENALTY_CAP when it doesn't.
 */
export function latencyPenalty(
  estimatedMs: number,
  budgetMs: number | undefined,
): number {
  if (budgetMs === undefined || estimatedMs <= budgetMs) {
    return 0;
  }
  if (budgetMs <= 0) {
    return -LATENCY_PENALTY_CAP;
  }
  const overshoot = (estimatedMs - budgetMs) / budgetMs;
  return -Math.min(LATENCY_PENALTY_CAP, overshoot);
}

/**
 * Look up the base score for an engine on a given app family. Missing
 * (engine, family) pairs fall back to `unknown` family then to 0.
 */
export function baseScoreFor(engineId: EngineId, family: AppFamily): number {
  const row = BASE_SCORE_TABLE[engineId];
  if (!row) {
    return 0;
  }
  return row[family] ?? row.unknown ?? 0;
}

/**
 * Score one engine on the given context+task. Public so engines that
 * want to inspect their own scoring can call this without round-tripping
 * through `scoreAll`.
 */
export function scoreOne(
  engine: AutomationEngine,
  ctx: RuntimeContext,
  task: TaskIntent,
): ScoreBreakdown {
  const id = engine.id();
  const base = baseScoreFor(id, ctx.appFamily);

  const h = ctx.history[id];
  const historyPrior = h ? betaPriorMean(h.successes, h.runs - h.successes) : 0.5;

  const estimatedLatencyMs = engine.estimateLatencyMs(ctx, task);
  const latencyP = latencyPenalty(estimatedLatencyMs, ctx.budget.latencyMs);

  const confidence = clamp01(engine.score(ctx, task));

  const score =
    WEIGHTS.base * base +
    WEIGHTS.historyPrior * historyPrior +
    WEIGHTS.latencyPenalty * latencyP +
    WEIGHTS.confidence * confidence;

  return {
    engine: id,
    score,
    components: { base, historyPrior, latencyPenalty: latencyP, confidence },
    estimatedLatencyMs,
  };
}

/**
 * Score every registered engine. Returns a sorted-DESCENDING list of
 * ScoreBreakdowns so callers can take `[0]` as the primary, `[1..3]` as
 * the fallback chain.
 */
export function scoreAll(
  engines: readonly AutomationEngine[],
  ctx: RuntimeContext,
  task: TaskIntent,
): ScoreBreakdown[] {
  return engines.map((e) => scoreOne(e, ctx, task)).sort((a, b) => b.score - a.score);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
