import type { DexConfig } from "../config/types.openclaw.js";
import type { RegisteredMemorySearchManager } from "../plugins/memory-state.js";

type ActiveMemorySearchPurpose = "default" | "status";

export type ActiveMemorySearchManagerResult = {
  manager: RegisteredMemorySearchManager | null;
  error?: string;
};

type MemoryHostSearchRuntimeModule = typeof import("./memory-host-search.runtime.js");

async function loadMemoryHostSearchRuntime(): Promise<MemoryHostSearchRuntimeModule> {
  return await import("./memory-host-search.runtime.js");
}

export async function getActiveMemorySearchManager(params: {
  cfg: DexConfig;
  agentId: string;
  purpose?: ActiveMemorySearchPurpose;
}): Promise<ActiveMemorySearchManagerResult> {
  const runtime = await loadMemoryHostSearchRuntime();
  return await runtime.getActiveMemorySearchManager(params);
}

export async function closeActiveMemorySearchManagers(cfg?: DexConfig): Promise<void> {
  const runtime = await loadMemoryHostSearchRuntime();
  await runtime.closeActiveMemorySearchManagers(cfg);
}

export async function closeActiveMemorySearchManager(params: {
  cfg: DexConfig;
  agentId: string;
}): Promise<void> {
  const runtime = await loadMemoryHostSearchRuntime();
  await runtime.closeActiveMemorySearchManager(params);
}
