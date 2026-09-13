import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { DexConfig } from "../config/types.openclaw.js";
import { resolveBuiltinEngineServers } from "../engines/builtin-engines.js";
import {
  loadEnabledBundleMcpConfig,
  type BundleMcpConfig,
  type BundleMcpDiagnostic,
  type BundleMcpServerConfig,
} from "../plugins/bundle-mcp.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";

type MergedBundleMcpConfig = {
  config: BundleMcpConfig;
  diagnostics: BundleMcpDiagnostic[];
};

type BundleMcpServerMapper = (server: BundleMcpServerConfig, name: string) => BundleMcpServerConfig;

const DEX_TRANSPORT_TO_CLI_BUNDLE_TYPE: Record<string, string> = {
  "streamable-http": "http",
  http: "http",
  sse: "sse",
  stdio: "stdio",
};

/**
 * User config stores OpenClaw MCP transport names, while CLI backends such as
 * Claude Code and Gemini expect a downstream `type` field. Keep this adapter
 * out of the generic merge path because embedded OpenClaw still consumes the raw
 * OpenClaw `transport` shape directly.
 */
export function toCliBundleMcpServerConfig(server: BundleMcpServerConfig): BundleMcpServerConfig {
  const next = { ...server } as Record<string, unknown>;
  const rawTransport = next.transport;
  delete next.transport;
  if (typeof next.type === "string") {
    return next as BundleMcpServerConfig;
  }
  if (typeof rawTransport === "string") {
    const mapped = DEX_TRANSPORT_TO_CLI_BUNDLE_TYPE[rawTransport];
    if (mapped) {
      next.type = mapped;
    }
  }
  return next as BundleMcpServerConfig;
}

export function loadMergedBundleMcpConfig(params: {
  workspaceDir: string;
  cfg?: DexConfig;
  manifestRegistry?: Pick<PluginManifestRegistry, "plugins">;
  mapConfiguredServer?: BundleMcpServerMapper;
}): MergedBundleMcpConfig {
  const bundleMcp = loadEnabledBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
    manifestRegistry: params.manifestRegistry,
  });
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  const disabledConfiguredNames = new Set(
    Object.entries(configuredMcp)
      .filter(([, server]) => server.enabled === false)
      .map(([name]) => name),
  );
  const enabledConfiguredMcp = Object.fromEntries(
    Object.entries(configuredMcp).filter(([, server]) => server.enabled !== false),
  );
  const enabledBundleMcp = Object.fromEntries(
    Object.entries(bundleMcp.config.mcpServers).filter(
      ([name]) => !disabledConfiguredNames.has(name),
    ),
  );
  // Builtin automation engines (UFO² / browser-use) self-register when
  // their runtimes resolve on this machine -- Dex ships its own hands.
  // Lowest-precedence layer: plugins and user config both override, and
  // a same-name user entry with enabled:false disables a builtin.
  const builtinEngines = Object.fromEntries(
    Object.entries(resolveBuiltinEngineServers(params.cfg).servers).filter(
      ([name]) => !disabledConfiguredNames.has(name),
    ),
  );
  const mapConfiguredServer = params.mapConfiguredServer ?? ((server) => server);

  return {
    config: {
      // Precedence: builtin engines < plugin bundle servers < user config
      // (the owner-managed layer always wins).
      mcpServers: {
        ...builtinEngines,
        ...enabledBundleMcp,
        ...Object.fromEntries(
          Object.entries(enabledConfiguredMcp).map(([name, server]) => [
            name,
            mapConfiguredServer(server as BundleMcpServerConfig, name),
          ]),
        ),
      } satisfies BundleMcpConfig["mcpServers"],
    },
    diagnostics: bundleMcp.diagnostics,
  };
}
