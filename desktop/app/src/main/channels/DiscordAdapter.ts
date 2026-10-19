/**
 * Discord: your own DEX bot, made in the Discord Developer Portal.
 *
 * DEX holds the bot's Gateway connection from this PC (a WebSocket, no
 * server) and answers with the REST API. Anyone can message a bot they share
 * a server with, so a DEX bot answers one person: whoever first sends it the
 * pairing code DEX shows (in a DM, or @mentioning it in a server) becomes its
 * owner; strangers are told it's private. Then, from the owner:
 *   - a DM, or an @mention in a server → a new task;
 *   - a reply to one of a task's messages → a follow-up in that task;
 *   - a task's questions come with buttons; a press answers;
 *   - photos and files sent with it go to the task;
 *   - status shows as a reaction, and "typing…" while it works.
 *
 * Message text in DMs and in messages that mention the bot needs no
 * privileged intent, so nothing has to be switched on in the portal. The
 * token and the owner live in the OS credential store (keytar), never in a
 * file, and the token never reaches the log.
 */
import { randomBytes } from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { mainLogger } from '../logger';
import type { ChatAdapter } from './ChannelRouter';
import type { ChatPrompt } from './chatWidgets';
import type { ChannelStatus, InboundAttachment, InboundMessage, SendOptions } from './types';

const SERVICE = 'DEX';
const ACCOUNT = 'discord';
const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
/** GUILD_MESSAGES | DIRECT_MESSAGES. */
const INTENTS = (1 << 9) | (1 << 12);
/** View channels, send messages, add reactions, embed links, attach files, read history. */
const PERMISSIONS = 1024 + 2048 + 64 + 16384 + 32768 + 65536;
const MAX_TEXT = 2000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** Messages older than this when DEX connects aren't acted on. */
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

export interface DiscordSaved {
  token: string;
  bot: { id: string; username: string; appId: string };
  owner?: { id: string; name: string };
  /** The owner's DM channel with the bot: DEX's "home" chat on Discord. */
  dm?: string;
}

/** What Settings shows. Never carries the token. */
export interface DiscordInfo {
  status: ChannelStatus;
  bot: string | null;
  owner: string | null;
  /** Adds the bot to a server of yours, so you can DM it. */
  inviteUrl: string | null;
  /** While nobody owns the bot: what to send it to pair. */
  pairCode: string | null;
  /** Your DM with the bot, once paired. */
  dmUrl: string | null;
  error?: string;
}

interface DcUser { id: string; username?: string; global_name?: string | null; bot?: boolean }
interface DcAttachment { url: string; filename: string; content_type?: string; size: number }
interface DcMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DcUser;
  content: string;
  timestamp: string;
  mentions?: DcUser[];
  attachments?: DcAttachment[];
  message_reference?: { message_id?: string };
  referenced_message?: { id: string; content?: string } | null;
}
interface DcInteraction {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  user?: DcUser;
  member?: { user: DcUser };
  data?: { custom_id?: string };
  message?: { id: string; channel_id: string };
}

class DiscordError extends Error {
  constructor(readonly status: number, description: string) {
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

/** A message's id across channels. */
const keyOf = (channelId: string, messageId: string) => `dc:${channelId}:${messageId}`;
function parseKey(key: string | undefined): { channel: string; message: string } | null {
  const m = key ? /^dc:(\d+):(\d+)$/.exec(key) : null;
  return m ? { channel: m[1], message: m[2] } : null;
}

const nameOf = (u: DcUser | undefined) => u?.global_name || u?.username || 'You';

/**
 * DEX's messages use WhatsApp's markup (*bold*, ~strike~) and agents write
 * Markdown; Discord reads Markdown, where a single * is italic.
 */
export function toDiscordMarkdown(text: string): string {
  return text.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, i) => (i % 2 ? part : part
    .replace(/(^|[\s(])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=$|[\s).,!?:;])/gm, '$1**$2**')
    .replace(/(^|[\s(])~([^\s~](?:[^~\n]*[^\s~])?)~(?=$|[\s).,!?:;])/gm, '$1~~$2~~'))).join('');
}

