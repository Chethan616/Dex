import * as path from 'path';
import { ChannelAdapter, ChannelRuntime, Reply } from './base_channel';

/**
 * WhatsApp, via Baileys.
 *
 * Deliberately an *optional* dependency, loaded with require() at start rather
 * than imported at the top of the file. Two reasons, both worth knowing before
 * turning this on:
 *
 *   * **Licence.** Baileys is GPL-3.0. Importing it statically would pull this
 *     project into that licence's scope if it were ever distributed. Loading it
 *     only when the owner has explicitly enabled WhatsApp keeps that boundary a
 *     decision rather than an accident.
 *   * **Terms of service.** It is an unofficial client that reverse-engineers
 *     WhatsApp Web. Accounts using it can be, and are, banned. Telegram and
 *     Discord are official APIs; this one is not, and the owner should choose
 *     it knowingly.
 *
 * So `npm install @whiskeysockets/baileys` is a separate step, and Dex reports
 * plainly when it is missing instead of failing to boot.
 */
export class WhatsAppChannel implements ChannelAdapter {
  readonly source = 'whatsapp' as const;
  readonly name = 'WhatsApp';

  private socket: { end: (err?: Error) => void } | null = null;

  constructor(private runtime: ChannelRuntime, private authDir = path.join('data', 'whatsapp')) {}

  async start(): Promise<void> {
    let baileys: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      baileys = require('@whiskeysockets/baileys') as Record<string, unknown>;
    } catch {
      console.warn(
        '\x1b[33m[whatsapp]\x1b[0m not installed — skipping.\n' +
          '  npm install @whiskeysockets/baileys\n' +
          '  Note: GPL-3.0, and an unofficial client that can get the account banned.',
      );
      return;
    }

    const makeSocket = (baileys.default ?? baileys.makeWASocket) as (
      config: Record<string, unknown>,
    ) => WaSocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState as (
      dir: string,
    ) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;

    // Credentials live under data/, which is gitignored — a WhatsApp session is
    // a live login, not configuration.
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    const socket = makeSocket({
      auth: state,
      // Baileys prints a QR itself; letting it do so is the whole pairing flow.
      printQRInTerminal: true,
      syncFullHistory: false,
    });
    this.socket = socket;

    socket.ev.on('creds.update', () => void saveCreds());

    socket.ev.on('connection.update', (update: WaConnectionUpdate) => {
      if (update.connection === 'open') {
        console.log('\x1b[36m[whatsapp]\x1b[0m linked');
      }
      if (update.connection === 'close') {
        const status = update.lastDisconnect?.error?.output?.statusCode;
        // 401 means the pairing was revoked from the phone. Reconnecting would
        // loop forever against a session that is gone.
        if (status === 401) {
          console.warn('\x1b[33m[whatsapp]\x1b[0m logged out — delete data/whatsapp and re-pair.');
        } else {
          console.warn('\x1b[33m[whatsapp]\x1b[0m disconnected — reconnecting');
          void this.start();
        }
      }
    });

    socket.ev.on('messages.upsert', async (batch: WaUpsert) => {
      for (const message of batch.messages ?? []) {
        if (message.key.fromMe) continue;

        const chatId = message.key.remoteJid ?? '';
        // A group jid ends @g.us and carries the real sender separately; a
        // direct chat's jid *is* the sender.
        const isGroup = chatId.endsWith('@g.us');
        const senderJid = isGroup ? (message.key.participant ?? '') : chatId;

        const text =
          message.message?.conversation ??
          message.message?.extendedTextMessage?.text ??
          '';
        if (!text.trim()) continue;

        const reply: Reply = {
          // No edit(): WhatsApp message editing is inconsistent across clients,
          // so progress arrives as one message and the result as another rather
          // than as a live-updating one.
          send: async (body) => {
            await socket.sendMessage(chatId, { text: body });
            return undefined;
          },
        };

        await this.runtime.handle(
          this.source,
          {
            senderId: normaliseJid(senderJid),
            chatType: isGroup ? 'group' : 'direct',
            chatId,
            text,
          },
          reply,
        );
      }
    });
  }

  async stop(): Promise<void> {
    this.socket?.end(undefined);
    this.socket = null;
  }
}

/** `4477…:12@s.whatsapp.net` -> `4477…` so config can hold a plain number. */
function normaliseJid(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

// Minimal shapes for the parts of Baileys actually used. Declared here rather
// than imported so this file compiles whether or not the package is installed.
interface WaSocket {
  ev: { on(event: string, handler: (payload: never) => void): void };
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  end(err?: Error): void;
}

interface WaConnectionUpdate {
  connection?: 'open' | 'close' | 'connecting';
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
}

interface WaUpsert {
  messages?: Array<{
    key: { fromMe?: boolean; remoteJid?: string; participant?: string };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
    };
  }>;
}
