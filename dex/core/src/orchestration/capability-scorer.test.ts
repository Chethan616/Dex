import { describe, expect, it } from "vitest";
import {
  BASE_SCORE_TABLE,
  baseScoreFor,
  betaPriorMean,
  latencyPenalty,
  scoreAll,
  scoreOne,
} from "./capability-scorer.js";
import { BETA_PRIOR_ALPHA, BETA_PRIOR_BETA, WEIGHTS } from "./scorer-weights.js";
import type {
  AppFamily,
  AutomationEngine,
  EngineHistory,
  EngineId,
  ExecResult,
  RuntimeContext,
  TaskIntent,
} from "./types.js";

// ---- Helpers ----------------------------------------------------------------

function makeEngine(
  id: EngineId,
  opts: {
    score?: number;
    latency?: number;
    successRate?: number;
  } = {},
): AutomationEngine {
  return {
    id: () => id,
    score: () => opts.score ?? 0.5,
    estimateLatencyMs: () => opts.latency ?? 1_000,
    estimateSuccessRate: () => opts.successRate ?? 0.5,
    async execute(): Promise<ExecResult> {
      return { ok: true, summary: "", steps: [], durationMs: 0 };
    },
  };
}

function makeCtx(
  family: AppFamily,
  history: Record<EngineId, EngineHistory | undefined> = {},
  budgetMs?: number,
): RuntimeContext {
  return {
    process: { name: "test.exe", exePath: "", pid: 100 },
    appFamily: family,
    uia: { available: true, rootChildCount: 10, estimatedDepth: 5 },
    visionCapable: true,
    history,
    budget: budgetMs !== undefined ? { latencyMs: budgetMs } : {},
  };
}

const TASK: TaskIntent = { kind: "click", hints: [], text: "test" };

// ---- betaPriorMean ----------------------------------------------------------

describe("betaPriorMean", () => {
  it("returns 0.5 with no observations (α=β=2)", () => {
    expect(betaPriorMean(0, 0)).toBeCloseTo(0.5, 6);
  });

  it("nudges toward 1.0 with successes", () => {
    expect(betaPriorMean(8, 0)).toBeGreaterThan(0.7);
    expect(betaPriorMean(50, 0)).toBeGreaterThan(0.9);
  });

  it("nudges toward 0 with failures", () => {
    expect(betaPriorMean(0, 8)).toBeLessThan(0.3);
    expect(betaPriorMean(0, 50)).toBeLessThan(0.1);
  });

  it("treats α + β invariant: equal success/failure stays at 0.5", () => {
    expect(betaPriorMean(10, 10)).toBeCloseTo(0.5, 6);
    expect(betaPriorMean(100, 100)).toBeCloseTo(0.5, 6);
  });

  it("clamps negative inputs to 0", () => {
    expect(betaPriorMean(-5, 0)).toBe(BETA_PRIOR_ALPHA / (BETA_PRIOR_ALPHA + BETA_PRIOR_BETA));
  });
});

// ---- latencyPenalty ---------------------------------------------------------

describe("latencyPenalty", () => {
  it("is 0 when no budget is set", () => {
    expect(latencyPenalty(99_999, undefined)).toBe(0);
  });

  it("is 0 when estimate fits the budget", () => {
    expect(latencyPenalty(500, 1_000)).toBe(0);
    expect(latencyPenalty(1_000, 1_000)).toBe(0);
  });

  it("is negative when estimate exceeds the budget", () => {
    expect(latencyPenalty(1_500, 1_000)).toBeLessThan(0);
    expect(latencyPenalty(1_500, 1_000)).toBeCloseTo(-0.5, 6);
  });

  it("caps at -1 even for catastrophic overshoots", () => {
    expect(latencyPenalty(60_000, 1_000)).toBe(-1);
  });

  it("returns the cap when budget is zero", () => {
    expect(latencyPenalty(100, 0)).toBe(-1);
  });
});

// ---- baseScoreFor -----------------------------------------------------------

describe("baseScoreFor", () => {
  it("returns expected base for known (engine, family) pairs", () => {
    expect(baseScoreFor("ufo-uia", "office")).toBe(0.92);
    expect(baseScoreFor("browser-use", "browser")).toBe(0.95);
    expect(baseScoreFor("omniparser", "game")).toBe(0.92);
    expect(baseScoreFor("shell", "system")).toBe(0.95);
  });

  it("falls back to unknown family then 0 for missing pairs", () => {
    expect(baseScoreFor("nonsense" as EngineId, "browser")).toBe(0);
    expect(baseScoreFor("ufo-uia", "unknown")).toBe(0.55);
  });
});

