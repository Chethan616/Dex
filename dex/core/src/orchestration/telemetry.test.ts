import { describe, expect, it } from "vitest";
import {
  MemoryTelemetryStore,
  outcomeFromExecResult,
  type EngineRunRecord,
} from "./telemetry.js";
import type { ExecResult } from "./types.js";

const baseRow: EngineRunRecord = {
  ts: 1,
  engineId: "ufo-uia",
  processName: "winword.exe",
  appFamily: "office",
  taskKind: "click",
  latencyMs: 100,
  outcome: "success",
  fallbackUsed: false,
};

describe("MemoryTelemetryStore", () => {
  it("starts empty", () => {
    const store = new MemoryTelemetryStore();
    expect(store.rowCount()).toBe(0);
    expect(store.recent()).toEqual([]);
  });

  it("records rows in insertion order", () => {
    const store = new MemoryTelemetryStore();
    store.record({ ...baseRow, ts: 1 });
    store.record({ ...baseRow, ts: 2 });
    store.record({ ...baseRow, ts: 3 });
    expect(store.rowCount()).toBe(3);
    expect(store.recent().map((r) => r.ts)).toEqual([1, 2, 3]);
  });

  it("recent(n) returns at most n latest rows", () => {
    const store = new MemoryTelemetryStore();
    for (let i = 0; i < 10; i++) store.record({ ...baseRow, ts: i });
    expect(store.recent(3).map((r) => r.ts)).toEqual([7, 8, 9]);
    expect(store.recent(0)).toEqual([]);
    expect(store.recent(100)).toHaveLength(10);
  });

  it("aggregates statsByEngine per process", () => {
    const store = new MemoryTelemetryStore();
    store.record({ ...baseRow, engineId: "ufo-uia", latencyMs: 100, outcome: "success" });
    store.record({ ...baseRow, engineId: "ufo-uia", latencyMs: 200, outcome: "success" });
    store.record({ ...baseRow, engineId: "ufo-uia", latencyMs: 300, outcome: "failed" });
    store.record({ ...baseRow, engineId: "browser-use", latencyMs: 500, outcome: "success" });

    const stats = store.statsByEngine("winword.exe");
    expect(stats["ufo-uia"]).toEqual({
      runs: 3,
      successes: 2,
      avgLatencyMs: 200, // (100 + 200 + 300) / 3
    });
    expect(stats["browser-use"]).toEqual({
      runs: 1,
      successes: 1,
      avgLatencyMs: 500,
    });
  });

  it("scopes stats by processName -- other apps don't leak in", () => {
    const store = new MemoryTelemetryStore();
    store.record({ ...baseRow, processName: "winword.exe", engineId: "ufo-uia" });
    store.record({ ...baseRow, processName: "chrome.exe", engineId: "browser-use" });
    const wordStats = store.statsByEngine("winword.exe");
    expect(wordStats["ufo-uia"]).toBeTruthy();
    expect(wordStats["browser-use"]).toBeUndefined();
  });

  it("returns empty stats for an unknown process", () => {
    const store = new MemoryTelemetryStore();
    expect(store.statsByEngine("notreal.exe")).toEqual({});
  });

  it("clear() wipes all rows", () => {
    const store = new MemoryTelemetryStore();
    store.record(baseRow);
    store.record(baseRow);
    store.clear();
    expect(store.rowCount()).toBe(0);
    expect(store.recent()).toEqual([]);
  });

  it("running mean updates correctly across many rows", () => {
    const store = new MemoryTelemetryStore();
    for (let i = 1; i <= 100; i++) {
      store.record({ ...baseRow, engineId: "ufo-uia", latencyMs: i, outcome: "success" });
    }
    const stats = store.statsByEngine("winword.exe");
    // 1..100 mean = 50.5
    expect(stats["ufo-uia"]!.avgLatencyMs).toBeCloseTo(50.5, 6);
    expect(stats["ufo-uia"]!.runs).toBe(100);
  });
});

describe("outcomeFromExecResult", () => {
  const okResult: ExecResult = { ok: true, summary: "", steps: [], durationMs: 0 };
  const failResult = (kind: ExecResult extends { ok: false; error: infer E } ? E : never extends infer K
    ? K extends { kind: infer KK }
      ? KK
      : never
    : never): ExecResult =>
    ({ ok: false, error: { kind: kind as never, message: "" }, steps: [], durationMs: 0 });

  it("classifies a fresh success", () => {
    expect(outcomeFromExecResult(okResult, false)).toBe("success");
  });

  it("classifies a success-after-recovery", () => {
    expect(outcomeFromExecResult(okResult, true)).toBe("recovered");
  });

  it("classifies a user-confirmation-required as aborted", () => {
    expect(
      outcomeFromExecResult(
        {
          ok: false,
          error: { kind: "user-confirmation-required", message: "" },
          steps: [],
          durationMs: 0,
        },
        false,
      ),
    ).toBe("aborted");
  });

  it("classifies other failures as failed", () => {
    expect(
      outcomeFromExecResult(
        { ok: false, error: { kind: "recoverable", message: "" }, steps: [], durationMs: 0 },
        false,
      ),
    ).toBe("failed");
    expect(
      outcomeFromExecResult(
        { ok: false, error: { kind: "timeout", message: "" }, steps: [], durationMs: 0 },
        false,
      ),
    ).toBe("failed");
    expect(
      outcomeFromExecResult(
        { ok: false, error: { kind: "fatal", message: "" }, steps: [], durationMs: 0 },
        false,
      ),
    ).toBe("failed");
  });
});
