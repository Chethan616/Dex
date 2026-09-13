import type { PairingChannel } from "./pairing-store.types.js";

export function buildPairingReply(params: {
  channel: PairingChannel;
  idLine: string;
  code: string;
}): string {
  // Sent to whoever messages Dex before they're paired. Keep it human and
  // Dex-branded -- no upstream product name, and no developer CLI dumped on
  // a stranger. The owner approves the code on their side (Dex app).
  const { idLine, code } = params;
  return [
    "Hi! This is Dex, a personal assistant — it's not connected to you yet.",
    "",
    idLine,
    "Your pairing code:",
    "```",
    code,
    "```",
    "",
    "Share this code with Dex's owner to get access.",
  ].join("\n");
}
