import type { DexConfig } from "../config/types.openclaw.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  requireValidConfigFileSnapshot as requireValidConfigFileSnapshotBase,
  requireValidConfigSnapshot,
} from "./config-validation.js";

export function createQuietRuntime(runtime: RuntimeEnv): RuntimeEnv {
  return { ...runtime, log: () => {} };
}

export async function requireValidConfigFileSnapshot(runtime: RuntimeEnv) {
  return await requireValidConfigFileSnapshotBase(runtime);
}

export async function requireValidConfig(runtime: RuntimeEnv): Promise<DexConfig | null> {
  return await requireValidConfigSnapshot(runtime);
}
