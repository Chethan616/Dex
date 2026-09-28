import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  Browsers,
  generateMessageIDV2,
} from '@whiskeysockets/baileys';
import type { WASocket, ConnectionState, BaileysEventMap, WAMessage, proto } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import QRCode from 'qrcode';
import { app } from 'electron';
import { mainLogger } from '../logger';
import type { ChannelAdapter, ChannelStatus, InboundMessage, SendOptions } from './types';

const AUTH_DIR = path.join(app.getPath('userData'), 'whatsapp-auth');

const BACKOFF = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
};

const MAX_SEEN_MESSAGES = 1000;
/** Recent self-chat messages kept so DEX can quote them in its replies. */
const MAX_RECENT_MESSAGES = 300;
/**
 * Messages older than this are history, not requests: after a long offline
 * stretch WhatsApp replays what it missed, and an "@DEX book it" from
 * yesterday must not suddenly run.
 */
const MAX_MESSAGE_AGE_MS = 10 * 60_000;

/** "@DEX" is the trigger; "@BU" still works for phones linked before the rebrand. */
const TRIGGER_RE = /(^|\s)@(?:DEX|BU)\b/i;
const TRIGGER_STRIP_RE = /(^|\s)@(?:DEX|BU)\b\s*/gi;

/** The text of a message, whatever kind carries it (plain, reply, caption). */
function messageText(m: proto.IMessage | null | undefined): string | undefined {
  if (!m) return undefined;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    undefined
  ) || undefined;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeFor(fileName: string): string {
  return MIME[path.extname(fileName).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** WhatsApp's reply metadata lives on whichever sub-message was sent. */
function contextOf(m: proto.IMessage | null | undefined): proto.IContextInfo | undefined {
  if (!m) return undefined;
  return (
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    undefined
  ) || undefined;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = 'whatsapp' as const;
  status: ChannelStatus = 'disconnected';

  private sock: WASocket | null = null;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private statusHandler: ((status: ChannelStatus, detail?: string) => void) | null = null;
  private qrHandler: ((qrDataUrl: string) => void) | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seenMessages = new Set<string>();
  /** Ids of messages DEX itself sent — never read back as your requests. */
  private ownSent = new Set<string>();
  private recent = new Map<string, WAMessage>();
  private identity: string | null = null;
  private selfLid: string | null = null;
  private msgRetryCounterCache = new NodeCache();
  private intentionalDisconnect = false;

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  onStatusChange(handler: (status: ChannelStatus, detail?: string) => void): void {
    this.statusHandler = handler;
  }

  onQr(handler: (qrDataUrl: string) => void): void {
    this.qrHandler = handler;
  }

  getIdentity(): string | null {
    return this.identity;
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.setStatus('connecting');
    await this.startSocket();
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.identity = null;
    this.seenMessages.clear();
    this.setStatus('disconnected');
    mainLogger.info('whatsapp.disconnect');
  }

  async clearAuth(): Promise<void> {
    await this.disconnect();
    try {
      await fsPromises.rm(AUTH_DIR, { recursive: true, force: true });
      mainLogger.info('whatsapp.clearAuth');
    } catch { /* ignore */ }
  }

  async send(conversationId: string, text: string, options: SendOptions = {}): Promise<string | null> {
    if (!this.sock || !this.sock.user) {
      mainLogger.warn('whatsapp.send.notConnected', { conversationId });
      return null;
    }
    // Pick the id up front and mark it as ours *before* sending: in self-chat
    // WhatsApp echoes the message back, sometimes before sendMessage resolves,
    // and DEX's own "@DEX for a new task" hint must not start a task.
    const messageId = generateMessageIDV2(this.sock.user.id);
    this.remember(this.ownSent, messageId);
    const quoted = options.quoteMessageId ? this.recent.get(options.quoteMessageId) : undefined;
    const sent = await this.sock.sendMessage(conversationId, { text }, { messageId, quoted });
    const sentId = sent?.key?.id ?? messageId;
    if (sent) this.cacheRecent(sent);
    mainLogger.info('whatsapp.send', { conversationId, textLength: text.length, sentId, quoted: !!quoted });
    return sentId;
  }

  /**
   * Send a file from this PC. Images go as photos, videos as videos,
   * everything else as a document carrying its filename.
   */
  async sendFile(
    conversationId: string,
    filePath: string,
    options: SendOptions & { caption?: string; fileName?: string } = {},
  ): Promise<string | null> {
    if (!this.sock || !this.sock.user) {
      mainLogger.warn('whatsapp.sendFile.notConnected', { conversationId });
      return null;
    }
    const data = await fsPromises.readFile(filePath);
    const fileName = options.fileName ?? path.basename(filePath);
    const caption = options.caption || undefined;
    const mimetype = mimeFor(fileName);
    const content = mimetype.startsWith('image/') && mimetype !== 'image/svg+xml'
      ? { image: data, caption, mimetype }
      : mimetype === 'video/mp4'
        ? { video: data, caption, mimetype }
        : { document: data, mimetype, fileName, caption };

    const messageId = generateMessageIDV2(this.sock.user.id);
    this.remember(this.ownSent, messageId);
    const quoted = options.quoteMessageId ? this.recent.get(options.quoteMessageId) : undefined;
    const sent = await this.sock.sendMessage(conversationId, content, { messageId, quoted });
    if (sent) this.cacheRecent(sent);
    mainLogger.info('whatsapp.sendFile', { conversationId, bytes: data.byteLength, mimetype, quoted: !!quoted });
    return sent?.key?.id ?? messageId;
  }

  /** Your own "Message yourself" chat — the only place DEX sends to on its own. */
  selfChatJid(): string | null {
    const id = this.sock?.user?.id;
    return id ? id.replace(/:.*@/, '@') : null;
  }

  /** React to one of your messages — a quiet status light (👀 ⏳ ✅ ❌). */
  async react(conversationId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.sock?.user) return;
    const key = this.recent.get(messageId)?.key ?? { remoteJid: conversationId, fromMe: true, id: messageId };
    try {
      await this.sock.sendMessage(conversationId, { react: { text: emoji, key } });
    } catch (err) {
      mainLogger.warn('whatsapp.react.failed', { error: (err as Error).message });
    }
  }

  private remember(set: Set<string>, id: string): void {
    if (set.size >= MAX_SEEN_MESSAGES) {
      const first = set.values().next().value;
      if (first) set.delete(first);
    }
    set.add(id);
  }

  private cacheRecent(msg: WAMessage): void {
    const id = msg.key.id;
    if (!id) return;
    this.recent.delete(id);
    this.recent.set(id, msg);
    if (this.recent.size > MAX_RECENT_MESSAGES) {
      const first = this.recent.keys().next().value;
      if (first) this.recent.delete(first);
    }
  }

  private async startSocket(): Promise<void> {
    try {
      await fsPromises.mkdir(AUTH_DIR, { recursive: true });

      await this.restoreCredsFromBackupIfNeeded();

      const { version } = await fetchLatestBaileysVersion();
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys library fn, not a React hook
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      mainLogger.info('whatsapp.startSocket', {
        version,
        hasExistingCreds: !!state.creds.me,
      });

      const silentLogger = { level: 'silent', info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => silentLogger } as unknown as Parameters<typeof makeWASocket>[0]['logger'];
      this.sock = makeWASocket({
        version,
        logger: silentLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
        },
        browser: Browsers.ubuntu('DEX'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        msgRetryCounterCache: this.msgRetryCounterCache,
        printQRInTerminal: false,
      });

      const safeSaveCreds = async () => {
        const credsPath = path.join(AUTH_DIR, 'creds.json');
        const backupPath = path.join(AUTH_DIR, 'creds.json.bak');
        try {
          const existing = fs.readFileSync(credsPath, 'utf-8');
          JSON.parse(existing);
          fs.copyFileSync(credsPath, backupPath);
        } catch { /* ignore */ }
        await saveCreds();
      };

      this.sock.ev.process(async (events: Partial<BaileysEventMap>) => {
        if (events['creds.update']) {
          await safeSaveCreds();
        }

        if (events['connection.update']) {
          await this.handleConnectionUpdate(events['connection.update'] as Partial<ConnectionState>);
        }

        if (events['messages.upsert']) {
          this.handleMessagesUpsert(events['messages.upsert'] as BaileysEventMap['messages.upsert']);
        }
      });
    } catch (err) {
      mainLogger.error('whatsapp.startSocket.failed', {
        error: (err as Error).message,
      });
      this.setStatus('error', (err as Error).message);
    }
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr);
        this.qrHandler?.(dataUrl);
        this.setStatus('qr_ready');
        mainLogger.info('whatsapp.qr.generated');
      } catch (err) {
        mainLogger.error('whatsapp.qr.failed', { error: (err as Error).message });
      }
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0;
      this.identity = this.sock?.user?.id?.replace(/:.*$/, '') ?? null;
      this.selfLid = this.sock?.user?.lid ?? null;
      this.setStatus('connected', this.identity ?? undefined);
      mainLogger.info('whatsapp.connected', { identity: this.identity });
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      mainLogger.info('whatsapp.connection.close', { code });

      if (this.intentionalDisconnect) return;

      switch (code) {
        case DisconnectReason.loggedOut:
        case DisconnectReason.badSession:
          mainLogger.warn('whatsapp.authInvalid', { code });
          try {
            await fsPromises.rm(AUTH_DIR, { recursive: true, force: true });
          } catch { /* ignore */ }
          this.identity = null;
          this.setStatus('disconnected', 'Session expired — reconnect to scan QR');
          break;

        case 403:
          mainLogger.error('whatsapp.banned');
          this.identity = null;
          this.setStatus('error', 'Account banned by WhatsApp');
          break;

        case DisconnectReason.connectionReplaced:
          this.identity = null;
          this.setStatus('error', 'Replaced by another session');
          break;

        case DisconnectReason.restartRequired:
          mainLogger.info('whatsapp.restartRequired');
          await this.startSocket();
          break;

        default: {
          const delay = Math.min(
            BACKOFF.initialMs * Math.pow(BACKOFF.factor, this.reconnectAttempts),
            BACKOFF.maxMs,
          ) * (1 + (Math.random() - 0.5) * BACKOFF.jitter);
          this.reconnectAttempts++;
          mainLogger.info('whatsapp.reconnecting', {
            attempt: this.reconnectAttempts,
            delayMs: Math.round(delay),
          });
          this.setStatus('connecting');
          this.reconnectTimer = setTimeout(() => this.startSocket(), delay);
        }
      }
    }
  }

  /**
   * Only *you* can drive DEX from WhatsApp. A message is considered only when
   * all of these hold — anything else (other people, groups, broadcasts,
   * channels, other devices' chats, DEX's own messages, old history) is
   * dropped before its text is even read:
   *   - it was sent by your account (fromMe) — not by a contact;
   *   - it's in your own "Message yourself" chat — not a group or a DM;
   *   - DEX didn't send it;
   *   - it's fresh (not a replay of history after being offline).
   *
   * What happens next is the router's call: a WhatsApp *reply* to one of a
   * task's messages continues that task; "@DEX" starts a new one; anything
   * else is just a note to yourself.
   */
  private handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): void {
    const { messages, type } = upsert;

    if (type !== 'notify') return;

    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      const id = msg.key.id;
      if (!remoteJid || !id) continue;
      if (
        remoteJid === 'status@broadcast' ||
        remoteJid.endsWith('@g.us') ||
        remoteJid.endsWith('@broadcast') ||
        remoteJid.endsWith('@newsletter') ||
        msg.broadcast
      ) continue;
      if (!msg.key.fromMe) continue;
      if (this.ownSent.has(id)) continue;

      const stripDevice = (jid: string | null | undefined): string | null => jid ? jid.replace(/:.*@/, '@') : null;
      const ownJid = stripDevice(this.sock?.user?.id);
      const ownLid = stripDevice(this.selfLid);
      const isSelfChat = remoteJid === ownLid || remoteJid === ownJid;
      if (!isSelfChat) continue;

      const dedupKey = `${remoteJid}:${id}`;
      if (this.seenMessages.has(dedupKey)) continue;
      this.remember(this.seenMessages, dedupKey);

      const sentAtMs = Number(msg.messageTimestamp ?? 0) * 1000;
      if (sentAtMs && Date.now() - sentAtMs > MAX_MESSAGE_AGE_MS) {
        mainLogger.info('whatsapp.msg.skipStale', { ageMs: Date.now() - sentAtMs });
        continue;
      }

      // Reactions, edits, deletes, stickers… carry no text: nothing to do.
      const text = messageText(msg.message);
      if (!text) continue;
      this.cacheRecent(msg);

      const mentioned = TRIGGER_RE.test(text);
      const cleanedText = text.replace(TRIGGER_STRIP_RE, '$1').trim();
      const context = contextOf(msg.message);
      const replyToMessageId = context?.stanzaId ?? undefined;
      const quotedText = messageText(context?.quotedMessage);

      // A plain note to yourself — not addressed to DEX, not a reply.
      if (!mentioned && !replyToMessageId) continue;
      if (!cleanedText) continue;

      mainLogger.info('whatsapp.inbound', {
        textLength: cleanedText.length,
        mentioned,
        replyToMessageId: replyToMessageId ?? null,
      });

      this.messageHandler?.({
        channelId: 'whatsapp',
        from: remoteJid,
        fromName: msg.pushName ?? 'You',
        text: cleanedText,
        timestamp: sentAtMs || Date.now(),
        conversationId: remoteJid,
        messageId: id,
        replyToMessageId,
        quotedText,
        mentioned,
        ack: (emoji) => { void this.react(remoteJid, id, emoji); },
      });
    }
  }

  private async restoreCredsFromBackupIfNeeded(): Promise<void> {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    const backupPath = path.join(AUTH_DIR, 'creds.json.bak');
    try {
      const raw = fs.readFileSync(credsPath, 'utf-8');
      JSON.parse(raw);
    } catch {
      try {
        const backupRaw = fs.readFileSync(backupPath, 'utf-8');
        JSON.parse(backupRaw);
        fs.copyFileSync(backupPath, credsPath);
        mainLogger.info('whatsapp.creds.restoredFromBackup');
      } catch { /* ignore */ }
    }
  }

  private setStatus(status: ChannelStatus, detail?: string): void {
    this.status = status;
    this.statusHandler?.(status, detail);
  }
}
