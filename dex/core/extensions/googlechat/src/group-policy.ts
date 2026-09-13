import { resolveChannelGroupRequireMention } from "openclaw/plugin-sdk/channel-policy";
import type { DexConfig } from "openclaw/plugin-sdk/core";

type GoogleChatGroupContext = {
  cfg: DexConfig;
  accountId?: string | null;
  groupId?: string | null;
};

export function resolveGoogleChatGroupRequireMention(params: GoogleChatGroupContext): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
