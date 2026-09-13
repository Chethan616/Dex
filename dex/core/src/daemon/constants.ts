import { normalizeLowercaseStringOrEmpty } from "@dexagent/normalization-core/string-coerce";

// Default service labels (canonical + legacy compatibility)
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.openclaw.gateway";
export const GATEWAY_SYSTEMD_SERVICE_NAME = "openclaw-gateway";
export const GATEWAY_WINDOWS_TASK_NAME = "Dex Gateway";
// Pre-rename installs (<= 2026.6.20) registered the Windows task under the
// OpenClaw name; install/uninstall paths clean these up so the legacy task
// never keeps launching a second gateway alongside the Dex-named one.
export const LEGACY_GATEWAY_WINDOWS_TASK_NAME_PREFIX = "OpenClaw Gateway";
export const GATEWAY_SERVICE_MARKER = "openclaw";
export const GATEWAY_SERVICE_KIND = "gateway";
export const GATEWAY_SERVICE_RUNTIME_PID_ENV = "DEX_GATEWAY_SERVICE_PID";
const NODE_LAUNCH_AGENT_LABEL = "ai.openclaw.node";
const NODE_SYSTEMD_SERVICE_NAME = "openclaw-node";
const NODE_WINDOWS_TASK_NAME = "Dex Node";
export const LEGACY_NODE_WINDOWS_TASK_NAME_PREFIX = "OpenClaw Node";
export const NODE_SERVICE_MARKER = "openclaw";
export const NODE_SERVICE_KIND = "node";
export const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = ["clawdbot-gateway"];

/**
 * Map a pre-rename (<= 2026.6.20) Windows task name onto its Dex equivalent,
 * preserving any profile suffix ("OpenClaw Gateway (work)" -> "Dex Gateway
 * (work)"). Persisted service scripts from old installs carry the OpenClaw
 * name as a DEX_WINDOWS_TASK_NAME override; honoring it verbatim would keep
 * re-registering the legacy task forever and skip the legacy-task cleanup.
 */
export function migrateLegacyWindowsTaskName(name: string): string {
  if (name.startsWith(LEGACY_GATEWAY_WINDOWS_TASK_NAME_PREFIX)) {
    return `${GATEWAY_WINDOWS_TASK_NAME}${name.slice(LEGACY_GATEWAY_WINDOWS_TASK_NAME_PREFIX.length)}`;
  }
  if (name.startsWith(LEGACY_NODE_WINDOWS_TASK_NAME_PREFIX)) {
    return `${NODE_WINDOWS_TASK_NAME}${name.slice(LEGACY_NODE_WINDOWS_TASK_NAME_PREFIX.length)}`;
  }
  return name;
}

export function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || normalizeLowercaseStringOrEmpty(trimmed) === "default") {
    return null;
  }
  return trimmed;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.openclaw.${normalized}`;
}

export function resolveLegacyGatewayLaunchAgentLabels(profile?: string): string[] {
  void profile;
  return [];
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    return GATEWAY_SYSTEMD_SERVICE_NAME;
  }
  return `openclaw-gateway${suffix}`;
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `${GATEWAY_WINDOWS_TASK_NAME} (${normalized})`;
}

export function formatGatewayServiceDescription(params?: {
  profile?: string;
  version?: string;
}): string {
  const profile = normalizeGatewayProfile(params?.profile);
  const version = params?.version?.trim();
  const parts: string[] = [];
  if (profile) {
    parts.push(`profile: ${profile}`);
  }
  if (version) {
    parts.push(`v${version}`);
  }
  if (parts.length === 0) {
    return "Dex Gateway";
  }
  return `Dex Gateway (${parts.join(", ")})`;
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  environment?: Record<string, string | undefined>;
  description?: string;
}): string {
  return (
    params.description ??
    formatGatewayServiceDescription({
      profile: params.env.DEX_PROFILE,
      version: params.environment?.DEX_SERVICE_VERSION ?? params.env.DEX_SERVICE_VERSION,
    })
  );
}

export function resolveNodeLaunchAgentLabel(): string {
  return NODE_LAUNCH_AGENT_LABEL;
}

export function resolveNodeSystemdServiceName(): string {
  return NODE_SYSTEMD_SERVICE_NAME;
}

export function resolveNodeWindowsTaskName(): string {
  return NODE_WINDOWS_TASK_NAME;
}

export function formatNodeServiceDescription(params?: { version?: string }): string {
  const version = params?.version?.trim();
  if (!version) {
    return "Dex Node Host";
  }
  return `Dex Node Host (v${version})`;
}
