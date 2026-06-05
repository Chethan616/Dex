import { describe, expect, it, vi } from "vitest";
import {
  _APP_FAMILY_TABLE_FOR_TESTS as APP_FAMILY_TABLE,
  _withTimeoutForTests as withTimeout,
  classifyAppFamily,
  scanRuntimeContext,
} from "./context-scanner.js";

describe("classifyAppFamily", () => {
  it("classifies known browsers", () => {
    expect(classifyAppFamily("chrome.exe")).toBe("browser");
    expect(classifyAppFamily("msedge.exe")).toBe("browser");
    expect(classifyAppFamily("FIREFOX.EXE")).toBe("browser");
  });

  it("classifies Office apps", () => {
    expect(classifyAppFamily("WINWORD.EXE")).toBe("office");
    expect(classifyAppFamily("excel.exe")).toBe("office");
  });

  it("classifies system tools", () => {
    expect(classifyAppFamily("notepad.exe")).toBe("system");
    expect(classifyAppFamily("calc.exe")).toBe("system");
  });

  it("classifies known game launchers", () => {
    expect(classifyAppFamily("steam.exe")).toBe("game");
    expect(classifyAppFamily("MINECRAFT.EXE")).toBe("game");
  });

  it("returns unknown for unrecognised processes", () => {
    expect(classifyAppFamily("randomapp.exe")).toBe("unknown");
    expect(classifyAppFamily("")).toBe("unknown");
  });
});

describe("withTimeout", () => {
  it("returns the original promise when it resolves before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 50, () => "fallback");
    expect(result).toBe("ok");
  });

  it("returns the timeout fallback when the promise hangs", async () => {
    const slow = new Promise<string>(() => {
      /* never resolves */
    });
    const result = await withTimeout(slow, 10, () => "fallback");
    expect(result).toBe("fallback");
  });
});

describe("scanRuntimeContext", () => {
  it("returns a valid ctx even when every probe is a no-op", async () => {
    const ctx = await scanRuntimeContext();
    expect(ctx).toMatchObject({
      process: { name: expect.any(String) },
      appFamily: expect.any(String),
      uia: { available: false },
      history: {},
    });
    expect(typeof ctx.visionCapable).toBe("boolean");
  });

  it("honours an injected foreground probe", async () => {
    const ctx = await scanRuntimeContext(
      {},
      {
        foreground: async () => ({
          name: "winword.exe",
          exePath: "C:\\Program Files\\Microsoft Office\\WINWORD.EXE",
          pid: 1234,
        }),
        visionCapable: () => true,
      },
    );
    expect(ctx.process.name).toBe("winword.exe");
    expect(ctx.appFamily).toBe("office");
    expect(ctx.visionCapable).toBe(true);
  });

  it("populates UIA + browser facts from injected probes", async () => {
    const ctx = await scanRuntimeContext(
      {},
      {
        foreground: async () => ({ name: "chrome.exe", exePath: "", pid: 100 }),
        uia: async () => ({ available: true, rootChildCount: 5, estimatedDepth: 8 }),
        browser: async () => ({
          kind: "chromium",
          activeTabUrl: "https://example.com",
          domAvailable: true,
        }),
      },
    );
    expect(ctx.appFamily).toBe("browser");
    expect(ctx.uia.available).toBe(true);
    expect(ctx.uia.rootChildCount).toBe(5);
    expect(ctx.browser?.activeTabUrl).toBe("https://example.com");
    expect(ctx.browser?.domAvailable).toBe(true);
  });

  it("degrades to NO_UIA when the UIA probe hangs past the timeout", async () => {
    const ctx = await scanRuntimeContext(
      {},
      {
        foreground: async () => ({ name: "notepad.exe", exePath: "", pid: 1 }),
        uia: () => new Promise(() => {}), // never resolves
        timeoutMs: 5,
      },
    );
    expect(ctx.uia).toEqual({ available: false, rootChildCount: 0, estimatedDepth: 0 });
  });

  it("returns undefined browser ctx when the foreground process isn't a browser", async () => {
    const ctx = await scanRuntimeContext(
      {},
      {
        foreground: async () => ({ name: "winword.exe", exePath: "", pid: 1 }),
      },
    );
    expect(ctx.browser).toBeUndefined();
  });

  it("infers browser kind from process name when probe is the default", async () => {
    const ctx = await scanRuntimeContext(
      {},
      {
        foreground: async () => ({ name: "msedge.exe", exePath: "", pid: 1 }),
      },
    );
    expect(ctx.browser?.kind).toBe("chromium");
    expect(ctx.browser?.domAvailable).toBe(false);
  });

  it("passes the budget through unchanged", async () => {
    const ctx = await scanRuntimeContext({ latencyMs: 750 }, {
      foreground: async () => ({ name: "", exePath: "", pid: -1 }),
    });
    expect(ctx.budget.latencyMs).toBe(750);
  });

  it("scan completes within the wall-clock budget even when probes fan out", async () => {
    const timeoutMs = 25;
    const start = performance.now();
    await scanRuntimeContext(
      {},
      {
        foreground: async () => ({ name: "calc.exe", exePath: "", pid: 1 }),
        uia: () => new Promise(() => {}),
        browser: () => new Promise(() => {}),
        history: () => new Promise(() => {}),
        timeoutMs,
      },
    );
    const elapsed = performance.now() - start;
    // Allow 3x slack: the three parallel probes each time out at `timeoutMs`,
    // and there's per-call jitter on slower CI VMs.
    expect(elapsed).toBeLessThan(timeoutMs * 3 + 50);
  });
});

describe("APP_FAMILY_TABLE", () => {
  it("contains every category at least once", () => {
    const families = new Set(Object.values(APP_FAMILY_TABLE));
    expect(families.has("browser")).toBe(true);
    expect(families.has("office")).toBe(true);
    expect(families.has("ide")).toBe(true);
    expect(families.has("media")).toBe(true);
    expect(families.has("system")).toBe(true);
  });
});

describe("module shape", () => {
  // Smoke: a fresh import works without throwing (no top-level side effects).
  it("imports without error", async () => {
    const mod = await import("./context-scanner.js");
    expect(typeof mod.scanRuntimeContext).toBe("function");
    expect(typeof mod.classifyAppFamily).toBe("function");
  });

  // Defensive: vi.mock noop just to confirm the test runtime is happy.
  it("vitest is wired", () => {
    expect(vi.fn).toBeDefined();
  });
});
