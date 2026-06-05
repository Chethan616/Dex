import { resolveEnvelopeFormatOptions } from "../auto-reply/envelope.js";
import { readSessionUpdatedAt, resolveStorePath } from "../config/sessions.js";
import type { DexConfig } from "../config/types.openclaw.js";

export function resolveInboundSessionEnvelopeContext(params: {
  cfg: DexConfig;
  agentId: string;
  sessionKey: string;
}) {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  return {
    storePath,
    envelopeOptions: resolveEnvelopeFormatOptions(params.cfg),
    previousTimestamp: readSessionUpdatedAt({
      storePath,
      sessionKey: params.sessionKey,
    }),
  };
}
