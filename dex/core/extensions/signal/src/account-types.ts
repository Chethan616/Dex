import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

export type SignalAccountConfig = Omit<
  Exclude<NonNullable<DexConfig["channels"]>["signal"], undefined>,
  "accounts"
>;
