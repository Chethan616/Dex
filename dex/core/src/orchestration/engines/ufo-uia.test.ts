import { describe, expect, it, vi } from "vitest";
import { UfoUiaEngine, type RunDesktopTaskCallback } from "./ufo-uia.js";
import type { ExecOpts, RuntimeContext, TaskIntent } from "../types.js";
import { NullVisionService } from "../vision.js";

function ctx(over: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    process: { name: "winword.exe", exePath: "", pid: 100 },
    appFamily: "office",
    uia: { available: true, rootChildCount: 12, estimatedDepth: 6 },
    visionCapable: true,
    history: {},
    budget: {},
    ...over,
  };
}

const TASK: TaskIntent = {
  kind: "type",
  hints: ["winword.exe"],
  text: "type 'hello dex' into the open document",
};
const OPTS: ExecOpts = { timeoutMs: 120_000 };

describe("UfoUiaEngine.id", () => {
  it("identifies as ufo-uia", () => {
    expect(new UfoUiaEngine().id()).toBe("ufo-uia");
  });
});

describe("UfoUiaEngine.score", () => {
  it("returns 0.9 on a native window with a populated UIA tree", () => {
    expect(new UfoUiaEngine().score(ctx(), TASK)).toBe(0.9);
  });

  it("drops to 0.3 when UIA is reachable but empty", () => {
    expect(
      new UfoUiaEngine().score(
        ctx({ uia: { available: true, rootChildCount: 0, estimatedDepth: 0 } }),
        TASK,
      ),
    ).toBe(0.3);
  });

  it("drops to 0.2 when UIA is unavailable entirely", () => {
    expect(
      new UfoUiaEngine().score(
        ctx({ uia: { available: false, rootChildCount: 0, estimatedDepth: 0 } }),
        TASK,
      ),
    ).toBe(0.2);
  });

  it("drops to 0.1 inside a browser (browser-use's territory)", () => {
    expect(
      new UfoUiaEngine().score(
        ctx({
          process: { name: "chrome.exe", exePath: "", pid: 9 },
          appFamily: "browser",
          browser: { kind: "chromium", domAvailable: true },
        }),
        TASK,
      ),
    ).toBe(0.1);
  });
});

describe("UfoUiaEngine.estimateSuccessRate", () => {
  it("returns 0.6 prior when history is empty", () => {
    expect(new UfoUiaEngine().estimateSuccessRate(ctx(), TASK)).toBe(0.6);
  });

  it("returns successes / runs when history exists", () => {
    expect(
      new UfoUiaEngine().estimateSuccessRate(
        ctx({
          history: { "ufo-uia": { runs: 20, successes: 18, avgLatencyMs: 4_200 } },
        }),
        TASK,
      ),
    ).toBeCloseTo(0.9, 6);
  });
});

describe("UfoUiaEngine.execute", () => {
  it("returns engine-unavailable when no transport is wired", async () => {
    const result = await new UfoUiaEngine().execute(ctx(), TASK, OPTS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("engine-unavailable");
  });

  it("forwards goal + appHint + timeout + dryRun to the MCP transport", async () => {
    const run: RunDesktopTaskCallback = vi.fn(async () => ({
      ok: true,
      summary: "typed",
      steps: ["focus word", "type hello dex"],
    }));
    await new UfoUiaEngine({ runDesktopTask: run }).execute(ctx(), TASK, {
      ...OPTS,
      dryRun: true,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "type 'hello dex' into the open document",
        appHint: "winword.exe",
        timeoutMs: 120_000,
        dryRun: true,
      }),
    );
  });

  it("honors uiaMode engine hint when caller asks for 'vision'", async () => {
    const run: RunDesktopTaskCallback = vi.fn(async () => ({
      ok: true,
      summary: "",
      steps: [],
    }));
    await new UfoUiaEngine({ runDesktopTask: run }).execute(ctx(), TASK, {
      ...OPTS,
      engineHints: { uiaMode: "vision" },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ engine: "vision" }));
  });

  it("clips returned step list to 32 entries", async () => {
    const run: RunDesktopTaskCallback = async () => ({
      ok: true,
      summary: "done",
      steps: Array.from({ length: 60 }, (_, i) => `step-${i}`),
    });
    const result = await new UfoUiaEngine({ runDesktopTask: run }).execute(
      ctx(),
      TASK,
      OPTS,
    );
    expect(result.ok && result.steps.length).toBe(32);
  });

  it("treats transport throw as recoverable", async () => {
    const run: RunDesktopTaskCallback = async () => {
      throw new Error("ufo subprocess died");
    };
    const result = await new UfoUiaEngine({ runDesktopTask: run }).execute(
      ctx(),
      TASK,
      OPTS,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("recoverable");
    expect(!result.ok && result.error.message).toBe("ufo subprocess died");
  });
});

describe("UfoUiaEngine vision slot (Phase E.2)", () => {
  it("accepts an optional vision service", () => {
    const vision = new NullVisionService();
    expect(new UfoUiaEngine({ vision }).id()).toBe("ufo-uia");
  });

  it("does NOT call vision.locate during execute (deferred to a later commit)", async () => {
    const vision = new NullVisionService();
    const locate = vi.spyOn(vision, "locate");
    const run: RunDesktopTaskCallback = async () => ({ ok: true, summary: "ok", steps: [] });
    await new UfoUiaEngine({ runDesktopTask: run, vision }).execute(ctx(), TASK, OPTS);
    expect(locate).not.toHaveBeenCalled();
  });
});
