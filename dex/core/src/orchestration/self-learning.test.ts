import { describe, expect, it, vi } from "vitest";
import {
  buildEngineHistoryProbe,
  createRouterTelemetryHooks,
  recordEngineRun,
  withTelemetryProbes,
} from "./self-learning.js";
import { MemoryTelemetryStore } from "./telemetry.js";
import type { ProcessContext, TaskIntent } from "./types.js";

const wordProcess: ProcessContext = {
  name: "winword.exe",
  exePath: "C:\\Program Files\\Office\\WINWORD.EXE",
  pid: 100,
};

const TASK: TaskIntent = { kind: "click", hints: ["bold"], text: "make this word bold" };

describe("buildEngineHistoryProbe", () => {
  it("returns empty history for an unknown process", async () => {
    const store = new MemoryTelemetryStore();
    const probe = buildEngineHistoryProbe(store);
    const result = await probe({ name: "never-seen.exe", exePath: "", pid: 1 });
    expect(result).toEqual({});
  });

  it("returns empty when process.name is blank", async () => {
    const store = new MemoryTelemetryStore();
    store.record({
      ts: 1,
      engineId: "ufo-uia",
      processName: "winword.exe",
      appFamily: "office",
      taskKind: "click",
      latencyMs: 100,
      outcome: "success",
      fallbackUsed: false,
    });
    const probe = buildEngineHistoryProbe(store);
    const result = await probe({ name: "", exePath: "", pid: 1 });
    expect(result).toEqual({});
  });

  it("aggregates per-engine history from the store", async () => {
    const store = new MemoryTelemetryStore();
    const baseRow = {
      ts: 1,
      processName: "winword.exe",
      appFamily: "office" as const,
      taskKind: "click" as const,
      latencyMs: 100,
      fallbackUsed: false,
    };
    store.record({ ...baseRow, engineId: "ufo-uia", outcome: "success" });
    store.record({ ...baseRow, engineId: "ufo-uia", outcome: "success" });
    store.record({ ...baseRow, engineId: "ufo-uia", outcome: "failed" });
    store.record({ ...baseRow, engineId: "shell", outcome: "success" });

    const probe = buildEngineHistoryProbe(store);
    const result = await probe(wordProcess);
    expect(result["ufo-uia"]).toEqual({ runs: 3, successes: 2, avgLatencyMs: 100 });
    expect(result["shell"]).toEqual({ runs: 1, successes: 1, avgLatencyMs: 100 });
  });
});

describe("recordEngineRun", () => {
  it("writes a row with the task hint + engine outcome", () => {
    const store = new MemoryTelemetryStore();
    recordEngineRun(
      store,
      {
        engineId: "browser-use",
        process: wordProcess,
        appFamily: "office",
        task: TASK,
        latencyMs: 500,
        outcome: "success",
        fallbackUsed: false,
      },
      () => 42,
    );
    expect(store.rowCount()).toBe(1);
    const row = store.recent()[0]!;
    expect(row).toMatchObject({
      ts: 42,
      engineId: "browser-use",
      processName: "winword.exe",
      appFamily: "office",
      taskKind: "click",
      taskHint: "bold",
      latencyMs: 500,
      outcome: "success",
      fallbackUsed: false,
    });
  });

  it("swallows record() errors via the warn hook", () => {
    const failingStore = {
      record() {
        throw new Error("disk full");
      },
      rowCount: () => 0,
      recent: () => [],
      statsByEngine: () => ({}),
      clear: () => {},
    };
    const warn = vi.fn();
    expect(() =>
      recordEngineRun(
        failingStore,
        {
          engineId: "shell",
          process: wordProcess,
          appFamily: "office",
          task: TASK,
          latencyMs: 1,
          outcome: "success",
          fallbackUsed: false,
        },
        () => 1,
        warn,
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });
});

describe("createRouterTelemetryHooks", () => {
  it("records a success row on primary success", () => {
    const store = new MemoryTelemetryStore();
    const hooks = createRouterTelemetryHooks(store, { process: wordProcess, appFamily: "office" }, TASK, {
      now: () => 100,
    });
    hooks.onAttempt({
      engine: "ufo-uia",
      attemptIndex: 0,
      durationMs: 250,
      result: { ok: true },
    });
    expect(store.rowCount()).toBe(1);
    expect(store.recent()[0]).toMatchObject({
      engineId: "ufo-uia",
      outcome: "success",
      fallbackUsed: false,
      latencyMs: 250,
    });
  });

  it("marks fallback successes as recovered", () => {
    const store = new MemoryTelemetryStore();
    const hooks = createRouterTelemetryHooks(store, { process: wordProcess, appFamily: "office" }, TASK);
    hooks.onAttempt({
      engine: "browser-use",
      attemptIndex: 1, // fallback
      durationMs: 1000,
      result: { ok: true },
    });
    expect(store.recent()[0]).toMatchObject({
      engineId: "browser-use",
      outcome: "recovered",
      fallbackUsed: true,
    });
  });

  it("records failed engines with the error class", () => {
    const store = new MemoryTelemetryStore();
    const hooks = createRouterTelemetryHooks(store, { process: wordProcess, appFamily: "office" }, TASK);
    hooks.onAttempt({
      engine: "ufo-uia",
      attemptIndex: 0,
      durationMs: 100,
      result: { ok: false, error: { kind: "timeout" } },
    });
    expect(store.recent()[0]).toMatchObject({
      engineId: "ufo-uia",
      outcome: "failed",
      errorClass: "timeout",
    });
  });

  it("classifies user-confirmation-required as aborted", () => {
    const store = new MemoryTelemetryStore();
    const hooks = createRouterTelemetryHooks(store, { process: wordProcess, appFamily: "office" }, TASK);
    hooks.onAttempt({
      engine: "ufo-uia",
      attemptIndex: 0,
      durationMs: 100,
      result: { ok: false, error: { kind: "user-confirmation-required" } },
    });
    expect(store.recent()[0]!.outcome).toBe("aborted");
  });

  it("onFallback does not throw and emits no rows", () => {
    const store = new MemoryTelemetryStore();
    const hooks = createRouterTelemetryHooks(store, { process: wordProcess, appFamily: "office" }, TASK);
    expect(() => hooks.onFallback({ from: "ufo-uia", to: "browser-use" })).not.toThrow();
    expect(store.rowCount()).toBe(0);
  });
});

describe("withTelemetryProbes", () => {
  it("adds a history probe when none was supplied", () => {
    const store = new MemoryTelemetryStore();
    const probes = withTelemetryProbes(store, {});
    expect(typeof probes.history).toBe("function");
  });

  it("preserves an existing history probe", async () => {
    const store = new MemoryTelemetryStore();
    const customProbe = async () => ({ shell: { runs: 99, successes: 99, avgLatencyMs: 1 } });
    const probes = withTelemetryProbes(store, { history: customProbe });
    expect(probes.history).toBe(customProbe);
  });
});
