import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: DexConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}
