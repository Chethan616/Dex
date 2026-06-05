import type { ChannelDoctorConfigMutation } from "openclaw/plugin-sdk/channel-contract";
import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
import { normalizeCompatibilityConfig as normalizeCompatibilityConfigImpl } from "./doctor.js";

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: DexConfig;
}): ChannelDoctorConfigMutation {
  return normalizeCompatibilityConfigImpl({ cfg });
}
