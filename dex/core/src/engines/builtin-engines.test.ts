import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fs.existsSync is the only host probe the resolver makes; drive it per-test.
const existsSync = vi.hoisted(() => vi.fn<(p: string) => boolean>());
vi.mock("node:fs", () => ({ default: { existsSync }, existsSync }));

import { resolveBuiltinEngineServers } from "./builtin-engines.js";

const realPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("resolveBuiltinEngineServers", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    existsSync.mockReset();
    delete process.env.DEX_DRIVERS_DIR;
    delete process.env.DEX_UFO_PYTHON;
    delete process.env.DEX_BROWSER_PYTHON;
  });

  afterEach(() => {
    setPlatform(realPlatform);
    process.env = { ...savedEnv };
  });

  it("registers both engines when drivers + venvs resolve via env", () => {
    setPlatform("win32");
    process.env.DEX_DRIVERS_DIR = "C:/dex/runtime/drivers";
    process.env.DEX_UFO_PYTHON = "C:/dex/runtime/vendor/UFO/.venv/Scripts/python.exe";
    process.env.DEX_BROWSER_PYTHON =
      "C:/dex/runtime/vendor/browser-use/.venv/Scripts/python.exe";
    // drivers dir, both server.py files, and both venv pythons all present.
    existsSync.mockReturnValue(true);

    const { servers, statuses } = resolveBuiltinEngineServers({
      models: { providers: { google: { apiKey: "AIza-test" } } },
    } as never);

    expect(servers).toHaveProperty("windows-desktop-control");
    expect(servers).toHaveProperty("browser-control");
    expect(servers["windows-desktop-control"].requestTimeoutMs).toBe(330_000);
    expect(servers["browser-control"].requestTimeoutMs).toBe(210_000);
    // The single Gemini key the Secrets panel writes is injected into the
    // browser engine's env so no separate registration is needed.
    expect((servers["browser-control"].env as Record<string, string>).GEMINI_API_KEY).toBe(
      "AIza-test",
    );
    expect(statuses.every((s) => s.available)).toBe(true);
  });

  it("returns nothing on non-Windows platforms", () => {
    setPlatform("linux");
    existsSync.mockReturnValue(true);

    const { servers, statuses } = resolveBuiltinEngineServers();

    expect(Object.keys(servers)).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it("marks both engines unavailable when the drivers dir cannot be found", () => {
    setPlatform("win32");
    existsSync.mockReturnValue(false);

    const { servers, statuses } = resolveBuiltinEngineServers();

    expect(Object.keys(servers)).toHaveLength(0);
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => !s.available && s.reason === "drivers dir not found")).toBe(
      true,
    );
  });
});
