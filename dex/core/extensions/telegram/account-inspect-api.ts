import type { DexConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: DexConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
