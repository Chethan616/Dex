import type { DexConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: DexConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
