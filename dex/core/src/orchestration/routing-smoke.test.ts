/**
 * Phase C.7 — 4-app routing smoke.
 *
 * End-to-end test: given the four representative app families (system,
 * office, browser, game), the orchestrator must pick the engine the
 * BASE_SCORE_TABLE says should win. This is the integration check that
 * proves the scanner → scorer → router pipeline is wired correctly.
 *
 * The smoke uses stub probes injected into `scanRuntimeContext` to
 * simulate the four contexts deterministically. Real engine adapters
 * aren't built yet (only OmniParser has a concrete class today), so we
 * use inline `AutomationEngine` stubs that all succeed -- the assertion
 * is on `routed.primary.engine`, not on execution behaviour.
 */
import { describe, expect, it } from "vitest";
import { OmniParserEngine } from "./engines/omniparser.js";
import { route } from "./router.js";
import { scanRuntimeContext, type ContextScannerProbes } from "./context-scanner.js";
import type {
  AutomationEngine,
  BrowserContext,
  EngineHistory,
  EngineId,
  ProcessContext,
  TaskIntent,
  UiaContext,
} from "./types.js";

const TASK: TaskIntent = { kind: "click", hints: [] };

function stubEngine(id: EngineId): AutomationEngine {
  return {
    id: () => id,
    score: () => 0.5,
    estimateLatencyMs: () => 1_000,
    estimateSuccessRate: () => 0.5,
    async execute() {
      return {
        ok: true,
        summary: `${id} ran`,
        steps: [{ text: `${id} step`, state: "done" }],
        durationMs: 5,
      };
    },
  };
}

function makeProbes(
  process: ProcessContext,
  uia: UiaContext,
  browser: BrowserContext | undefined,
): ContextScannerProbes {
  return {
    foreground: async () => process,
    uia: async () => uia,
    browser: async () => browser,
    history: async () => ({}) as Record<EngineId, EngineHistory>,
    visionCapable: () => true,
  };
}

const ENGINES: readonly AutomationEngine[] = [
  stubEngine("shell"),
  stubEngine("ufo-uia"),
  stubEngine("browser-use"),
  new OmniParserEngine(),
];

describe("routing smoke — 4 app families (Phase C.7)", () => {
  it("notepad.exe (system) → shell wins (highest base 0.95)", async () => {
    const ctx = await scanRuntimeContext(
      {},
      makeProbes(
        { name: "notepad.exe", exePath: "C:/Windows/notepad.exe", pid: 100 },
        { available: true, rootChildCount: 6, estimatedDepth: 4 },
        undefined,
      ),
    );
    expect(ctx.appFamily).toBe("system");
    const routed = route(ENGINES, ctx, TASK);
    expect(routed.primary.engine).toBe("shell");
  });

  it("winword.exe (office) → ufo-uia wins (highest base 0.92)", async () => {
    const ctx = await scanRuntimeContext(
      {},
      makeProbes(
        { name: "winword.exe", exePath: "C:/Office/winword.exe", pid: 101 },
        { available: true, rootChildCount: 12, estimatedDepth: 6 },
        undefined,
      ),
    );
    expect(ctx.appFamily).toBe("office");
    const routed = route(ENGINES, ctx, TASK);
    expect(routed.primary.engine).toBe("ufo-uia");
  });

  it("chrome.exe (browser, DOM available) → browser-use wins (highest base 0.95)", async () => {
    const ctx = await scanRuntimeContext(
      {},
      makeProbes(
        { name: "chrome.exe", exePath: "C:/Chrome/chrome.exe", pid: 102 },
        { available: true, rootChildCount: 4, estimatedDepth: 3 },
        { kind: "chromium", domAvailable: true, activeTabUrl: "https://example.com" },
      ),
    );
    expect(ctx.appFamily).toBe("browser");
    const routed = route(ENGINES, ctx, TASK);
    expect(routed.primary.engine).toBe("browser-use");
  });

  it("steam.exe (game, no UIA, no DOM) → omniparser wins (highest base 0.92)", async () => {
    const ctx = await scanRuntimeContext(
      {},
      makeProbes(
        { name: "steam.exe", exePath: "C:/Steam/steam.exe", pid: 103 },
        { available: false, rootChildCount: 0, estimatedDepth: 0 },
        undefined,
      ),
    );
    expect(ctx.appFamily).toBe("game");
    const routed = route(ENGINES, ctx, TASK);
    expect(routed.primary.engine).toBe("omniparser");
    // OmniParser's self-confidence is also 0.9 here (no UIA + no DOM) so
    // the composite score should sit well clear of the runner-up.
    const margin = routed.primary.score - (routed.fallbacks[0]?.score ?? 0);
    expect(margin).toBeGreaterThan(0.2);
  });

  it("provides a fallback chain of length 2 for every family", async () => {
    const contexts = [
      makeProbes(
        { name: "notepad.exe", exePath: "", pid: 1 },
        { available: true, rootChildCount: 1, estimatedDepth: 1 },
        undefined,
      ),
      makeProbes(
        { name: "winword.exe", exePath: "", pid: 2 },
        { available: true, rootChildCount: 1, estimatedDepth: 1 },
        undefined,
      ),
      makeProbes(
        { name: "chrome.exe", exePath: "", pid: 3 },
        { available: true, rootChildCount: 1, estimatedDepth: 1 },
        { kind: "chromium", domAvailable: true },
      ),
      makeProbes(
        { name: "steam.exe", exePath: "", pid: 4 },
        { available: false, rootChildCount: 0, estimatedDepth: 0 },
        undefined,
      ),
    ];
    for (const probes of contexts) {
      const ctx = await scanRuntimeContext({}, probes);
      const routed = route(ENGINES, ctx, TASK);
      expect(routed.fallbacks).toHaveLength(2);
      expect(routed.scoreBreakdown).toHaveLength(4);
      // Sorted descending: primary score >= each fallback.
      for (const fb of routed.fallbacks) {
        expect(routed.primary.score).toBeGreaterThanOrEqual(fb.score);
      }
    }
  });
});
