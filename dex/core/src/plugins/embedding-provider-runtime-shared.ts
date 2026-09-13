import { normalizeProviderId } from "@dexagent/model-catalog-core/provider-id";
import type { DexConfig } from "../config/types.openclaw.js";
import {
  resolvePluginCapabilityProvider,
  resolvePluginCapabilityProviders,
} from "./capability-provider-runtime.js";

type EmbeddingProviderCapabilityKey = "embeddingProviders" | "memoryEmbeddingProviders";
type RegisteredAdapterEntry<TAdapter> = {
  adapter: TAdapter;
};
type ConfiguredModelProvider = NonNullable<
  NonNullable<DexConfig["models"]>["providers"]
>[string];

function resolveConfiguredProviderConfig(
  providerId: string,
  cfg?: DexConfig,
): ConfiguredModelProvider | undefined {
  const providers = cfg?.models?.providers;
  if (!providers) {
    return undefined;
  }
  const normalized = normalizeProviderId(providerId);
  return (
    providers[providerId] ??
    Object.entries(providers).find(
      ([candidateId]) => normalizeProviderId(candidateId) === normalized,
    )?.[1]
  );
}

export function readConfiguredProviderApiId(params: {
  providerId: string;
  cfg?: DexConfig;
  resolveApiProviderId?: (normalizedApiId: string) => string | undefined;
  resolveMissingApiProviderId?: (providerConfig: ConfiguredModelProvider) => string | undefined;
}): string | undefined {
  const providerConfig = resolveConfiguredProviderConfig(params.providerId, params.cfg);
  if (!providerConfig) {
    return undefined;
  }
  const normalized = normalizeProviderId(params.providerId);
  const api = providerConfig.api?.trim();
  const resolvedProviderId = api
    ? (params.resolveApiProviderId?.(normalizeProviderId(api)) ?? normalizeProviderId(api))
    : params.resolveMissingApiProviderId?.(providerConfig);
  return resolvedProviderId && resolvedProviderId !== normalized ? resolvedProviderId : undefined;
}

export function resolveRuntimeEmbeddingProviderLookupIds(params: {
  id: string;
  cfg?: DexConfig;
  resolveConfiguredProviderId: (id: string, cfg?: DexConfig) => string | undefined;
}): string[] {
  const ids = [params.id];
  const configuredProviderId = params.resolveConfiguredProviderId(params.id, params.cfg);
  if (
    configuredProviderId &&
    !ids.some((candidate) => normalizeProviderId(candidate) === configuredProviderId)
  ) {
    ids.push(configuredProviderId);
  }
  return ids;
}

export function listRuntimeEmbeddingProviderAdapters<TAdapter extends { id: string }>(params: {
  key: EmbeddingProviderCapabilityKey;
  cfg?: DexConfig;
  registered: TAdapter[];
}): TAdapter[] {
  const merged = new Map(params.registered.map((adapter) => [adapter.id, adapter]));
  const capabilityAdapters = resolvePluginCapabilityProviders({
    key: params.key,
    cfg: params.cfg,
  }) as unknown as TAdapter[];
  for (const adapter of capabilityAdapters) {
    if (!merged.has(adapter.id)) {
      merged.set(adapter.id, adapter);
    }
  }
  return [...merged.values()];
}

export function getRuntimeEmbeddingProviderAdapter<TAdapter extends { id: string }>(params: {
  key: EmbeddingProviderCapabilityKey;
  cfg?: DexConfig;
  lookupIds: string[];
  getRegisteredProvider: (id: string) => RegisteredAdapterEntry<TAdapter> | undefined;
}): TAdapter | undefined {
  for (const candidateId of params.lookupIds) {
    const registered = params.getRegisteredProvider(candidateId);
    if (registered) {
      return registered.adapter;
    }
  }
  for (const candidateId of params.lookupIds) {
    const provider = resolvePluginCapabilityProvider({
      key: params.key,
      providerId: candidateId,
      cfg: params.cfg,
    }) as TAdapter | undefined;
    if (provider) {
      return provider;
    }
  }
  return undefined;
}
