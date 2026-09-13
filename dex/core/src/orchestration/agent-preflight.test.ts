import { describe, expect, it } from "vitest";
import { runAgentPreflightFor, runAgentPreflightRaw } from "./agent-preflight.js";
import { defaultEngines, resetEngineRegistryForTesting } from "./registry.js";

describe("runAgentPreflightFor — what the agent prepare loop calls", () => {
  it("returns '' for empty input (no nudge to make)", async () => {
    expect(await runAgentPreflightFor("")).toBe("");
    expect(await runAgentPreflightFor("   ")).toBe("");
  });

  it("never throws -- a preflight bug must NOT block an agent turn", async () => {
    const broken = [
      {
        id() {
          throw new Error("engine ctor blew up");
        },
      },
    ] as unknown as Parameters<typeof runAgentPreflightFor>[1]["engines"];
    // The internal try/catch should swallow this and return ''.
    expect(
      await runAgentPreflightFor("open notepad", { engines: broken! }),
    ).toBe("");
  });
});

describe("runAgentPreflightRaw — synthetic foreground from task hints", () => {
  it("routes 'open notepad and write hello' to ufo-uia (UI interaction wins)", async () => {
    const result = await runAgentPreflightRaw("open notepad and write hello");
    expect(result.ctx.process.name).toBe("notepad.exe");
    expect(result.ctx.appFamily).toBe("system");
    // With UIA assumed available (the user named a desktop app),
    // ufo-uia's high self-confidence on a populated UIA tree (0.9)
    // beats shell's 0.5 -- the agent gets nudged toward
    // run_desktop_task so it can actually type "hello", not just
    // spawn notepad and stop.
    expect(result.routed.primary.engine).toBe("ufo-uia");
    expect(result.hint).toContain("ufo-uia");
    expect(result.hint).toContain("run_desktop_task");
  });

  it("routes a URL prompt to browser-use with a synthetic chrome.exe", async () => {
    const result = await runAgentPreflightRaw(
      "take the typing test at https://livechat.com/typing",
    );
    expect(result.ctx.process.name).toBe("chrome.exe");
    expect(result.ctx.appFamily).toBe("browser");
    expect(result.ctx.browser?.kind).toBe("chromium");
    expect(result.ctx.browser?.activeTabUrl).toContain("livechat.com");
    expect(result.routed.primary.engine).toBe("browser-use");
    expect(result.hint).toContain("run_browser_task");
  });

  it("routes a Word task to ufo-uia (office family)", async () => {
    const result = await runAgentPreflightRaw(
      "type 'Dear Professor' into the open Word document",
    );
    expect(result.ctx.process.name).toBe("winword.exe");
    expect(result.ctx.appFamily).toBe("office");
    expect(result.routed.primary.engine).toBe("ufo-uia");
    expect(result.hint).toContain("run_desktop_task");
  });

  it("returns an unknown family when the user prompt names no app at all", async () => {
    const result = await runAgentPreflightRaw("I want it to be funnier");
    expect(result.ctx.appFamily).toBe("unknown");
    // The hint may or may not be present, but the call must succeed.
    expect(result).toBeDefined();
  });
});

describe("defaultEngines registry", () => {
  it("returns the four engines (shell stub + ufo-uia + browser-use + omniparser)", () => {
    resetEngineRegistryForTesting();
    const engines = defaultEngines();
    const ids = engines.map((e) => e.id());
    expect(ids).toEqual(
      expect.arrayContaining(["shell", "ufo-uia", "browser-use", "omniparser"]),
    );
    expect(engines).toHaveLength(4);
  });

  it("memoizes -- repeat calls return the same instances", () => {
    resetEngineRegistryForTesting();
    const first = defaultEngines();
    const second = defaultEngines();
    expect(first).toBe(second);
  });

  it("shell stub.execute returns engine-unavailable until F.1.b wires the real adapter", async () => {
    const shell = defaultEngines().find((e) => e.id() === "shell")!;
    const result = await shell.execute(
      {
        process: { name: "", exePath: "", pid: -1 },
        appFamily: "unknown",
        uia: { available: false, rootChildCount: 0, estimatedDepth: 0 },
        visionCapable: false,
        history: {},
        budget: {},
      },
      { kind: "compound", hints: [], text: "ls" },
      { timeoutMs: 1000 },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("engine-unavailable");
  });
});