export class DiscordAdapter implements ChatAdapter {
  readonly id = 'discord' as const;
  status: ChannelStatus = 'disconnected';

  private saved: DiscordSaved | null = null;
  private pairCode: string | null = null;
  private error: string | undefined;
  private connectedAt = 0;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private statusHandler: ((status: ChannelStatus, detail?: string) => void) | null = null;
  private turnedAway = new Set<string>();
  private buttons = new Map<string, { label: string; reply: string }>();
  /** DEX's own reaction on each message, so a new status light replaces the old one. */
  private reactions = new Map<string, string>();

  // The Gateway connection.
  private ws: WebSocket | null = null;
  private stopped = true;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private acked = true;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  onStatusChange(handler: (status: ChannelStatus, detail?: string) => void): void {
    this.statusHandler = handler;
  }

  info(): DiscordInfo {
    const s = this.saved;
    return {
      status: this.status,
      bot: s?.bot.username ?? null,
      owner: s?.owner?.name ?? null,
      inviteUrl: s ? `https://discord.com/oauth2/authorize?client_id=${s.bot.appId}&scope=bot&permissions=${PERMISSIONS}` : null,
      pairCode: s && !s.owner ? this.pairCode : null,
      dmUrl: s?.dm ? `https://discord.com/channels/@me/${s.dm}` : null,
      error: this.status === 'error' ? this.error : undefined,
    };
  }

  homeChat(): string | null {
    return this.saved?.owner ? this.saved.dm ?? null : null;
  }

  /** Reconnect with the saved bot, if there is one. */
  async resume(): Promise<void> {
    if (!this.stopped) return;
    const raw = await keytar()?.getPassword(SERVICE, ACCOUNT).catch(() => null);
    if (!raw) return;
    try {
      this.saved = JSON.parse(raw) as DiscordSaved;
    } catch {
      return;
    }
    this.start();
  }

