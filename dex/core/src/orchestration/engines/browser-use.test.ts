import { describe, expect, it, vi } from "vitest";
import { BrowserUseEngine, type RunBrowserTaskCallback } from "./browser-use.js";
import type { ExecOpts, RuntimeContext, TaskIntent } from "../types.js";
import { NullVisionService } from "../vision.js";

function ctx(over: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    process: { name: "chrome.exe", exePath: "", pid: 1 },
    appFamily: "browser",
    uia: { available: true, rootChildCount: 4, estimatedDepth: 3 },
    browser: { kind: "chromium", domAvailable: true },
    visionCapable: true,
    history: {},
    budget: {},
    ...over,
  };
}

const TASK: TaskIntent = {
  kind: "navigate",
  hints: ["https://example.com"],
  text: "open example.com and read the homepage",
};
const OPTS: ExecOpts = { timeoutMs: 30_000 };

describe("BrowserUseEngine.id", () => {
  it("identifies as browser-use", () => {
    expect(new BrowserUseEngine().id()).toBe("browser-use");
  });
});

describe("BrowserUseEngine.score", () => {
  it("returns 0.95 in browser family with reachable DOM", () => {
    expect(new BrowserUseEngine().score(ctx(), TASK)).toBe(0.95);
  });

  it("returns 0.6 in browser family when DOM is unreachable", () => {
    expect(
      new BrowserUseEngine().score(
        ctx({ browser: { kind: "chromium", domAvailable: false } }),
        TASK,
      ),
    ).toBe(0.6);
  });

  it("drops to 0.1 outside browser context (e.g. Word)", () => {
    expect(
      new BrowserUseEngine().score(
        ctx({
          process: { name: "winword.exe", exePath: "", pid: 2 },
          appFamily: "office",
          browser: undefined,
        }),
        TASK,
      ),
    ).toBe(0.1);
  });
});

describe("BrowserUseEngine.estimateSuccessRate", () => {
  it("returns 0.55 prior when history is empty", () => {
    expect(new BrowserUseEngine().estimateSuccessRate(ctx(), TASK)).toBe(0.55);
  });

  it("returns successes / runs when history exists", () => {
    expect(
      new BrowserUseEngine().estimateSuccessRate(
        ctx({
          history: { "browser-use": { runs: 10, successes: 8, avgLatencyMs: 5_500 } },
        }),
        TASK,
      ),
    ).toBeCloseTo(0.8, 6);
  });
});

describe("BrowserUseEngine.execute", () => {
  it("returns engine-unavailable when no transport is wired", async () => {
    const result = await new BrowserUseEngine().execute(ctx(), TASK, OPTS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("engine-unavailable");
  });

  it("forwards goal + urlHint + dryRun + timeout to the MCP transport", async () => {
    const run: RunBrowserTaskCallback = vi.fn(async () => ({
      ok: true,
      summary: "navigated successfully",
      steps: ["go to example.com", "read homepage"],
    }));
    const engine = new BrowserUseEngine({ runBrowserTask: run });
    await engine.execute(ctx(), TASK, { ...OPTS, dryRun: true });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "open example.com and read the homepage",
        urlHint: "https://example.com",
        timeoutMs: 30_000,
        dryRun: true,
      }),
    );
  });

  it("clips returned step list to 32 entries", async () => {
    const run: RunBrowserTaskCallback = async () => ({
      ok: true,
      summary: "done",
      steps: Array.from({ length: 60 }, (_, i) => `step-${i}`),
    });
    const result = await new BrowserUseEngine({ runBrowserTask: run }).execute(
      ctx(),
      TASK,
      OPTS,
    );
    expect(result.ok && result.steps.length).toBe(32);
  });

  it("treats transport throw as recoverable so the router can fall back", async () => {
    const run: RunBrowserTaskCallback = vi.fn(async () => {
      throw new Error("playwright kaboom");
    });
    const result = await new BrowserUseEngine({ runBrowserTask: run }).execute(
      ctx(),
      TASK,
      OPTS,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("recoverable");
    expect(!result.ok && result.error.message).toBe("playwright kaboom");
  });

  it("returns recoverable when transport reports ok=false", async () => {
    const run: RunBrowserTaskCallback = async () => ({
      ok: false,
      summary: "captcha refused",
      steps: ["hit captcha"],
    });
    const result = await new BrowserUseEngine({ runBrowserTask: run }).execute(
      ctx(),
      TASK,
      OPTS,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("recoverable");
    expect(!result.ok && result.error.message).toBe("captcha refused");
  });
});

describe("BrowserUseEngine vision slot (Phase E.2)", () => {
  it("accepts an optional vision service in constructor options", () => {
    const vision = new NullVisionService();
    const engine = new BrowserUseEngine({ vision });
    // E.2's deliverable is the plumbing: vision is wired without
    // changing execute() semantics yet. The canvas-detection hook lands
    // in E.3 on the Python driver side.
    expect(engine.id()).toBe("browser-use");
  });

  it("does NOT call vision.locate during execute (that's E.3's job)", async () => {
    const vision = new NullVisionService();
    const locate = vi.spyOn(vision, "locate");
    const run: RunBrowserTaskCallback = async () => ({ ok: true, summary: "ok", steps: [] });
    await new BrowserUseEngine({ runBrowserTask: run, vision }).execute(ctx(), TASK, OPTS);
    expect(locate).not.toHaveBeenCalled();
  });
});
