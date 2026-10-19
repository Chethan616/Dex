/**
 * Telegram: your own DEX bot, made in a minute with @BotFather.
 *
 * DEX talks to the Bot API directly — long polling from this PC, no server
 * and no webhook. Anyone who finds a bot can message it, so a DEX bot
 * answers one person: whoever opens the pairing link DEX shows
 * (t.me/<bot>?start=<code>) becomes its owner, and everyone else is told
 * it's private. In the owner's chat with the bot:
 *   - any message → a new task (no "@DEX": the whole chat is DEX);
 *   - a reply to one of a task's messages → a follow-up in that task;
 *   - a task's questions come with buttons; a tap answers;
 *   - photos and files you send go to the task;
 *   - status shows as a reaction on your message, as on WhatsApp, and
 *     "typing…" while it works.
 *
 * The token and the owner live in the OS credential store (keytar), never
 * in a file, and the token never reaches the log.
 */
import { randomBytes } from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { mainLogger } from '../logger';
import type { ChatAdapter } from './ChannelRouter';
import type { ChatPrompt } from './chatWidgets';
import type { ChannelStatus, InboundAttachment, InboundMessage, SendOptions } from './types';

const SERVICE = 'DEX';
const ACCOUNT = 'telegram';
const API = 'https://api.telegram.org';
const POLL_SECONDS = 25;
/** Messages older than this when DEX starts aren't acted on (sent while the PC was off). */
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
/** Bots may upload up to 50 MB. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 4096;
/** Bots may download up to 20 MB. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** An album arrives as one message per picture; this long after the last, they go as one. */
const ALBUM_WAIT_MS = 1200;
const COMMANDS = [
  { command: 'new', description: 'Start a new task' },
  { command: 'status', description: 'What DEX is doing' },
  { command: 'stop', description: 'Stop the running task' },
  { command: 'help', description: 'What DEX can do here' },
];

export interface TelegramSaved {
  token: string;
  bot: { id: number; username: string; name: string };
  owner?: { id: number; name: string };
}

/** What Settings shows. Never carries the token. */
export interface TelegramInfo {
  status: ChannelStatus;
  bot: string | null;
  owner: string | null;
  /** While nobody owns the bot: the link that pairs it with your Telegram. */
  pairUrl: string | null;
  /** The same link as a QR code, for Telegram on the phone. */
  pairQr: string | null;
  error?: string;
}

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: TgMessage;
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  media_group_id?: string;
}
interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

class TelegramError extends Error {
  constructor(readonly code: number, description: string) {
    super(description);
  }
}

type KeytarLike = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

function keytar(): KeytarLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike;
  } catch {
    return null;
  }
}

/** Telegram reacts with its own short list; DEX's status lights, mapped onto it. */
const REACTION: Record<string, string> = { '👀': '👀', '⏳': '✍', '✅': '👍', '❌': '😢', '🤔': '🤔' };

/** A message's id across chats: Telegram numbers messages per chat. */
const keyOf = (chatId: number | string, messageId: number) => `tg:${chatId}:${messageId}`;
function messageIdOf(key: string | undefined): number | undefined {
  const m = key ? /^tg:-?\d+:(\d+)$/.exec(key) : null;
  return m ? Number(m[1]) : undefined;
}

const nameOf = (u: TgUser | undefined) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || (u?.username ? `@${u.username}` : 'You');

/**
 * DEX's messages use WhatsApp's markup (*bold*, _italic_, ~strike~) and
 * agents write Markdown; Telegram takes HTML.
 */
