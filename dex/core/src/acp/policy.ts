import { AcpRuntimeError } from "@dexagent/acp-core/runtime/errors";
import type { DexConfig } from "../config/types.openclaw.js";
import { normalizeAgentId } from "../routing/session-key.js";

const ACP_DISABLED_MESSAGE = "ACP is disabled by policy (`acp.enabled=false`).";
const ACP_DISPATCH_DISABLED_MESSAGE =
  "ACP dispatch is disabled by policy (`acp.dispatch.enabled=false`).";

export type AcpDispatchPolicyState = "enabled" | "acp_disabled" | "dispatch_disabled";

export function isAcpEnabledByPolicy(cfg: DexConfig): boolean {
  return cfg.acp?.enabled !== false;
}

export function resolveAcpDispatchPolicyState(cfg: DexConfig): AcpDispatchPolicyState {
  if (!isAcpEnabledByPolicy(cfg)) {
    return "acp_disabled";
  }
  // ACP dispatch is enabled unless explicitly disabled.
  if (cfg.acp?.dispatch?.enabled === false) {
    return "dispatch_disabled";
  }
  return "enabled";
}

export function isAcpDispatchEnabledByPolicy(cfg: DexConfig): boolean {
  return resolveAcpDispatchPolicyState(cfg) === "enabled";
}

export function resolveAcpDispatchPolicyMessage(cfg: DexConfig): string | null {
  const state = resolveAcpDispatchPolicyState(cfg);
  if (state === "acp_disabled") {
    return ACP_DISABLED_MESSAGE;
  }
  if (state === "dispatch_disabled") {
    return ACP_DISPATCH_DISABLED_MESSAGE;
  }
  return null;
}

export function resolveAcpDispatchPolicyError(cfg: DexConfig): AcpRuntimeError | null {
  const message = resolveAcpDispatchPolicyMessage(cfg);
  if (!message) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", message);
}

export function resolveAcpExplicitTurnPolicyError(cfg: DexConfig): AcpRuntimeError | null {
  if (isAcpEnabledByPolicy(cfg)) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", ACP_DISABLED_MESSAGE);
}

export function isAcpAgentAllowedByPolicy(cfg: DexConfig, agentId: string): boolean {
  const allowed = (cfg.acp?.allowedAgents ?? [])
    .map((entry) => normalizeAgentId(entry))
    .filter(Boolean);
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(normalizeAgentId(agentId));
}

export function resolveAcpAgentPolicyError(
  cfg: DexConfig,
  agentId: string,
): AcpRuntimeError | null {
  if (isAcpAgentAllowedByPolicy(cfg, agentId)) {
    return null;
  }
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP agent "${normalizeAgentId(agentId)}" is not allowed by policy.`,
  );
}
