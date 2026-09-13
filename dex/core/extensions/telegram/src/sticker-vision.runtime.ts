import {
  findModelInCatalog,
  loadModelCatalog,
  modelSupportsVision,
  resolveDefaultModelForAgent,
} from "openclaw/plugin-sdk/agent-runtime";
import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

export async function resolveStickerVisionSupportRuntime(params: {
  cfg: DexConfig;
  agentId?: string;
}): Promise<boolean> {
  const catalog = await loadModelCatalog({ config: params.cfg });
  const defaultModel = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const entry = findModelInCatalog(catalog, defaultModel.provider, defaultModel.model);
  if (!entry) {
    return false;
  }
  return modelSupportsVision(entry);
}
