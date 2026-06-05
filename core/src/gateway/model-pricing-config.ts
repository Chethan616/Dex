import type { DexConfig } from "../config/types.openclaw.js";

export function isGatewayModelPricingEnabled(config: DexConfig): boolean {
  return config.models?.pricing?.enabled !== false;
}
