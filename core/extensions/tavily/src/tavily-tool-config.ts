import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
import type { DexPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import type { DexPluginApi } from "openclaw/plugin-sdk/plugin-runtime";

export type TavilyToolConfigContext = Pick<
  DexPluginToolContext,
  "config" | "runtimeConfig" | "getRuntimeConfig"
>;

export function resolveTavilyToolConfig(
  api: DexPluginApi,
  ctx?: TavilyToolConfigContext,
): DexConfig {
  return ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
}
