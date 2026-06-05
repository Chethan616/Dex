import { resolveAgentIdentity } from "openclaw/plugin-sdk/agent-runtime";
import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

const DEFAULT_WHATSAPP_ACK_REACTION = "👀";

type WhatsAppAckReactionConfig = NonNullable<
  NonNullable<NonNullable<DexConfig["channels"]>["whatsapp"]>["ackReaction"]
>;

export function resolveWhatsAppAckEmoji(params: {
  cfg: DexConfig;
  agentId: string;
  ackConfig: WhatsAppAckReactionConfig | undefined;
}): string {
  if (!params.ackConfig) {
    return "";
  }
  if (params.ackConfig.emoji !== undefined) {
    return params.ackConfig.emoji.trim();
  }
  return resolveAgentIdentityEmoji(params.cfg, params.agentId) ?? DEFAULT_WHATSAPP_ACK_REACTION;
}

function resolveAgentIdentityEmoji(cfg: DexConfig, agentId: string): string | undefined {
  const emoji = resolveAgentIdentity(cfg, agentId)?.emoji?.trim();
  return emoji || undefined;
}
