import { normalizeOptionalString } from "@dexagent/normalization-core/string-coerce";
import { isEnvironmentFileOnlySource } from "../daemon/service-managed-env.js";
import type { GatewayServiceEnvironmentValueSource } from "../daemon/service-types.js";

export const testServiceAuditCodes = {
  gatewayCommandMissing: "gateway-command-missing",
  gatewayEntrypointMismatch: "gateway-entrypoint-mismatch",
  gatewayManagedEnvEmbedded: "gateway-managed-env-embedded",
  gatewayPortMismatch: "gateway-port-mismatch",
  gatewayProxyEnvEmbedded: "gateway-proxy-env-embedded",
  gatewayTokenMismatch: "gateway-token-mismatch",
} as const;

export function readEmbeddedGatewayTokenForTest(
  command: {
    environment?: Record<string, string>;
    environmentValueSources?: Record<string, GatewayServiceEnvironmentValueSource>;
  } | null,
) {
  return isEnvironmentFileOnlySource(command?.environmentValueSources?.DEX_GATEWAY_TOKEN)
    ? undefined
    : normalizeOptionalString(command?.environment?.DEX_GATEWAY_TOKEN);
}
