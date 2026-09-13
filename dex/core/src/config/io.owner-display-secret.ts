import type { DexConfig } from "./types.openclaw.js";

export type OwnerDisplaySecretRuntimeState = {
  pendingByPath: Map<string, string>;
};

export function retainGeneratedOwnerDisplaySecret(params: {
  config: DexConfig;
  configPath: string;
  generatedSecret?: string;
  state: OwnerDisplaySecretRuntimeState;
}): DexConfig {
  const { config, configPath, generatedSecret, state } = params;
  if (!generatedSecret) {
    state.pendingByPath.delete(configPath);
    return config;
  }

  state.pendingByPath.set(configPath, generatedSecret);
  return config;
}