  /** Check a bot token from the Developer Portal, keep it, and connect. */
  async connect(token: string): Promise<DiscordInfo> {
    const clean = token.trim().replace(/^Bot\s+/i, '');
    if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(clean)) {
      throw new Error('That doesn’t look like a bot token. In the Developer Portal, open your app › Bot › Reset Token, and copy what it shows.');
    }
    this.stop();
    let me: DcUser;
    let appId: string;
    try {
      me = await this.call<DcUser>('GET', '/users/@me', undefined, clean);
      appId = (await this.call<{ id: string }>('GET', '/oauth2/applications/@me', undefined, clean).catch(() => ({ id: me.id }))).id;
    } catch (err) {
      // No `cause`: a network error's text can carry the request, token and all.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(err instanceof DiscordError && err.status === 401
        ? 'Discord didn’t accept that token. Copy it again (Bot › Reset Token) — it’s shown only once.'
        : `Couldn’t reach Discord: ${this.scrub((err as Error).message, clean)}`);
    }
    if (!me.bot) throw new Error('That’s a user token, not a bot’s. Use the token from your app’s Bot page.');
    const sameBot = this.saved?.bot.id === me.id;
    this.saved = {
      token: clean,
      bot: { id: me.id, username: me.username ?? 'DEX', appId },
      owner: sameBot ? this.saved?.owner : undefined,
      dm: sameBot ? this.saved?.dm : undefined,
    };
    await this.save();
    this.start();
    return this.info();
  }

  /** Forget the bot: disconnect and delete the token. */
  async remove(): Promise<void> {
    this.stop();
    this.saved = null;
    this.pairCode = null;
    await keytar()?.deletePassword(SERVICE, ACCOUNT).catch(() => false);
    this.setStatus('disconnected');
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.setStatus('disconnected');
  }

  async send(conversationId: string, text: string, options: SendOptions = {}): Promise<string | null> {
    if (!this.saved) return null;
    const sent = await this.call<{ id: string }>('POST', `/channels/${conversationId}/messages`, {
      content: clip(toDiscordMarkdown(text), MAX_TEXT),
      allowed_mentions: { parse: [], replied_user: false },
      ...this.replyTo(options.quoteMessageId),
    });
    mainLogger.info('discord.send', { textLength: text.length, quoted: !!options.quoteMessageId });
    return keyOf(conversationId, sent.id);
  }

  /** A message with buttons: answers as buttons, links as link buttons. */
  async sendPrompt(conversationId: string, prompt: ChatPrompt, options: SendOptions = {}): Promise<string | null> {
    if (!this.saved) return null;
    const extra: string[] = [];
    const rows = prompt.rows.map((row) => ({
      type: 1,
      components: row.flatMap((b): Array<{ type: number; style: number; label: string; custom_id?: string; url?: string }> => {
        if (b.reply) {
          const key = randomBytes(6).toString('base64url');
          this.buttons.set(key, { label: b.label, reply: b.reply });
          return [{ type: 2, style: 2, label: clip(b.label, 80), custom_id: `b:${key}` }];
        }
        if (b.url && /^https?:\/\//i.test(b.url)) return [{ type: 2, style: 5, label: clip(b.label, 80), url: b.url }];
        if (b.url) extra.push(`${b.label}: ${b.url}`);
        return [];
      }),
    })).filter((r) => r.components.length).slice(0, 5);
    while (this.buttons.size > 600) this.buttons.delete(this.buttons.keys().next().value as string);
    const sent = await this.call<{ id: string }>('POST', `/channels/${conversationId}/messages`, {
      content: clip(toDiscordMarkdown([prompt.text, ...extra].join('\n\n')), MAX_TEXT),
      components: rows,
      allowed_mentions: { parse: [], replied_user: false },
      ...this.replyTo(options.quoteMessageId),
    });
    mainLogger.info('discord.sendPrompt', { buttons: rows.reduce((n, r) => n + r.components.length, 0) });
    return keyOf(conversationId, sent.id);
  }

  async sendFile(
    conversationId: string,
    filePath: string,
    options: SendOptions & { caption?: string; fileName?: string } = {},
  ): Promise<string | null> {
    if (!this.saved) return null;
    const data = await fsPromises.readFile(filePath);
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`too large for Discord (${Math.round(data.byteLength / 1e6)} MB, max 10 MB): ${filePath}`);
    }
    const fileName = options.fileName ?? path.basename(filePath);
    const form = new FormData();
    form.set('payload_json', JSON.stringify({
      content: options.caption ? clip(toDiscordMarkdown(options.caption), MAX_TEXT) : undefined,
      attachments: [{ id: 0, filename: fileName }],
      allowed_mentions: { parse: [], replied_user: false },
      ...this.replyTo(options.quoteMessageId),
    }));
    form.set('files[0]', new Blob([data]), fileName);
    const sent = await this.call<{ id: string }>('POST', `/channels/${conversationId}/messages`, form);
    mainLogger.info('discord.sendFile', { bytes: data.byteLength });
    return keyOf(conversationId, sent.id);
  }

  async react(conversationId: string, messageId: string, emoji: string): Promise<void> {
    const ref = parseKey(messageId);
    if (!this.saved || !ref) return;
    const base = `/channels/${conversationId}/messages/${ref.message}/reactions`;
    const before = this.reactions.get(messageId);
    try {
      if (before && before !== emoji) await this.call('DELETE', `${base}/${encodeURIComponent(before)}/@me`).catch(() => {});
      await this.call('PUT', `${base}/${encodeURIComponent(emoji)}/@me`);
      this.reactions.set(messageId, emoji);
      while (this.reactions.size > 500) this.reactions.delete(this.reactions.keys().next().value as string);
    } catch (err) {
      mainLogger.warn('discord.react.failed', { error: this.scrub((err as Error).message) });
    }
  }

  typing(conversationId: string): void {
    if (this.saved) void this.call('POST', `/channels/${conversationId}/typing`).catch(() => {});
  }

  private replyTo(quoteMessageId: string | undefined): { message_reference?: { message_id: string; fail_if_not_exists: boolean } } {
    const ref = parseKey(quoteMessageId);
    return ref ? { message_reference: { message_id: ref.message, fail_if_not_exists: false } } : {};
  }

  /* ── The Gateway ─────────────────────────────────────────────────── */

  private start(): void {
    if (!this.saved) return;
    this.stopped = false;
    if (!this.saved.owner) this.pairCode = `DEX-${randomBytes(4).toString('hex').toUpperCase()}`;
    this.setStatus('connecting');
    this.open(false);
  }

  private stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHeartbeat();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* already closed */ }
    this.sessionId = null;
    this.seq = null;
  }

  private open(resume: boolean): void {
    const url = resume && this.resumeUrl ? `${this.resumeUrl}/?v=10&encoding=json` : GATEWAY;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('message', (data) => {
      if (ws !== this.ws) return;
      let frame: { op: number; d: unknown; s?: number | null; t?: string | null };
      try { frame = JSON.parse(String(data)); } catch { return; }
      this.onFrame(ws, frame, resume);
    });
    ws.on('close', (code) => this.onClose(ws, code));
    ws.on('error', (err) => mainLogger.warn('discord.gateway.error', { error: this.scrub(err.message) }));
  }

  private sendFrame(ws: WebSocket, frame: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  private onFrame(ws: WebSocket, f: { op: number; d: unknown; s?: number | null; t?: string | null }, resume: boolean): void {
    if (typeof f.s === 'number') this.seq = f.s;
    switch (f.op) {
      case 10: { // Hello: start the heartbeat, then identify (or resume).
        const every = (f.d as { heartbeat_interval: number }).heartbeat_interval;
        this.clearHeartbeat();
        this.acked = true;
        const beat = () => {
          if (!this.acked) { ws.terminate(); return; } // a zombie connection
          this.acked = false;
          this.sendFrame(ws, { op: 1, d: this.seq });
        };
        this.heartbeat = setTimeout(() => {
          beat();
          this.heartbeat = setInterval(beat, every);
        }, Math.floor(every * Math.random()));
        const token = this.saved?.token;
        if (!token) return;
        if (resume && this.sessionId) this.sendFrame(ws, { op: 6, d: { token, session_id: this.sessionId, seq: this.seq } });
        else this.sendFrame(ws, { op: 2, d: { token, intents: INTENTS, properties: { os: process.platform, browser: 'DEX', device: 'DEX' } } });
        return;
      }
      case 11: this.acked = true; return;
      case 1: this.sendFrame(ws, { op: 1, d: this.seq }); return;
      case 7: ws.close(4000); return; // Discord asks for a reconnect
      case 9: // Invalid session: start over (after a pause, as Discord asks).
        if (!f.d) { this.sessionId = null; this.seq = null; }
        setTimeout(() => { if (ws === this.ws) ws.close(4000); }, 1000 + Math.random() * 4000);
        return;
      case 0: this.dispatch(f.t ?? '', f.d); return;
    }
  }

  private dispatch(type: string, d: unknown): void {
    if (type === 'READY') {
      const ready = d as { session_id: string; resume_gateway_url: string };
      this.sessionId = ready.session_id;
      this.resumeUrl = ready.resume_gateway_url;
      this.connectedAt = Date.now();
      this.backoff = 1000;
      this.setStatus('connected', this.saved?.bot.username);
      mainLogger.info('discord.ready');
    } else if (type === 'RESUMED') {
      this.backoff = 1000;
      this.setStatus('connected', this.saved?.bot.username);
    } else if (type === 'MESSAGE_CREATE') {
      void this.handle(d as DcMessage).catch((err) => mainLogger.warn('discord.handle.failed', { error: this.scrub((err as Error).message) }));
    } else if (type === 'INTERACTION_CREATE') {
      void this.handlePress(d as DcInteraction).catch((err) => mainLogger.warn('discord.press.failed', { error: this.scrub((err as Error).message) }));
    }
  }

  private onClose(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.clearHeartbeat();
    this.ws = null;
    if (this.stopped) return;
    if (code === 4004) {
      this.fail('Discord no longer accepts this bot’s token — it may have been reset in the Developer Portal. Paste the new one.');
      return;
    }
    if (code === 4013 || code === 4014) {
      this.fail('Discord refused the connection’s permissions. Remove the bot here and add it again.');
      return;
    }
    if (code === 4007 || code === 4009) { this.sessionId = null; this.seq = null; }
    this.setStatus('connecting', 'Reconnecting…');
    mainLogger.warn('discord.gateway.closed', { code });
    this.reconnectTimer = setTimeout(() => this.open(!!this.sessionId), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  private fail(message: string): void {
    this.error = message;
    this.stopped = true;
    this.setStatus('error', message);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) { clearTimeout(this.heartbeat as ReturnType<typeof setTimeout>); clearInterval(this.heartbeat as ReturnType<typeof setInterval>); }
    this.heartbeat = null;
  }

  /* ── Messages and presses ────────────────────────────────────────── */

  private async handle(m: DcMessage): Promise<void> {
    const saved = this.saved;
    if (!saved || m.author.bot) return;
    const dm = !m.guild_id;
    const mentionsMe = m.mentions?.some((u) => u.id === saved.bot.id);
    if (!dm && !mentionsMe) return;
    let text = m.content.replace(new RegExp(`<@!?${saved.bot.id}>`, 'g'), '').trim();

    if (!saved.owner) {
      if (this.pairCode && text.toUpperCase().includes(this.pairCode)) {
        saved.owner = { id: m.author.id, name: nameOf(m.author) };
        saved.dm = (await this.call<{ id: string }>('POST', '/users/@me/channels', { recipient_id: m.author.id }).catch(() => null))?.id ?? (dm ? m.channel_id : undefined);
        this.pairCode = null;
        await this.save();
        mainLogger.info('discord.paired');
        this.setStatus('connected', saved.bot.username);
        const home = saved.dm ?? m.channel_id;
        await this.send(home, `✅ *Paired with DEX on ${os.hostname()}*\n\nSend me a task here — "find me a flight to Goa on Friday" — and I'll do it on your PC. Reply to my answers to keep going; /help shows the rest.`);
      } else if (dm) {
        await this.send(m.channel_id, 'This DEX bot isn’t paired yet. Send it the code from DEX › Settings › Channels › Discord on your PC.');
      }
      return;
    }

    if (m.author.id !== saved.owner.id) {
      if (dm && !this.turnedAway.has(m.author.id)) {
        this.turnedAway.add(m.author.id);
        await this.send(m.channel_id, 'This is someone’s private DEX bot.');
      }
      return;
    }

    const files = (m.attachments ?? []).filter((a) => a.size <= MAX_DOWNLOAD_BYTES).slice(0, 5);
    if (!text && !files.length) return;
    if (Date.parse(m.timestamp) < this.connectedAt - MAX_MESSAGE_AGE_MS) {
      mainLogger.info('discord.msg.skipStale');
      return;
    }
    const attachments: InboundAttachment[] = [];
    for (const f of files) {
      try {
        const res = await fetch(f.url, { signal: AbortSignal.timeout(60_000) });
        if (res.ok) attachments.push({ name: f.filename, mime: (f.content_type ?? 'application/octet-stream').split(';')[0], bytes: Buffer.from(await res.arrayBuffer()) });
      } catch (err) {
        mainLogger.warn('discord.download.failed', { error: (err as Error).message });
      }
    }
    if (!text) text = attachments.every((a) => a.mime.startsWith('image/')) ? (attachments.length > 1 ? 'Here are some pictures.' : 'Here’s a picture.') : 'Here’s a file.';

    const messageId = keyOf(m.channel_id, m.id);
    const repliedId = m.message_reference?.message_id;
    mainLogger.info('discord.inbound', { textLength: text.length, reply: !!repliedId, dm, files: attachments.length });
    this.messageHandler?.({
      channelId: 'discord',
      from: m.author.id,
      fromName: nameOf(m.author),
      text,
      timestamp: Date.parse(m.timestamp) || Date.now(),
      conversationId: m.channel_id,
      messageId,
      replyToMessageId: repliedId ? keyOf(m.channel_id, repliedId) : undefined,
      quotedText: m.referenced_message?.content || undefined,
      mentioned: true,
      attachments: attachments.length ? attachments : undefined,
      ack: (emoji) => { void this.react(m.channel_id, messageId, emoji); },
    });
  }

  /** A press on one of DEX's answer buttons: keep the choice on the message, send it on as the answer. */
  private async handlePress(i: DcInteraction): Promise<void> {
    if (!this.saved || i.type !== 3 || !i.message) return;
    const user = i.user ?? i.member?.user;
    const respond = (type: number, data?: unknown) => this.call('POST', `/interactions/${i.id}/${i.token}/callback`, { type, data }).catch(() => {});
    if (!user || user.id !== this.saved.owner?.id) { await respond(4, { content: 'This is someone’s private DEX bot.', flags: 64 }); return; }
    const id = i.data?.custom_id ?? '';
    const b = id.startsWith('b:') ? this.buttons.get(id.slice(2)) : undefined;
    if (!b) { await respond(4, { content: 'That question has expired — type your answer instead.', flags: 64 }); return; }
    await respond(7, { components: [{ type: 1, components: [{ type: 2, style: 3, label: clip(`✓ ${b.label}`, 80), custom_id: 'x', disabled: true }] }] });
    const channel = i.message.channel_id ?? i.channel_id ?? '';
    const messageId = keyOf(channel, i.message.id);
    mainLogger.info('discord.press');
    this.messageHandler?.({
      channelId: 'discord',
      from: user.id,
      fromName: nameOf(user),
      text: b.reply,
      timestamp: Date.now(),
      conversationId: channel,
      messageId,
      replyToMessageId: messageId,
      mentioned: true,
      pressed: true,
      ack: (emoji) => { void this.react(channel, messageId, emoji); },
    });
  }

  /* ── Plumbing ────────────────────────────────────────────────────── */

  private async save(): Promise<void> {
    const k = keytar();
    if (!k) throw new Error('No credential store on this system to keep the bot token in.');
    if (this.saved) await k.setPassword(SERVICE, ACCOUNT, JSON.stringify(this.saved));
  }

  /** A REST call, waiting out Discord's rate limits (twice at most). */
  private async call<T = unknown>(method: string, route: string, body?: Record<string, unknown> | FormData, token = this.saved?.token): Promise<T> {
    const form = body instanceof FormData;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API}${route}`, {
        method,
        headers: {
          authorization: `Bot ${token ?? ''}`,
          'user-agent': 'DiscordBot (https://github.com/Chethan616/Dex, 2)',
          ...(body && !form ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? (form ? body : JSON.stringify(body)) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const wait = ((await res.json().catch(() => null)) as { retry_after?: number } | null)?.retry_after ?? 1;
        await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
        continue;
      }
      if (res.status === 204) return undefined as T;
      const json = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) throw new DiscordError(res.status, json?.message ?? `HTTP ${res.status}`);
      return json as T;
    }
    throw new DiscordError(429, 'Discord is rate-limiting DEX; try again in a minute.');
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
