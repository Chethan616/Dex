export interface InboundMessage {
  senderId: string;
  ownerId: string;
  chatId: string;
  isGroup: boolean;
  text: string;
}

export interface GateResult {
  shouldRespond: boolean;
  cleanText?: string;
}

/**
 * processOwnerGate:
 * - Reject if senderId !== ownerId (must listen only from owner).
 * - Enforce that the message must start with "@dex" (followed by whitespace, word boundary, or ending).
 * - Return the cleaned text with the "@dex" prefix removed.
 */
export function processOwnerGate(msg: InboundMessage): GateResult {
  if (msg.senderId !== msg.ownerId) {
    return { shouldRespond: false };
  }

  const trimmed = msg.text.trim();
  const prefixRegex = /^@dex\b/i;

  if (!prefixRegex.test(trimmed)) {
    return { shouldRespond: false };
  }

  const rest = trimmed.replace(prefixRegex, '').trim();
  
  return {
    shouldRespond: true,
    cleanText: rest
  };
}
