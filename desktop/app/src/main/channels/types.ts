export type ChannelId = 'whatsapp' | 'telegram' | 'discord' | 'slack';

/** A picture or file that came with a message. */
export interface InboundAttachment {
  name: string;
  mime: string;
  bytes: Buffer;
}

export type ChannelStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected'
  | 'error';

export interface InboundMessage {
  channelId: ChannelId;
  from: string;
  fromName: string;
  /** The text with the "@DEX" trigger removed. */
  text: string;
  timestamp: number;
  conversationId: string;
  messageId: string;
  /** The message this one replies to (WhatsApp's reply/quote feature). */
  replyToMessageId?: string;
  /** The text of the message being replied to, when there is one. */
  quotedText?: string;
  /** Whether it addressed DEX with "@DEX" — the only way to start a new task. */
  mentioned: boolean;
  /** Pictures and files sent with it (a photo with a caption, a PDF). */
  attachments?: InboundAttachment[];
  /** It's a button press on one of DEX's messages, not something typed. */
  pressed?: boolean;
  /** React to this message (e.g. 👀 received, 🚀 started). Best-effort. */
  ack?: (emoji: string) => void;
}

export interface SendOptions {
  /** Quote (reply to) this earlier message, so the thread reads as one. */
  quoteMessageId?: string;
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  status: ChannelStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(conversationId: string, text: string, options?: SendOptions): Promise<string | null>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  onStatusChange(handler: (status: ChannelStatus, detail?: string) => void): void;
  onQr?(handler: (qrDataUrl: string) => void): void;
  getIdentity(): string | null;
}
