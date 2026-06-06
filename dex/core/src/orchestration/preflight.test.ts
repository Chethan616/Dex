import { describe, expect, it } from "vitest";
import { buildEnginePreflightHint, preflight } from "./preflight.js";
import { OmniParserEngine } from "./engines/omniparser.js";
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
import type { ContextScannerProbes } from "./context-scanner.js";

function stub(id: EngineId): AutomationEngine {
  return {
    id: () => id,
    score: () => 0.5,
    estimateLatencyMs: () => 1_000,
    estimateSuccessRate: () => 0.5,
    async execute() {
      return { ok: true, summary: "", steps: [], durationMs: 0 };
    },
  };
}

const ENGINES: readonly AutomationEngine[] = [
  stub("shell"),
  stub("ufo-uia"),
  stub("browser-use"),
  new OmniParserEngine(),
];

function makeProbes(
  process: ProcessContext,
  uia: UiaContext,
  browser?: BrowserContext,
): ContextScannerProbes {
  return {
    foreground: async () => process,
    uia: async () => uia,
    browser: async () => browser,
    history: async () => ({}) as Record<EngineId, EngineHistory>,
    visionCapable: () => true,
  };
}

describe("preflight end-to-end", () => {
  it('routes "open notepad" to shell — close call with ufo-uia gets a hint', async () => {
    const result = await preflight({
      userText: "open notepad and write a hello world program",
      engines: ENGINES,
      probes: makeProbes(
        { name: "notepad.exe", exePath: "", pid: 1 },
        { available: true, rootChildCount: 5, estimatedDepth: 3 },
      ),
    });
    // shell wins on system family (BASE_SCORE_TABLE gives shell=0.95 vs
    // ufo-uia=0.85), but the composite gap is only ~0.04 -- under the
    // 0.05 suppression threshold. The agent sees the hint with both
    // engines listed so it can route the "and write a program" half to
    // ufo-uia after spawning notepad via shell.
    expect(result.routed.primary.engine).toBe("shell");
    expect(result.task.hints).toContain("notepad.exe");
    expect(result.hint).toContain("shell");
    expect(result.hint).toContain("ufo-uia");
  });

  it('routes "open figma.com canvas" to browser-use (browser + DOM)', async () => {
    const result = await preflight({
      userText: "open https://figma.com/file/abc and click Export",
      engines: ENGINES,
      probes: makeProbes(
        { name: "chrome.exe", exePath: "", pid: 1 },
        { available: true, rootChildCount: 4, estimatedDepth: 3 },
        { kind: "chromium", domAvailable: true, activeTabUrl: "https://figma.com" },
      ),
    });
    expect(result.routed.primary.engine).toBe("browser-use");
    expect(result.hint).toContain("browser-use");
    expect(result.hint).toContain("run_browser_task");
  });

  it('routes "click Start in steam.exe" to omniparser (game, no UIA, no DOM)', async () => {
    const result = await preflight({
      userText: "click Start in the steam.exe game launcher",
      engines: ENGINES,
      probes: makeProbes(
        { name: "steam.exe", exePath: "", pid: 1 },
        { available: false, rootChildCount: 0, estimatedDepth: 0 },
      ),
    });
    expect(result.routed.primary.engine).toBe("omniparser");
    expect(result.hint).toContain("omniparser");
    expect(result.hint).toContain("parse_screen");
  });

  it("populates ctx, task, routed, and a non-empty hint when ufo-uia wins (Word/office)", async () => {
    const result = await preflight({
      userText: "type 'Dear Professor' into the open Word document",
      engines: ENGINES,
      probes: makeProbes(
        { name: "winword.exe", exePath: "", pid: 1 },
        { available: true, rootChildCount: 12, estimatedDepth: 6 },
      ),
    });
    expect(result.ctx.process.name).toBe("winword.exe");
    expect(result.ctx.appFamily).toBe("office");
    expect(result.routed.primary.engine).toBe("ufo-uia");
    expect(result.task.hints).toContain("winword.exe");
    expect(result.routed.fallbacks).toHaveLength(2);
    expect(result.hint).not.toBe("");
    expect(result.hint).toContain("run_desktop_task");
  });
});

describe("buildEnginePreflightHint", () => {
  const ctx: RuntimeContext = {
    process: { name: "winword.exe", exePath: "", pid: 1 },
    appFamily: "office",
    uia: { available: true, rootChildCount: 12, estimatedDepth: 5 },
    visionCapable: true,
    history: {},
    budget: {},
  };
  const task: TaskIntent = {
    kind: "type",
    hints: ["winword.exe"],
    text: "type 'hello world' into Word",
  };

  it("formats a multi-line hint with primary + fallbacks", () => {
    const routed = {
      primary: {
        engine: "ufo-uia" as EngineId,
        score: 0.62,
        components: { base: 0.92, historyPrior: 0.5, latencyPenalty: 0, confidence: 0.5 },
        estimatedLatencyMs: 4_000,
      },
      fallbacks: [
        {
          engine: "shell" as EngineId,
          score: 0.34,
          components: { base: 0.1, historyPrior: 0.5, latencyPenalty: 0, confidence: 0.5 },
          estimatedLatencyMs: 200,
        },
      ],
      scoreBreakdown: [],
    };
    const hint = buildEnginePreflightHint({ ctx, task, routed });
    expect(hint).toContain("## Orchestrator preflight");
    expect(hint).toContain("ufo-uia");
    expect(hint).toContain("score=0.62");
    expect(hint).toContain("Hints: winword.exe");
    expect(hint).toContain("run_desktop_task");
    expect(hint).toContain("Fallback engines available: shell");
  });

  it("returns '' when shell wins runaway (no nudge needed)", () => {
    const routed = {
      primary: {
        engine: "shell" as EngineId,
        score: 0.78,
        components: { base: 0.95, historyPrior: 0.5, latencyPenalty: 0, confidence: 0.5 },
        estimatedLatencyMs: 200,
      },
      fallbacks: [
        {
          engine: "ufo-uia" as EngineId,
          score: 0.4,
          components: { base: 0.1, historyPrior: 0.5, latencyPenalty: 0, confidence: 0.5 },
          estimatedLatencyMs: 4_000,
        },
      ],
      scoreBreakdown: [],
    };
    const hint = buildEnginePreflightHint({
      ctx: { ...ctx, appFamily: "system" },
      task: { kind: "compound", hints: [], text: "ls Desktop" },
      routed,
    });
    expect(hint).toBe("");
  });
});
