import type { MarkdownTableMode } from "./types.base.js";
import type { DexConfig } from "./types.openclaw.js";

export type ResolveMarkdownTableModeParams = {
  cfg?: Partial<DexConfig>;
  channel?: string | null;
  accountId?: string | null;
};

export type ResolveMarkdownTableMode = (
  params: ResolveMarkdownTableModeParams,
) => MarkdownTableMode;
