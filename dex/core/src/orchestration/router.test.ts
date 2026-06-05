import { describe, expect, it, vi } from "vitest";
import { executeWithFallbacks, findEngine, route } from "./router.js";
import type {
  AppFamily,
  AutomationEngine,
  EngineId,
  ExecError,
  ExecResult,
  RuntimeContext,
  TaskIntent,
} from "./types.js";

// ---- helpers --------------------------------------------------------------

function makeEngine(
  id: EngineId,
  exec: (n: number) => ExecResult,
  opts: { score?: number; latency?: number; recover?: AutomationEngine["recover"] } = {},
): AutomationEngine & { executions: number } {
  const state = { executions: 0 };
  return {
    ...state,
    id: () => id,
    score: () => opts.score ?? 0.5,
    estimateLatencyMs: () => opts.latency ?? 1_000,
    estimateSuccessRate: () => 0.5,
    async execute() {
      state.executions++;
      return exec(state.executions);
    },
    recover: opts.recover,
    get executions() {
      return state.executions;
    },
  } as AutomationEngine & { executions: number };
}

function makeCtx(family: AppFamily): RuntimeContext {
  return {
    process: { name: "x.exe", exePath: "", pid: 1 },
    appFamily: family,
    uia: { available: true, rootChildCount: 5, estimatedDepth: 3 },
    visionCapable: true,
    history: {},
    budget: {},
  };
}

const TASK: TaskIntent = { kind: "click", hints: [] };

const ok = (text = "done"): ExecResult => ({
  ok: true,
  summary: text,
  steps: [{ text, state: "done" }],
  durationMs: 5,
});
const fail = (kind: ExecError["kind"], message = "fail"): ExecResult => ({
  ok: false,
  error: { kind, message },
  steps: [],
  durationMs: 5,
});

// ---- route() --------------------------------------------------------------

describe("route", () => {
  it("returns the primary + 2 fallbacks sorted by score", () => {
    const engines = [
      makeEngine("ufo-uia", () => ok()),
      makeEngine("browser-use", () => ok()),
      makeEngine("shell", () => ok()),
      makeEngine("omniparser", () => ok()),
    ];
    const ctx = makeCtx("browser");
    const result = route(engines, ctx, TASK);
    expect(result.primary.engine).toBe("browser-use");
    expect(result.fallbacks).toHaveLength(2);
    expect(result.scoreBreakdown).toHaveLength(4);
    // scoreBreakdown is the full sorted list including the primary
    expect(result.scoreBreakdown[0]!.engine).toBe("browser-use");
  });

  it("throws on empty engine list", () => {
    expect(() => route([], makeCtx("browser"), TASK)).toThrow(/no engines/);
  });

  it("respects custom fallback count", () => {
    const engines = [
      makeEngine("ufo-uia", () => ok()),
      makeEngine("browser-use", () => ok()),
      makeEngine("shell", () => ok()),
    ];
    expect(route(engines, makeCtx("office"), TASK, 0).fallbacks).toHaveLength(0);
    expect(route(engines, makeCtx("office"), TASK, 1).fallbacks).toHaveLength(1);
    expect(route(engines, makeCtx("office"), TASK, 5).fallbacks).toHaveLength(2);
  });
});

describe("findEngine", () => {
  it("locates engines by id", () => {
    const a = makeEngine("ufo-uia", () => ok());
    const b = makeEngine("shell", () => ok());
    expect(findEngine([a, b], "shell")).toBe(b);
    expect(findEngine([a, b], "browser-use")).toBeUndefined();
  });
});

// ---- executeWithFallbacks --------------------------------------------------