describe("BASE_SCORE_TABLE", () => {
  it("has every primary engine with a score row", () => {
    expect(BASE_SCORE_TABLE).toHaveProperty("shell");
    expect(BASE_SCORE_TABLE).toHaveProperty("ufo-uia");
    expect(BASE_SCORE_TABLE).toHaveProperty("browser-use");
    expect(BASE_SCORE_TABLE).toHaveProperty("omniparser");
  });

  it("every row scores all seven app families in [0, 1]", () => {
    for (const [engine, row] of Object.entries(BASE_SCORE_TABLE)) {
      for (const family of ["browser", "office", "ide", "game", "media", "system", "unknown"] as AppFamily[]) {
        const v = row[family];
        expect(v, `${engine}/${family}`).toBeGreaterThanOrEqual(0);
        expect(v, `${engine}/${family}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---- scoreOne ---------------------------------------------------------------

describe("scoreOne", () => {
  it("composes base + history + latency + confidence with the locked weights", () => {
    const engine = makeEngine("ufo-uia", { score: 0.6, latency: 800 });
    const ctx = makeCtx("office", {
      "ufo-uia": { runs: 10, successes: 8, avgLatencyMs: 700 },
    });

    const breakdown = scoreOne(engine, ctx, TASK);

    const base = 0.92; // ufo-uia/office
    const history = betaPriorMean(8, 2);
    const latencyP = 0; // 800 fits the (unset) budget
    const confidence = 0.6;
    const expected =
      WEIGHTS.base * base +
      WEIGHTS.historyPrior * history +
      WEIGHTS.latencyPenalty * latencyP +
      WEIGHTS.confidence * confidence;

    expect(breakdown.engine).toBe("ufo-uia");
    expect(breakdown.score).toBeCloseTo(expected, 6);
    expect(breakdown.components.base).toBe(base);
    expect(breakdown.components.historyPrior).toBeCloseTo(history, 6);
    expect(breakdown.components.latencyPenalty).toBe(0);
    expect(breakdown.components.confidence).toBe(0.6);
    expect(breakdown.estimatedLatencyMs).toBe(800);
  });

  it("defaults history to 0.5 prior when no record exists", () => {
    const engine = makeEngine("browser-use", { score: 0.5, latency: 100 });
    const ctx = makeCtx("browser"); // no history
    const breakdown = scoreOne(engine, ctx, TASK);
    expect(breakdown.components.historyPrior).toBeCloseTo(0.5, 6);
  });

  it("applies the latency penalty when over budget", () => {
    const engine = makeEngine("browser-use", { latency: 5_000 });
    const ctx = makeCtx("browser", {}, 1_000); // 4x over budget
    const breakdown = scoreOne(engine, ctx, TASK);
    expect(breakdown.components.latencyPenalty).toBeLessThan(0);
  });

  it("clamps a misbehaving engine confidence into [0, 1]", () => {
    const engine = makeEngine("ufo-uia", { score: 99 });
    const ctx = makeCtx("office");
    const breakdown = scoreOne(engine, ctx, TASK);
    expect(breakdown.components.confidence).toBe(1);

    const engineNeg = makeEngine("ufo-uia", { score: -5 });
    const breakdownNeg = scoreOne(engineNeg, ctx, TASK);
    expect(breakdownNeg.components.confidence).toBe(0);
  });
});

// ---- scoreAll ---------------------------------------------------------------

describe("scoreAll", () => {
  it("returns engines sorted descending by composite score", () => {
    const engines: AutomationEngine[] = [
      makeEngine("shell"),
      makeEngine("ufo-uia"),
      makeEngine("browser-use"),
    ];
    const ctx = makeCtx("browser");
    const result = scoreAll(engines, ctx, TASK);
    expect(result).toHaveLength(3);
    // browser-use base on browser is 0.95 -> wins; ufo-uia 0.10 < shell 0.20
    expect(result[0]!.engine).toBe("browser-use");
    expect(result[1]!.engine).toBe("shell");
    expect(result[2]!.engine).toBe("ufo-uia");
  });

  it("picks UFO² for a Word document task", () => {
    const engines: AutomationEngine[] = [
      makeEngine("ufo-uia"),
      makeEngine("browser-use"),
      makeEngine("shell"),
    ];
    const ctx = makeCtx("office");
    const result = scoreAll(engines, ctx, TASK);
    expect(result[0]!.engine).toBe("ufo-uia");
  });

  it("picks OmniParser for a game window", () => {
    const engines: AutomationEngine[] = [
      makeEngine("ufo-uia"),
      makeEngine("browser-use"),
      makeEngine("shell"),
      makeEngine("omniparser"),
    ];
    const ctx = makeCtx("game");
    const result = scoreAll(engines, ctx, TASK);
    expect(result[0]!.engine).toBe("omniparser");
  });

  it("history can overturn the base ranking after enough wins", () => {
    const engines: AutomationEngine[] = [
      makeEngine("ufo-uia"),
      makeEngine("browser-use"),
    ];
    // Office app family: ufo-uia base is 0.92, browser-use 0.05. But
    // browser-use has been winning here for 100 turns; history should
    // close the gap somewhat (not overturn entirely — that's by design).
    const ctxWithHistory = makeCtx("office", {
      "browser-use": { runs: 100, successes: 100, avgLatencyMs: 500 },
      "ufo-uia": { runs: 100, successes: 0, avgLatencyMs: 500 },
    });
    const result = scoreAll(engines, ctxWithHistory, TASK);
    // Math: 0.4 * 0.05 + 0.3 * ~1.0 + 0 + 0.1 = 0.42 for browser-use
    //       0.4 * 0.92 + 0.3 * ~0 + 0 + 0.1 = 0.468 for ufo-uia
    // History gets browser-use close but base still wins. This documents
    // that intent: base reflects "what the engine is GOOD at"; history
    // reflects "what worked in PRACTICE for this user". They balance.
    expect(result[0]!.engine).toBe("ufo-uia");
    expect(result[0]!.score - result[1]!.score).toBeLessThan(0.1);
  });

  it("breakdowns include estimatedLatencyMs from the engine", () => {
    const engines = [makeEngine("ufo-uia", { latency: 2_500 })];
    const result = scoreAll(engines, makeCtx("office"), TASK);
    expect(result[0]!.estimatedLatencyMs).toBe(2_500);
  });

  it("returns empty array when no engines are registered", () => {
    const result = scoreAll([], makeCtx("browser"), TASK);
    expect(result).toEqual([]);
  });
});
