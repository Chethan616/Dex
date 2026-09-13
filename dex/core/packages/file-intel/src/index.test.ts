/**
 * Scaffold tests for @dexagent/file-intel.
 *
 * Verifies the contract surface: every facade method returns a
 * "not yet implemented" error (the safe stub) so accidental usage in
 * production fails loudly with a clear pointer at G.1's verification
 * gate.
 *
 * When G.3+ lands real implementations, these tests get rewritten to
 * assert real behavior.
 */
import { describe, expect, it } from "vitest";
import { createFileIntel, type FileIntelError, type Result } from "./index.js";

function expectNotImplemented<T>(result: Result<T, FileIntelError>, surface: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("not-yet-implemented");
    expect(result.error.message).toContain(surface);
    expect(result.error.message).toContain("G.1 verification");
  }
}

describe("createFileIntel scaffold", () => {
  it("returns a facade with all 8 methods bindable", () => {
    const fi = createFileIntel();
    expect(typeof fi.start).toBe("function");
    expect(typeof fi.stop).toBe("function");
    expect(typeof fi.pause).toBe("function");
    expect(typeof fi.resume).toBe("function");
    expect(typeof fi.search).toBe("function");
    expect(typeof fi.getByPath).toBe("function");
    expect(typeof fi.reindex).toBe("function");
    expect(typeof fi.forget).toBe("function");
  });

  it("start returns a not-yet-implemented error pointing at the gate", async () => {
    expectNotImplemented(await createFileIntel().start(), "start");
  });

  it("stop returns a not-yet-implemented error", async () => {
    expectNotImplemented(await createFileIntel().stop(), "stop");
  });

  it("search returns a not-yet-implemented error", async () => {
    expectNotImplemented(
      await createFileIntel().search({
        text: "find my aadhaar card",
        scope: { kind: "local" },
      }),
      "search",
    );
  });

  it("getByPath returns a not-yet-implemented error", async () => {
    expectNotImplemented(
      await createFileIntel().getByPath("C:/Users/cheth/Documents/aadhaar.pdf"),
      "getByPath",
    );
  });

  it("never throws -- facade boundary is exception-free per design", async () => {
    const fi = createFileIntel();
    // No try/catch: if any method throws, this test fails.
    await fi.start();
    await fi.stop();
    await fi.pause();
    await fi.resume();
    await fi.search({ text: "x", scope: { kind: "local" } });
    await fi.getByPath("/x");
    await fi.reindex("/x");
    await fi.forget("/x");
  });
});
