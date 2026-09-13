/**
 * Phase C.7 — orchestration perf bench.
 *
 * Asserts the three latency budgets locked in the slash-plan:
 *
 *   - context scan   : p95 < 50 ms
 *   - capability score: p95 < 10 ms
 *   - route          : p95 <  5 ms
 *
 * The whole point of the hybrid scorer is that routing is "free" compared
 * to an LLM call. If these budgets ever regress, the win disappears.
 *
 * The bench uses instant stub probes for the scanner so we measure the
 * orchestrator's own cost, not the cost of a Win32 / UIA / CDP probe. The
 * intent is to lock the structural overhead under control; the probes
 * themselves get their own per-probe 50ms timeout in production.
 */
import { describe, expect, it } from "vitest";
import { scoreAll } from "./capability-scorer.js";
import { scanRuntimeContext, type ContextScannerProbes } from "./context-scanner.js";
import { route } from "./router.js";
import type {
  AutomationEngine,
  BrowserContext,
  EngineHistory,
  EngineId,
  ProcessContext,
  RuntimeContext,
  TaskIntent,
  UiaContext,
} from "./types.js";

const ITERATIONS = 200;
const WARMUP = 20;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? 0;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function makeEngine(id: EngineId, baseLatency = 1_000): AutomationEngine {
  return {
    id: () => id,
    score: () => 0.5,
    estimateLatencyMs: () => baseLatency,
    estimateSuccessRate: () => 0.5,
    async execute() {
      return { ok: true, summary: "", steps: [], durationMs: 0 };
    },
  };
}

const ENGINES: readonly AutomationEngine[] = [
  makeEngine("shell", 200),
  makeEngine("ufo-uia", 3_000),
  makeEngine("browser-use", 8_000),
  makeEngine("omniparser", 2_000),
];

const TASK: TaskIntent = { kind: "click", hints: [] };

const CTX: RuntimeContext = {
  process: { name: "chrome.exe", exePath: "C:/chrome.exe", pid: 1 },
  appFamily: "browser",
  browser: { kind: "chromium", domAvailable: true },
  uia: { available: false, rootChildCount: 0, estimatedDepth: 0 },
  visionCapable: true,
  history: {},
  budget: {},
};

const INSTANT_PROBES: ContextScannerProbes = {
  foreground: async (): Promise<ProcessContext> => ({
    name: "chrome.exe",
    exePath: "C:/chrome.exe",
    pid: 1,
  }),
  uia: async (): Promise<UiaContext> => ({
    available: false,
    rootChildCount: 0,
    estimatedDepth: 0,
  }),
  browser: async (): Promise<BrowserContext | undefined> => ({
    kind: "chromium",
    domAvailable: true,
  }),
  history: async (): Promise<Record<EngineId, EngineHistory>> => ({}),
  visionCapable: () => true,
};

describe("orchestration perf bench (Phase C.7)", () => {
  it("capability scoring stays under 10 ms p95 for 4 engines", () => {
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const start = nowMs();
      scoreAll(ENGINES, CTX, TASK);
      const elapsed = nowMs() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }
    const observed = p95(samples);
    expect.soft(observed, `scoring p95=${observed.toFixed(3)}ms`).toBeLessThan(10);
  });

  it("routing (score + sort + slice) stays under 5 ms p95", () => {
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const start = nowMs();
      route(ENGINES, CTX, TASK);
      const elapsed = nowMs() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }
    const observed = p95(samples);
    expect.soft(observed, `route p95=${observed.toFixed(3)}ms`).toBeLessThan(5);
  });

  it("context scan stays under 50 ms p95 with instant probes", async () => {
    const samples: number[] = [];
    // Lower iteration count -- this is async with setTimeout machinery so
    // the per-iteration cost is dominated by event-loop scheduling, not
    // the scanner itself. 50 samples is enough for p95 stability.
    const scanIterations = 50;
    const scanWarmup = 5;
    for (let i = 0; i < scanIterations + scanWarmup; i++) {
      const start = nowMs();
      await scanRuntimeContext({}, INSTANT_PROBES);
      const elapsed = nowMs() - start;
      if (i >= scanWarmup) samples.push(elapsed);
    }
    const observed = p95(samples);
    expect.soft(observed, `ctx-scan p95=${observed.toFixed(3)}ms`).toBeLessThan(50);
  });
});
