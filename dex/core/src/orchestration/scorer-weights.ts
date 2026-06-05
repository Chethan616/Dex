/**
 * Tunable weights for the orchestrator's capability scorer.
 *
 * Composite score for one engine on one task:
 *
 *   score = WEIGHTS.base           * base
 *         + WEIGHTS.historyPrior   * historyPrior
 *         + WEIGHTS.latencyPenalty * latencyPenalty
 *         + WEIGHTS.confidence     * confidence
 *
 * Weights sum to 1.0 by convention. Keep that invariant if you tune them
 * so the resulting `score` stays in roughly the same 0..1 range — that's
 * what the router + telemetry assume when comparing across engines.
 */

export const WEIGHTS = Object.freeze({
  /** Hand-tuned (engine, appFamily) base — biggest single signal. */
  base: 0.4,
  /** Beta-prior mean from historical telemetry. */
  historyPrior: 0.3,
  /** Negative when the engine's estimated latency exceeds the task budget. */
  latencyPenalty: 0.1,
  /** Engine's self-reported confidence on the current RuntimeContext. */
  confidence: 0.2,
} as const);

/**
 * Beta-prior shape parameters. α=β=2 is weakly-informative: after one
 * success the posterior mean nudges to ~0.6; after one failure, ~0.4.
 * Twenty runs needed before the prior swings to 0.9+ or 0.1- for a
 * clearly-stable engine on a clearly-stable app.
 */
export const BETA_PRIOR_ALPHA = 2;
export const BETA_PRIOR_BETA = 2;

/**
 * When an engine's `estimateLatencyMs` exceeds `budget.latencyMs`, we
 * penalise its score on a linear ramp. The penalty equals
 *   -min(1, (estimate - budget) / budget)
 * so a 2x-overbudget engine pegs at -1, halving its overall score given
 * the WEIGHTS.latencyPenalty coefficient above.
 */
export const LATENCY_PENALTY_CAP = 1;

/** Default per-engine timeout (ms) when execOpts.timeoutMs is unset. */
export const DEFAULT_EXEC_TIMEOUT_MS = {
  shell: 30_000,
  "ufo-uia": 15_000,
  "browser-use": 60_000,
  omniparser: 30_000,
} as const;
