import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: DexConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}
