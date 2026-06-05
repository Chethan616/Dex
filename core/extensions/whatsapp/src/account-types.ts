import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<DexConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
