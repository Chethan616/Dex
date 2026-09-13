import { sortUniqueStrings } from "@dexagent/normalization-core/string-normalization";
import type { DexConfig } from "../config/types.openclaw.js";
import { isInstalledPluginEnabled } from "./installed-plugin-index.js";
import type { PluginManifestContractListKey, PluginManifestRecord } from "./manifest-registry.js";
import { resolvePluginMetadataSnapshot } from "./plugin-metadata-snapshot.js";
import type {
  PluginMetadataManifestView,
  PluginMetadataRegistryView,
  PluginMetadataSnapshot,
} from "./plugin-metadata-snapshot.types.js";

export function isManifestPluginAvailableForControlPlane(params: {
  snapshot: Pick<PluginMetadataSnapshot, "index">;
  plugin: Pick<
    PluginManifestRecord,
    "id" | "origin" | "enabledByDefault" | "enabledByDefaultOnPlatforms"
  >;
  config?: DexConfig;
}): boolean {
  if (params.plugin.origin === "bundled") {
    return true;
  }
  return isInstalledPluginEnabled(params.snapshot.index, params.plugin.id, params.config);
}

export function hasManifestContractValue(params: {
  plugin: Pick<PluginManifestRecord, "contracts">;
  contract: PluginManifestContractListKey;
  value?: string;
}): boolean {
  const values = params.plugin.contracts?.[params.contract] ?? [];
  return values.length > 0 && (!params.value || values.includes(params.value));
}

export function listAvailableManifestContractPlugins(params: {
  snapshot: Pick<PluginMetadataSnapshot, "index" | "plugins">;
  contract: PluginManifestContractListKey;
  value?: string;
  config?: DexConfig;
}): PluginManifestRecord[] {
  return params.snapshot.plugins.filter(
    (plugin) =>
      hasManifestContractValue({
        plugin,
        contract: params.contract,
        value: params.value,
      }) &&
      isManifestPluginAvailableForControlPlane({
        snapshot: params.snapshot,
        plugin,
        config: params.config,
      }),
  );
}

export function listAvailableManifestContractValues(params: {
  snapshot: Pick<PluginMetadataSnapshot, "index" | "plugins">;
  contract: PluginManifestContractListKey;
  config?: DexConfig;
}): string[] {
  const values = new Set<string>();
  for (const plugin of listAvailableManifestContractPlugins(params)) {
    for (const value of plugin.contracts?.[params.contract] ?? []) {
      values.add(value);
    }
  }
  return sortUniqueStrings(values);
}

export function loadManifestContractSnapshot(params: {
  config?: DexConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): PluginMetadataManifestView {
  const snapshot = loadManifestMetadataSnapshot(params);
  return {
    index: snapshot.index,
    plugins: snapshot.plugins,
  };
}

export function loadManifestMetadataRegistry(params: {
  config?: DexConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): PluginMetadataRegistryView {
  const snapshot = loadManifestMetadataSnapshot(params);
  return {
    index: snapshot.index,
    manifestRegistry: snapshot.manifestRegistry,
  };
}

export function loadManifestMetadataSnapshot(params: {
  config?: DexConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): PluginMetadataSnapshot {
  const config = params.config ?? {};
  const env = params.env ?? process.env;
  return resolvePluginMetadataSnapshot({
    config,
    env,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    allowWorkspaceScopedCurrent: params.workspaceDir === undefined,
  });
}
