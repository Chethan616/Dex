/**
 * Built-in automation engines — Dex ships its own hands.
 *
 * UFO² (native Windows UIA) and browser-use (web pages in the user's
 * own browser) are part of the FRAMEWORK, not user configuration:
 * when their runtimes resolve on this machine, the gateway registers
 * them as bundle-MCP servers automatically — `npm i -g dexagent` or
 * the Dex installer yields a complete agentic stack with zero MCP
 * registration. This is the product line that separates Dex from a
 * plain OpenClaw deployment.
 *
 * Layering (see bundle-mcp-config.ts):
 *     builtin engines  <  plugin bundle servers  <  user mcp.servers
 * so a user entry with the same name overrides everything, and an
 * `enabled: false` user entry disables a builtin without new config
 * surface.
 *
 * Resolution (each engine registers only when ALL its pieces exist):
 *   drivers dir: DEX_DRIVERS_DIR → <pkgRoot>/drivers (the drivers now
 *                live INSIDE the package at dex/core/drivers, so this
 *                covers dev, npm, and the MSI's runtime/dexagent/drivers)
 *                → <pkgRoot>/../drivers (legacy/defensive fallback)
 *   venv python: DEX_UFO_PYTHON / DEX_BROWSER_PYTHON → vendor/<x>/.venv
 *                walking 1-3 levels up from the drivers dir (covers the
 *                MSI runtime/vendor and the dev repo-root vendor) →
 *                ~/.dex/engines/<x>/.venv (the `dex engines setup` home)
 *
 * Product defaults are BAKED IN here — request timeouts sized to the
 * drivers' own task caps, browser provider/model, and the Gemini key
 * injected from `models.providers.google.apiKey` (the single key the
 * Dex app's Secrets panel writes).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DexConfig } from "../config/types.openclaw.js";
import type { BundleMcpServerConfig } from "../plugins/bundle-mcp.js";

export type BuiltinEngineStatus = {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
};

/** Walk up from this module until the dexagent package root. */
function resolvePackageRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const name = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string }).name;
        if (name === "dexagent" || name === "openclaw") {
          return dir;
        }
      } catch {
        // unreadable package.json -- keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function resolveDriversBase(): string | null {
  const fromEnv = process.env.DEX_DRIVERS_DIR?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const pkgRoot = resolvePackageRoot();
  if (!pkgRoot) {
    return null;
  }
  for (const candidate of [
    path.join(pkgRoot, "drivers"),
    path.join(path.dirname(pkgRoot), "drivers"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveVenvPython(driversBase: string, vendorName: string, envVar: string): string | null {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  // Walk 1-3 levels up from the drivers dir looking for vendor/<x>/.venv.
  // Drivers now sit at dex/core/drivers (dev) / dexagent/drivers (npm,
  // MSI), so the vendor tree can be 1 (MSI runtime/vendor), 2, or 3
  // (dev repo-root vendor) levels up depending on layout.
  let base = driversBase;
  for (let i = 0; i < 3; i += 1) {
    base = path.dirname(base);
    const python = path.join(base, "vendor", vendorName, ".venv", "Scripts", "python.exe");
    if (fs.existsSync(python)) {
      return python;
    }
  }
  // npm install: drivers ship in the package but the heavy venv does
  // not. `dex engines setup` places it in this stable user-data home,
  // independent of where the package lives.
  const enginesHome = path.join(
    os.homedir(),
    ".dex",
    "engines",
    vendorName,
    ".venv",
    "Scripts",
    "python.exe",
  );
  return fs.existsSync(enginesHome) ? enginesHome : null;
}

function resolveGoogleApiKey(cfg?: DexConfig): string | undefined {
  const models = (cfg as { models?: { providers?: Record<string, { apiKey?: unknown }> } })
    ?.models;
  const key = models?.providers?.google?.apiKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

/**
 * Builtin engine server map for this machine. Engines whose runtimes
 * don't resolve are omitted (callers may surface `statuses` for
 * doctor/log output).
 */
export function resolveBuiltinEngineServers(cfg?: DexConfig): {
  servers: Record<string, BundleMcpServerConfig>;
  statuses: BuiltinEngineStatus[];
} {
  const servers: Record<string, BundleMcpServerConfig> = {};
  const statuses: BuiltinEngineStatus[] = [];

  if (process.platform !== "win32") {
    return { servers, statuses };
  }

  const driversBase = resolveDriversBase();
  if (!driversBase) {
    statuses.push(
      { id: "windows-desktop-control", label: "desktop (UFO²)", available: false, reason: "drivers dir not found" },
      { id: "browser-control", label: "browser (browser-use)", available: false, reason: "drivers dir not found" },
    );
    return { servers, statuses };
  }

  const desktopServer = path.join(driversBase, "windows-desktop-control", "server.py");
  const desktopPython = resolveVenvPython(driversBase, "UFO", "DEX_UFO_PYTHON");
  if (fs.existsSync(desktopServer) && desktopPython) {
    // The driver defaults UFO_ROOT to <repo>/vendor/UFO, but the venv may
    // live elsewhere (npm: ~/.dex/engines/UFO/.venv). UFO root is the
    // grandparent of the venv python (<root>/.venv/Scripts/python.exe), so
    // tell the driver where UFO actually is via DEX_UFO_ROOT.
    const ufoRoot =
      process.env.DEX_UFO_ROOT?.trim() ||
      path.dirname(path.dirname(path.dirname(desktopPython)));
    servers["windows-desktop-control"] = {
      command: desktopPython,
      args: [desktopServer],
      cwd: path.dirname(desktopServer),
      // run_desktop_task caps itself at 600s with a 300s default; the
      // MCP request must outlive the driver's own budget or the
      // gateway kills legit runs mid-task (observed 2026-06-11).
      requestTimeoutMs: 330_000,
      env: { DEX_UFO_ROOT: ufoRoot },
    } as BundleMcpServerConfig;
    statuses.push({ id: "windows-desktop-control", label: "desktop (UFO²)", available: true });
  } else {
    statuses.push({
      id: "windows-desktop-control",
      label: "desktop (UFO²)",
      available: false,
      reason: desktopPython ? "server.py missing" : "UFO venv not found",
    });
  }

  const browserServer = path.join(driversBase, "browser-control", "server.py");
  const browserPython = resolveVenvPython(driversBase, "browser-use", "DEX_BROWSER_PYTHON");
  if (fs.existsSync(browserServer) && browserPython) {
    const geminiKey = resolveGoogleApiKey(cfg) ?? process.env.GEMINI_API_KEY;
    servers["browser-control"] = {
      command: browserPython,
      args: [browserServer],
      cwd: path.dirname(browserServer),
      requestTimeoutMs: 210_000,
      env: {
        DEX_BROWSER_PROVIDER: process.env.DEX_BROWSER_PROVIDER ?? "google",
        DEX_BROWSER_MODEL: process.env.DEX_BROWSER_MODEL ?? "gemini-2.5-flash-lite",
        ...(geminiKey ? { GEMINI_API_KEY: geminiKey } : {}),
      },
    } as BundleMcpServerConfig;
    statuses.push({ id: "browser-control", label: "browser (browser-use)", available: true });
  } else {
    statuses.push({
      id: "browser-control",
      label: "browser (browser-use)",
      available: false,
      reason: browserPython ? "server.py missing" : "browser-use venv not found",
    });
  }

  return { servers, statuses };
}
