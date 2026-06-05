import { resolveCommandConfigWithSecrets } from "../../cli/command-config-resolution.js";
import type { RuntimeEnv } from "../../runtime.js";
import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
  setRuntimeConfigSnapshot,
  type DexConfig,
  getModelsCommandSecretTargetIds,
} from "./load-config.runtime.js";

export type LoadedModelsConfig = {
  sourceConfig: DexConfig;
  resolvedConfig: DexConfig;
  diagnostics: string[];
};

export async function loadModelsConfigWithSource(params: {
  commandName: string;
  runtime?: RuntimeEnv;
}): Promise<LoadedModelsConfig> {
  const runtimeConfig = getRuntimeConfig();
  const pinnedSourceConfig = getRuntimeConfigSourceSnapshot();
  const sourceConfig = pinnedSourceConfig ?? runtimeConfig;
  const { resolvedConfig, diagnostics } = await resolveCommandConfigWithSecrets({
    config: runtimeConfig,
    commandName: params.commandName,
    targetIds: getModelsCommandSecretTargetIds(),
    runtime: params.runtime,
  });
  setRuntimeConfigSnapshot(resolvedConfig, sourceConfig);
  return {
    sourceConfig,
    resolvedConfig,
    diagnostics,
  };
}

export async function loadModelsConfig(params: {
  commandName: string;
  runtime?: RuntimeEnv;
}): Promise<DexConfig> {
  return (await loadModelsConfigWithSource(params)).resolvedConfig;
}
