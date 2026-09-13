/**
 * Scaffold tests for @dexagent/screen-context.
 *
 * Same shape as the file-intel scaffold tests: every facade method
 * returns the safe "not yet implemented" error pointing at H.1 §12.
 */
import { describe, expect, it } from "vitest";
import {
  createScreenContext,
  type Result,
  type ScreenContextError,
} from "./index.js";

function expectNotImplemented<T>(
  result: Result<T, ScreenContextError>,
  surface: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("not-yet-implemented");
    expect(result.error.message).toContain(surface);
    expect(result.error.message).toContain("H.1 verification");
  }
}

describe("createScreenContext scaffold", () => {
  it("returns a facade with all four methods bindable", () => {
    const sc = createScreenContext();
    expect(typeof sc.capture).toBe("function");
    expect(typeof sc.getCachedContext).toBe("function");
    expect(typeof sc.revokePairConsent).toBe("function");
    expect(typeof sc.setAppDenyList).toBe("function");
  });

  it("capture returns a not-yet-implemented error pointing at the gate", async () => {
    expectNotImplemented(
      await createScreenContext().capture({
        sessionId: "test-session",
        timeoutMs: 5_000,
      }),
      "capture",
    );
  });

  it("getCachedContext returns a not-yet-implemented error", async () => {
    expectNotImplemented(
      await createScreenContext().getCachedContext("test-session"),
      "getCachedContext",
    );
  });

  it("revokePairConsent returns a not-yet-implemented error", async () => {
    expectNotImplemented(
      await createScreenContext().revokePairConsent("device-id"),
      "revokePairConsent",
    );
  });

  it("setAppDenyList returns a not-yet-implemented error", async () => {
    expectNotImplemented(
      await createScreenContext().setAppDenyList({
        processes: ["1password.exe"],
        titleSubstrings: ["Login"],
      }),
      "setAppDenyList",
    );
  });

  it("never throws -- facade boundary is exception-free per design", async () => {
    const sc = createScreenContext();
    await sc.capture({ sessionId: "x", timeoutMs: 1 });
    await sc.getCachedContext("x");
    await sc.revokePairConsent("x");
    await sc.setAppDenyList({ processes: [], titleSubstrings: [] });
  });
});
