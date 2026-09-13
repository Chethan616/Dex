import type { DexConfig } from "../config/types.openclaw.js";
import type {
  PluginWebSearchProviderEntry,
  WebSearchProviderToolDefinition,
} from "../plugins/web-provider-types.js";
import type { RuntimeWebSearchMetadata } from "../secrets/runtime-web-tools.types.js";

type WebSearchConfig = NonNullable<DexConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

export type ResolveWebSearchDefinitionParams = {
  config?: DexConfig;
  agentDir?: string;
  sandboxed?: boolean;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  preferRuntimeProviders?: boolean;
  preferInputConfig?: boolean;
};

export type RunWebSearchParams = ResolveWebSearchDefinitionParams & {
  args: Record<string, unknown>;
  signal?: AbortSignal;
};

export type RunWebSearchResult = {
  provider: string;
  result: Record<string, unknown>;
};

export type ListWebSearchProvidersParams = {
  config?: DexConfig;
};

export type RuntimeWebSearchProviderEntry = PluginWebSearchProviderEntry;
export type RuntimeWebSearchToolDefinition = WebSearchProviderToolDefinition;
export type RuntimeWebSearchConfig = WebSearchConfig;
