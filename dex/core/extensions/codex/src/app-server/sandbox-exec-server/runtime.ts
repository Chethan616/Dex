import type { SandboxContext } from "openclaw/plugin-sdk/sandbox";
import type { DexExecServer } from "./types.js";

export function requireBackend(
  execServer: DexExecServer,
): NonNullable<SandboxContext["backend"]> {
  const backend = execServer.sandbox.backend;
  if (!backend) {
    throw new Error("OpenClaw sandbox backend is unavailable.");
  }
  return backend;
}

export function requireFsBridge(
  execServer: DexExecServer,
): NonNullable<SandboxContext["fsBridge"]> {
  const fsBridge = execServer.sandbox.fsBridge;
  if (!fsBridge) {
    throw new Error("Sandbox filesystem bridge is unavailable.");
  }
  return fsBridge;
}
