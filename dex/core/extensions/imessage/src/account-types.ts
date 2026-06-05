import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<DexConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
