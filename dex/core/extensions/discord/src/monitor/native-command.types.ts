import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
import type { CommandArgValues } from "openclaw/plugin-sdk/native-command-registry";

export type DiscordConfig = NonNullable<DexConfig["channels"]>["discord"];

export type DiscordCommandArgs = {
  raw?: string;
  values?: CommandArgValues;
};