export function toTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]+?)```/g, '<pre>$1</pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?:;])/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?:;])/gm, '$1<i>$2</i>')
    .replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s).,!?:;])/gm, '$1<s>$2</s>');
}

export class TelegramAdapter implements ChatAdapter {
  readonly id = 'telegram' as const;
  status: ChannelStatus = 'disconnected';

  private saved: TelegramSaved | null = null;
  private pairCode: string | null = null;
  private pairQr: string | null = null;
  private error: string | undefined;
  private offset = 0;
  private startedAt = 0;
  private abort: AbortController | null = null;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private statusHandler: ((status: ChannelStatus, detail?: string) => void) | null = null;
  /** Strangers already told the bot is private, so they're told once. */
  private turnedAway = new Set<number>();
  /** What each button DEX sent answers, by its callback key. */
  private buttons = new Map<string, { label: string; reply: string }>();
  /** Albums being gathered, by media group. */
  private albums = new Map<string, { messages: TgMessage[]; timer: ReturnType<typeof setTimeout> }>();

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  onStatusChange(handler: (status: ChannelStatus, detail?: string) => void): void {
    this.statusHandler = handler;
  }

  info(): TelegramInfo {
    const bot = this.saved?.bot.username ?? null;
    return {
      status: this.status,
      bot,
      owner: this.saved?.owner?.name ?? null,
      pairUrl: this.pairUrl(),
      pairQr: this.pairUrl() ? this.pairQr : null,
      error: this.status === 'error' ? this.error : undefined,
    };
  }

  private pairUrl(): string | null {
    const bot = this.saved?.bot.username;
    return bot && !this.saved?.owner && this.pairCode ? `https://t.me/${bot}?start=${this.pairCode}` : null;
  }

  /** Your chat with the bot. */
  homeChat(): string | null {
    return this.saved?.owner ? String(this.saved.owner.id) : null;
  }

  /** Reconnect with the saved bot, if there is one. */
  async resume(): Promise<void> {
    if (this.abort) return;
    const raw = await keytar()?.getPassword(SERVICE, ACCOUNT).catch(() => null);
    if (!raw) return;
    try {
      this.saved = JSON.parse(raw) as TelegramSaved;
    } catch {
      return;
    }
    await this.start();
  }

  /** Check a token from @BotFather, keep it, and start listening. */
  async connect(token: string): Promise<TelegramInfo> {
    const clean = token.trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(clean)) {
      throw new Error('That doesn’t look like a bot token. In Telegram, @BotFather sends it after /newbot — it looks like 123456789:AA…');
    }
    await this.stop();
    let me: TgUser;
    try {
      me = await this.call<TgUser>(clean, 'getMe');
    } catch (err) {
      // No `cause`: a network error's text can carry the request URL, token and all.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(err instanceof TelegramError && err.code === 401
        ? 'Telegram didn’t accept that token. Copy it again from @BotFather (or send /token there for a new one).'
        : `Couldn’t reach Telegram: ${this.scrub((err as Error).message, clean)}`);
    }
    const sameBot = this.saved?.bot.id === me.id;
    this.saved = {
      token: clean,
      bot: { id: me.id, username: me.username ?? '', name: nameOf(me) },
      owner: sameBot ? this.saved?.owner : undefined,
    };
    await this.save();
    await this.start();
    return this.info();
  }

  /** Forget the bot: stop listening and delete the token. */
  async remove(): Promise<void> {
    await this.stop();
    this.saved = null;
    this.pairCode = null;
    await keytar()?.deletePassword(SERVICE, ACCOUNT).catch(() => false);
    this.setStatus('disconnected');
  }

  async disconnect(): Promise<void> {
    await this.stop();
    this.setStatus('disconnected');
  }

  async send(conversationId: string, text: string, options: SendOptions = {}): Promise<string | null> {
    if (!this.saved) return null;
    const body = {
      chat_id: conversationId,
      text: toTelegramHtml(clip(text, MAX_TEXT - 200)),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...this.replyTo(options.quoteMessageId),
    };
    let sent: TgMessage;
    try {
      sent = await this.call<TgMessage>(this.saved.token, 'sendMessage', body);
    } catch (err) {
      // Markup Telegram can't parse: send it as it is.
      if (!(err instanceof TelegramError) || err.code !== 400) throw err;
      sent = await this.call<TgMessage>(this.saved.token, 'sendMessage', { ...body, text: clip(text, MAX_TEXT), parse_mode: undefined });
    }
    mainLogger.info('telegram.send', { textLength: text.length, quoted: !!options.quoteMessageId });
    return keyOf(conversationId, sent.message_id);
  }

  /** Pictures go as photos, everything else as a document with its name. */
  async sendFile(
    conversationId: string,
    filePath: string,
    options: SendOptions & { caption?: string; fileName?: string } = {},
  ): Promise<string | null> {
    if (!this.saved) return null;
    const data = await fsPromises.readFile(filePath);
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`too large for Telegram (${Math.round(data.byteLength / 1e6)} MB, max 50 MB): ${filePath}`);
    }
    const fileName = options.fileName ?? path.basename(filePath);
    const photo = /\.(png|jpe?g|webp)$/i.test(fileName) && data.byteLength < 10 * 1024 * 1024;
    const form = new FormData();
    form.set('chat_id', conversationId);
    form.set(photo ? 'photo' : 'document', new Blob([data]), fileName);
    if (options.caption) form.set('caption', clip(options.caption, 1024));
    const reply = this.replyTo(options.quoteMessageId);
    if (reply.reply_parameters) form.set('reply_parameters', JSON.stringify(reply.reply_parameters));
    const sent = await this.call<TgMessage>(this.saved.token, photo ? 'sendPhoto' : 'sendDocument', form);
    mainLogger.info('telegram.sendFile', { bytes: data.byteLength, photo });
    return keyOf(conversationId, sent.message_id);
  }

  async react(conversationId: string, messageId: string, emoji: string): Promise<void> {
    const id = messageIdOf(messageId);
    const reaction = REACTION[emoji] ?? emoji;
    if (!this.saved || id === undefined) return;
    try {
      await this.call(this.saved.token, 'setMessageReaction', { chat_id: conversationId, message_id: id, reaction: [{ type: 'emoji', emoji: reaction }] });
    } catch (err) {
      mainLogger.warn('telegram.react.failed', { error: this.scrub((err as Error).message) });
    }
  }

  /** A message with buttons: answers as callback buttons, links as link buttons. */
  async sendPrompt(conversationId: string, prompt: ChatPrompt, options: SendOptions = {}): Promise<string | null> {
    if (!this.saved) return null;
    const extra: string[] = [];
    type TgButton = { text: string; callback_data?: string; url?: string };
    const keyboard = prompt.rows.map((row) => row.flatMap((b): TgButton[] => {
      if (b.reply) {
        const key = randomBytes(6).toString('base64url');
        this.buttons.set(key, { label: b.label, reply: b.reply });
        return [{ text: b.label, callback_data: `b:${key}` }];
      }
      // Telegram's link buttons take web links only; mailto:, tel: go in the text.
      if (b.url && /^https?:\/\//i.test(b.url)) return [{ text: b.label, url: b.url }];
      if (b.url) extra.push(`${b.label}: ${b.url}`);
      return [];
    })).filter((row) => row.length);
    while (this.buttons.size > 600) this.buttons.delete(this.buttons.keys().next().value as string);
    const text = [prompt.text, ...extra].join('\n\n');
    const sent = await this.call<TgMessage>(this.saved.token, 'sendMessage', {
      chat_id: conversationId,
      text: toTelegramHtml(clip(text, MAX_TEXT - 200)),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
      ...this.replyTo(options.quoteMessageId),
    });
    mainLogger.info('telegram.sendPrompt', { buttons: keyboard.flat().length });
    return keyOf(conversationId, sent.message_id);
  }

  typing(conversationId: string): void {
    if (this.saved) void this.call(this.saved.token, 'sendChatAction', { chat_id: conversationId, action: 'typing' }).catch(() => {});
  }

  private replyTo(quoteMessageId: string | undefined): { reply_parameters?: { message_id: number; allow_sending_without_reply: boolean } } {
    const id = messageIdOf(quoteMessageId);
    return id === undefined ? {} : { reply_parameters: { message_id: id, allow_sending_without_reply: true } };
  }

  private async start(): Promise<void> {
    if (!this.saved) return;
    this.abort = new AbortController();
    this.startedAt = Date.now();
    if (!this.saved.owner) {
      this.pairCode = randomBytes(9).toString('base64url');
      const url = this.pairUrl();
      this.pairQr = url ? await QRCode.toDataURL(url, { margin: 1, width: 240 }).catch(() => null) : null;
    }
    this.setStatus('connecting');
    // A webhook set elsewhere would make getUpdates fail.
    await this.call(this.saved.token, 'deleteWebhook', {}).catch(() => {});
    // The "/" menu in the chat.
    await this.call(this.saved.token, 'setMyCommands', { commands: COMMANDS }).catch(() => {});
    void this.poll(this.abort.signal);
  }

  private async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;
    for (const a of this.albums.values()) clearTimeout(a.timer);
    this.albums.clear();
  }

  private async poll(signal: AbortSignal): Promise<void> {
    let backoff = 1000;
    while (!signal.aborted && this.saved) {
      try {
        const updates = await this.call<TgUpdate[]>(this.saved.token, 'getUpdates', {
          offset: this.offset,
          timeout: POLL_SECONDS,
          allowed_updates: ['message', 'callback_query'],
        }, AbortSignal.any([signal, AbortSignal.timeout((POLL_SECONDS + 15) * 1000)]));
        if (this.status !== 'connected') this.setStatus('connected', this.saved.bot.username);
        backoff = 1000;
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) await this.gather(update.message).catch((err) => {
            mainLogger.warn('telegram.handle.failed', { error: this.scrub((err as Error).message) });
          });
          if (update.callback_query) await this.handlePress(update.callback_query).catch((err) => {
            mainLogger.warn('telegram.press.failed', { error: this.scrub((err as Error).message) });
          });
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof TelegramError && err.code === 401) {
          this.error = 'Telegram no longer accepts this bot’s token — it may have been changed in @BotFather. Paste the new one.';
          this.setStatus('error', this.error);
          return;
        }
        if (err instanceof TelegramError && err.code === 409) {
          this.error = 'Another program is reading this bot’s messages. Close it, or make a new bot for DEX.';
          this.setStatus('error', this.error);
        } else if (this.status !== 'error') {
          this.setStatus('connecting', 'Reconnecting…');
        }
        mainLogger.warn('telegram.poll.failed', { error: this.scrub((err as Error).message) });
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  /** An album's pictures arrive one message each: wait for the rest, then handle them as one. */
  private async gather(m: TgMessage): Promise<void> {
    if (!m.media_group_id) return this.handle(m);
    const album = this.albums.get(m.media_group_id) ?? { messages: [], timer: setTimeout(() => {}, 0) };
    clearTimeout(album.timer);
    album.messages.push(m);
    album.timer = setTimeout(() => {
      this.albums.delete(m.media_group_id as string);
      const [first, ...rest] = album.messages.sort((a, b) => a.message_id - b.message_id);
      const captioned = album.messages.find((x) => x.caption) ?? first;
      void this.handle({ ...first, caption: captioned.caption }, rest).catch((err) => {
        mainLogger.warn('telegram.handle.failed', { error: this.scrub((err as Error).message) });
      });
    }, ALBUM_WAIT_MS);
    this.albums.set(m.media_group_id, album);
  }

  /** A tap on one of DEX's answer buttons: show the choice, and send it on as your answer. */
  private async handlePress(q: TgCallback): Promise<void> {
    if (!this.saved) return;
    const token = this.saved.token;
    const answer = (text?: string) => this.call(token, 'answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => {});
    const owner = this.saved.owner;
    if (!owner || q.from.id !== owner.id) { await answer('This is someone’s private DEX bot.'); return; }
    const b = q.data?.startsWith('b:') ? this.buttons.get(q.data.slice(2)) : undefined;
    const m = q.message;
    if (!b || !m) { await answer(q.data === 'x' ? undefined : 'That question has expired — type your answer instead.'); return; }
    await answer();
    const chatId = String(m.chat.id);
    // Keep the choice on the message; the other buttons go.
    await this.call(token, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: m.message_id,
      reply_markup: { inline_keyboard: [[{ text: `✓ ${b.label}`, callback_data: 'x' }]] },
    }).catch(() => {});
    const messageId = keyOf(chatId, m.message_id);
    mainLogger.info('telegram.press');
    this.messageHandler?.({
      channelId: 'telegram',
      from: String(q.from.id),
      fromName: nameOf(q.from),
      text: b.reply,
      timestamp: Date.now(),
      conversationId: chatId,
      messageId,
      replyToMessageId: messageId,
      mentioned: true,
      pressed: true,
      ack: (emoji) => { void this.react(chatId, messageId, emoji); },
    });
  }

  /** The photo or document on a message (and the rest of its album), downloaded. */
  private async filesOf(messages: TgMessage[]): Promise<InboundAttachment[]> {
    if (!this.saved) return [];
    const out: InboundAttachment[] = [];
    for (const m of messages) {
      const photo = m.photo?.filter((p) => (p.file_size ?? 0) <= MAX_DOWNLOAD_BYTES).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const ref = photo
        ? { id: photo.file_id, name: `photo-${m.message_id}.jpg`, mime: 'image/jpeg', size: photo.file_size }
        : m.document ? { id: m.document.file_id, name: m.document.file_name ?? `file-${m.message_id}`, mime: m.document.mime_type ?? 'application/octet-stream', size: m.document.file_size } : null;
      if (!ref || (ref.size ?? 0) > MAX_DOWNLOAD_BYTES) continue;
      try {
        const file = await this.call<{ file_path?: string }>(this.saved.token, 'getFile', { file_id: ref.id });
        if (!file.file_path) continue;
        const res = await fetch(`${API}/file/bot${this.saved.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) continue;
        out.push({ name: ref.name, mime: ref.mime, bytes: Buffer.from(await res.arrayBuffer()) });
      } catch (err) {
        mainLogger.warn('telegram.download.failed', { error: this.scrub((err as Error).message) });
      }
    }
    return out;
  }

  private async handle(m: TgMessage, album: TgMessage[] = []): Promise<void> {
    if (!this.saved || m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
    const hasFile = !!(m.photo?.length || m.document);
    let text = (m.text ?? m.caption ?? '').trim();
    const chatId = String(m.chat.id);
    const owner = this.saved.owner;

    if (!owner) {
      const code = /^\/start\s+(\S+)/.exec(text)?.[1];
      if (code && this.pairCode && code === this.pairCode) {
        this.saved.owner = { id: m.from.id, name: nameOf(m.from) };
        this.pairCode = null;
        this.pairQr = null;
        await this.save();
        mainLogger.info('telegram.paired');
        this.setStatus('connected', this.saved.bot.username);
        await this.send(chatId, `✅ *Paired with DEX on ${os.hostname()}*\n\nSend me a task — "find me a flight to Goa on Friday" — and I'll do it on your PC. Reply to my answers to keep going.`);
      } else {
        await this.send(chatId, 'This DEX bot isn’t paired yet. Open the link in DEX › Settings › Channels › Telegram on your PC.');
      }
      return;
    }

    if (m.from.id !== owner.id) {
      if (!this.turnedAway.has(m.from.id)) {
        this.turnedAway.add(m.from.id);
        await this.send(chatId, 'This is someone’s private DEX bot.');
      }
      return;
    }

    if (/^\/start\b/.test(text)) {
      await this.send(chatId, 'Send me a task and I’ll do it on your PC. Reply to my answers to keep going; a new message starts a new task.');
      return;
    }
    if (!text && !hasFile) return;
    if (m.date * 1000 < this.startedAt - MAX_MESSAGE_AGE_MS) {
      mainLogger.info('telegram.msg.skipStale');
      return;
    }
    const attachments = hasFile ? await this.filesOf([m, ...album]) : [];
    if (!text) text = m.photo?.length ? (attachments.length > 1 ? 'Here are some pictures.' : 'Here’s a picture.') : 'Here’s a file.';

    const replied = m.reply_to_message;
    const messageId = keyOf(chatId, m.message_id);
    mainLogger.info('telegram.inbound', { textLength: text.length, reply: !!replied, files: attachments.length });
    this.messageHandler?.({
      channelId: 'telegram',
      from: String(m.from.id),
      fromName: nameOf(m.from),
      text,
      timestamp: m.date * 1000,
      conversationId: chatId,
      messageId,
      replyToMessageId: replied ? keyOf(chatId, replied.message_id) : undefined,
      quotedText: replied ? (replied.text ?? replied.caption) : undefined,
      mentioned: true,
      attachments: attachments.length ? attachments : undefined,
      ack: (emoji) => { void this.react(chatId, messageId, emoji); },
    });
  }

  private async save(): Promise<void> {
    const k = keytar();
    if (!k) throw new Error('No credential store on this system to keep the bot token in.');
    if (this.saved) await k.setPassword(SERVICE, ACCOUNT, JSON.stringify(this.saved));
  }

  private async call<T = unknown>(token: string, method: string, body?: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    const form = body instanceof FormData;
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: form ? undefined : { 'content-type': 'application/json' },
      body: form ? body : JSON.stringify(body ?? {}),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!json?.ok) throw new TelegramError(json?.error_code ?? res.status, json?.description ?? `HTTP ${res.status}`);
    return json.result as T;
  }

  /** Error text, minus the token. */
  private scrub(text: string, token = this.saved?.token): string {
    return token ? text.split(token).join('<token>') : text;
  }

  private setStatus(status: ChannelStatus, detail?: string): void {
    if (status !== 'error') this.error = undefined;
    this.status = status;
    this.statusHandler?.(status, detail);
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
