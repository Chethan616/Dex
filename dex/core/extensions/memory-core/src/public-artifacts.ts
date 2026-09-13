import {
  listMemoryHostPublicArtifacts,
  type MemoryPluginPublicArtifact,
} from "openclaw/plugin-sdk/memory-host-core";
import type { DexConfig } from "../api.js";

export async function listMemoryCorePublicArtifacts(params: {
  cfg: DexConfig;
}): Promise<MemoryPluginPublicArtifact[]> {
  return await listMemoryHostPublicArtifacts(params);
}
