import { getRuntimeConfig } from "../config/config.js";
import type { DexConfig } from "../config/types.openclaw.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import { resolvePluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "./agent-scope.js";
import type { PluginModelCatalogMetadataSnapshot } from "./plugin-model-catalog.js";

export function resolveModelWorkspaceDir(
  cfg: DexConfig | undefined,
  explicitWorkspaceDir: string | undefined,
): string | undefined {
  if (explicitWorkspaceDir !== undefined || !cfg) {
    return explicitWorkspaceDir;
  }
  return resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
}

export function resolveModelPluginMetadataSnapshot(params: {
  allowWorkspaceScopedCurrent?: boolean;
  config?: DexConfig;
  env?: NodeJS.ProcessEnv;
  pluginMetadataSnapshot?: PluginModelCatalogMetadataSnapshot;
  useRuntimeConfig?: boolean;
  workspaceDir?: string;
}): PluginModelCatalogMetadataSnapshot | undefined {
  if (params.pluginMetadataSnapshot) {
    return params.pluginMetadataSnapshot;
  }
  const env = params.env ?? process.env;
  try {
    const config = params.config ?? (params.useRuntimeConfig ? getRuntimeConfig() : undefined);
    return (
      getCurrentPluginMetadataSnapshot({
        allowWorkspaceScopedSnapshot: true,
        env,
        ...(config ? { config } : {}),
        ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
      }) ??
      resolvePluginMetadataSnapshot({
        config: config ?? {},
        env,
        ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
        ...(params.allowWorkspaceScopedCurrent !== undefined
          ? { allowWorkspaceScopedCurrent: params.allowWorkspaceScopedCurrent }
          : {}),
      })
    );
  } catch {
    return undefined;
  }
}
