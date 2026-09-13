import { describe, expect, it, vi } from "vitest";
import { OmniParserEngine } from "./omniparser.js";
import type { ExecOpts, RuntimeContext, TaskIntent } from "../types.js";

function ctx(over: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    process: { name: "game.exe", exePath: "", pid: 1 },
    appFamily: "game",
    uia: { available: false, rootChildCount: 0, estimatedDepth: 0 },
    visionCapable: true,
    history: {},
    budget: {},
    ...over,
  };
}

const TASK: TaskIntent = { kind: "click", hints: [] };
const OPTS: ExecOpts = { timeoutMs: 30_000 };

describe("OmniParserEngine.id", () => {
  it("identifies as omniparser", () => {
    expect(new OmniParserEngine().id()).toBe("omniparser");
  });
});

describe("OmniParserEngine.score", () => {
  it("returns 0.9 when neither UIA nor DOM is available", () => {
    const score = new OmniParserEngine().score(ctx(), TASK);
    expect(score).toBe(0.9);
  });

  it("returns 0.5 when only one of UIA/DOM is available", () => {
    const withUia = new OmniParserEngine().score(
      ctx({ uia: { available: true, rootChildCount: 5, estimatedDepth: 3 } }),
      TASK,
    );
    expect(withUia).toBe(0.5);

    const withDom = new OmniParserEngine().score(
      ctx({
        uia: { available: false, rootChildCount: 0, estimatedDepth: 0 },
        browser: { kind: "chromium", domAvailable: true },
      }),
      TASK,
    );
    expect(withDom).toBe(0.5);
  });

  it("returns 0.2 when both UIA and DOM are available (we're the worst pick)", () => {
    const score = new OmniParserEngine().score(
      ctx({
        uia: { available: true, rootChildCount: 5, estimatedDepth: 3 },
        browser: { kind: "chromium", domAvailable: true },
      }),
      TASK,
    );
    expect(score).toBe(0.2);
  });
});

describe("OmniParserEngine.estimateLatencyMs", () => {
  it("estimates 2s on a vision-capable host", () => {
    expect(new OmniParserEngine().estimateLatencyMs(ctx(), TASK)).toBe(2000);
  });
  it("estimates 5s when vision is unavailable (headless fallback)", () => {
    expect(
      new OmniParserEngine().estimateLatencyMs(ctx({ visionCapable: false }), TASK),
    ).toBe(5000);
  });
});

describe("OmniParserEngine.estimateSuccessRate", () => {
  it("returns 0.5 with no history", () => {
    expect(new OmniParserEngine().estimateSuccessRate(ctx(), TASK)).toBe(0.5);
  });

  it("returns successes / runs when history exists", () => {
    const withHistory = ctx({
      history: {
        omniparser: { runs: 10, successes: 7, avgLatencyMs: 1500 },
      },
    });
    expect(new OmniParserEngine().estimateSuccessRate(withHistory, TASK)).toBeCloseTo(0.7, 6);
  });
});

describe("OmniParserEngine.execute", () => {
  it("returns engine-unavailable when no MCP transport is wired", async () => {
    const result = await new OmniParserEngine().execute(ctx(), TASK, OPTS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("engine-unavailable");
    expect(!result.ok && result.error.message).toMatch(/MCP transport not wired/);
  });

  it("returns a structured success when the transport returns elements", async () => {
    const call = vi.fn(async () => ({
      elements: [
        { bbox: [10, 10, 80, 30] as [number, number, number, number], label: "Start", type: "button" },
        { bbox: [10, 60, 80, 30] as [number, number, number, number], label: "Exit", type: "button" },
      ],
      imagePath: "/tmp/cap.png",
      modelVersion: "omniparser-v2",
      durationMs: 420,
    }));
    const engine = new OmniParserEngine({ callParseScreen: call });
    const result = await engine.execute(ctx(), TASK, OPTS);
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000 }));
    expect(result.ok && result.summary).toContain("2 elements");
    expect(result.ok && result.steps).toHaveLength(2);
    expect(result.ok && result.steps[0]!.text).toContain("Start");
  });

  it("treats a transport throw as a recoverable error so the chain advances", async () => {
    const call = vi.fn(async () => {
      throw new Error("python crashed");
    });
    const engine = new OmniParserEngine({ callParseScreen: call });
    const result = await engine.execute(ctx(), TASK, OPTS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("recoverable");
    expect(!result.ok && result.error.message).toBe("python crashed");
  });

  it("clips the step list to the first 12 elements for the action card", async () => {
    const elements = Array.from({ length: 25 }, (_, i) => ({
      bbox: [0, i * 30, 100, 24] as [number, number, number, number],
      label: `el-${i}`,
      type: "button",
    }));
    const call = async () => ({
      elements,
      imagePath: "/tmp/cap.png",
      modelVersion: "omniparser-v2",
      durationMs: 200,
    });
    const result = await new OmniParserEngine({ callParseScreen: call }).execute(ctx(), TASK, OPTS);
    expect(result.ok && result.steps.length).toBe(12);
  });
});
