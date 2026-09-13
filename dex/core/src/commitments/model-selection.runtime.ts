import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import type { DexConfig } from "../config/config.js";

export function resolveCommitmentDefaultModelRef(params: {
  cfg: DexConfig;
  agentId?: string;
}): { provider: string; model: string } {
  return resolveDefaultModelForAgent(params);
}
