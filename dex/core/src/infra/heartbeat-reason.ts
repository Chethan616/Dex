import { normalizeOptionalString } from "@dexagent/normalization-core/string-coerce";

export function normalizeHeartbeatWakeReason(reason?: string): string {
  return normalizeOptionalString(reason) ?? "requested";
}