describe("executeWithFallbacks", () => {
  it("returns the primary's success immediately", async () => {
    const engines = [
      makeEngine("ufo-uia", () => ok("primary"), { score: 0.9 }),
      makeEngine("browser-use", () => ok("secondary")),
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const onAttempt = vi.fn();

    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed, {
      onAttempt,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.summary).toBe("primary");
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ engine: "ufo-uia" }));
  });

  it("falls back to the next engine when primary fails recoverably", async () => {
    const engines = [
      makeEngine("ufo-uia", () => fail("recoverable")),
      makeEngine("browser-use", () => ok("fallback win")),
    ];
    // Use office family so ufo-uia wins primary, browser-use is fallback
    const routed = route(engines, makeCtx("office"), TASK);
    const onFallback = vi.fn();

    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed, {
      onFallback,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.summary).toBe("fallback win");
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ from: "ufo-uia", to: "browser-use" }),
    );
  });

  it("does not fall back on user-confirmation-required", async () => {
    const engines = [
      makeEngine("ufo-uia", () => fail("user-confirmation-required", "approve please")),
      makeEngine("browser-use", () => ok()),
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const onAttempt = vi.fn();

    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed, {
      onAttempt,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("user-confirmation-required");
    expect(onAttempt).toHaveBeenCalledTimes(1); // didn't try browser-use
  });

  it("does not fall back on fatal", async () => {
    const engines = [
      makeEngine("ufo-uia", () => fail("fatal", "blew up")),
      makeEngine("browser-use", () => ok()),
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const onAttempt = vi.fn();

    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed, {
      onAttempt,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("fatal");
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("returns the last failure when the whole chain fails", async () => {
    // In office family the chain is ufo-uia (primary), shell, browser-use.
    // The last engine attempted is browser-use, so that's the failure
    // shape the router surfaces.
    const engines = [
      makeEngine("ufo-uia", () => fail("recoverable", "primary fail")),
      makeEngine("shell", () => fail("timeout", "fallback-1 timeout")),
      makeEngine("browser-use", () => fail("fatal", "fallback-2 fatal")),
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed);
    expect(result.ok).toBe(false);
    // browser-use returns `fatal` which short-circuits the chain. The
    // router must STILL surface browser-use's failure, not the earlier
    // recoverable from ufo-uia or the timeout from shell.
    expect(!result.ok && result.error.kind).toBe("fatal");
    expect(!result.ok && result.error.message).toBe("fallback-2 fatal");
  });

  it("honours noFallback by NOT advancing past the primary", async () => {
    const browserUseEngine = makeEngine("browser-use", () => ok());
    const engines = [
      makeEngine("ufo-uia", () => fail("recoverable")),
      browserUseEngine,
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed, {
      noFallback: true,
    });
    expect(result.ok).toBe(false);
    // browser-use must not have been executed
    expect((browserUseEngine as AutomationEngine & { executions: number }).executions).toBe(0);
  });

  it("invokes engine.recover and retries once when recovery says retry", async () => {
    const engine = makeEngine(
      "ufo-uia",
      (n) => (n === 1 ? fail("recoverable", "first try") : ok("retry win")),
      { recover: async () => ({ kind: "retry" }) },
    );
    const engines = [engine, makeEngine("browser-use", () => ok())];
    const routed = route(engines, makeCtx("office"), TASK);
    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed);
    expect(result.ok).toBe(true);
    expect(result.ok && result.summary).toBe("retry win");
    expect((engine as AutomationEngine & { executions: number }).executions).toBe(2);
  });

  it("stops the chain when engine.recover returns give-up", async () => {
    const browserUseEngine = makeEngine("browser-use", () => ok());
    const engine = makeEngine("ufo-uia", () => fail("recoverable"), {
      recover: async () => ({ kind: "give-up" }),
    });
    const engines = [engine, browserUseEngine];
    const routed = route(engines, makeCtx("office"), TASK);
    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed);
    expect(result.ok).toBe(false);
    expect((browserUseEngine as AutomationEngine & { executions: number }).executions).toBe(0);
  });

  it("catches an engine that throws and treats it as recoverable", async () => {
    const engines = [
      makeEngine("ufo-uia", () => {
        throw new Error("boom");
      }),
      makeEngine("browser-use", () => ok("saved by fallback")),
    ];
    const routed = route(engines, makeCtx("office"), TASK);
    const result = await executeWithFallbacks(engines, makeCtx("office"), TASK, routed);
    expect(result.ok).toBe(true);
    expect(result.ok && result.summary).toBe("saved by fallback");
  });

  it("returns engine-unavailable when chain references an unknown id", async () => {
    const engines = [makeEngine("shell", () => ok())];
    const routed = route(engines, makeCtx("system"), TASK);
    // Mutate the routed primary to point at a missing engine
    const broken = {
      ...routed,
      primary: { ...routed.primary, engine: "nonexistent" as EngineId },
    };
    const result = await executeWithFallbacks(engines, makeCtx("system"), TASK, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("engine-unavailable");
  });
});
