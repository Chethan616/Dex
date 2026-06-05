import {
  applyAgentDefaultModelPrimary,
  type DexConfig,
} from "openclaw/plugin-sdk/provider-onboard";

export const OPENCODE_GO_DEFAULT_MODEL_REF = "opencode-go/kimi-k2.6";

export function applyOpencodeGoProviderConfig(cfg: DexConfig): DexConfig {
  return cfg;
}

export function applyOpencodeGoConfig(cfg: DexConfig): DexConfig {
  return applyAgentDefaultModelPrimary(
    applyOpencodeGoProviderConfig(cfg),
    OPENCODE_GO_DEFAULT_MODEL_REF,
  );
}
