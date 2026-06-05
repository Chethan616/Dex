import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";
import { resolveBundledProviderPolicySurface } from "../plugins/provider-public-artifacts.js";
import type { ModelProviderConfig, DexConfig } from "./types.js";

export function normalizeProviderConfigForConfigDefaults(params: {
  provider: string;
  providerConfig: ModelProviderConfig;
  manifestRegistry?: Pick<PluginManifestRegistry, "plugins">;
}): ModelProviderConfig {
  const normalized = resolveBundledProviderPolicySurface(params.provider, {
    manifestRegistry: params.manifestRegistry,
  })?.normalizeConfig?.({
    provider: params.provider,
    providerConfig: params.providerConfig,
  });
  return normalized && normalized !== params.providerConfig ? normalized : params.providerConfig;
}

export function applyProviderConfigDefaultsForConfig(params: {
  provider: string;
  config: DexConfig;
  env: NodeJS.ProcessEnv;
  manifestRegistry?: Pick<PluginManifestRegistry, "plugins">;
}): DexConfig {
  return (
    resolveBundledProviderPolicySurface(params.provider, {
      manifestRegistry: params.manifestRegistry,
    })?.applyConfigDefaults?.({
      provider: params.provider,
      config: params.config,
      env: params.env,
    }) ?? params.config
  );
}
