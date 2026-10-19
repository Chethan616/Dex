import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';
import type { SessionManager } from '../sessions/SessionManager';
import { classifyMime, maxBytesForMime } from '../sessions/db-constants';
import type { Widget } from '../../shared/widgets';
import type { ChannelStatus, InboundAttachment, InboundMessage, SendOptions } from './types';
import { ThreadStore } from './threadStore';
import { checkFile, MAX_FILES, type OutgoingFile } from './outbox';
import { numbered, pickedReply, widgetToChat, type ChatPrompt } from './chatWidgets';

export type StartSessionFn = (id: string) => Promise<void>;
/** Continue an existing session with a new message (queues if it's running). */
export type FollowUpFn = (id: string, text: string, attachments?: InboundAttachment[]) => Promise<Record<string, unknown>>;

/** The chat apps a task can come from and answer to. */
export type ChatChannel = 'whatsapp' | 'telegram' | 'discord';
const CHATS: readonly ChatChannel[] = ['whatsapp', 'telegram', 'discord'];

/** What the router needs from a chat app (WhatsAppAdapter, TelegramAdapter, DiscordAdapter). */
export interface ChatAdapter {
  status: ChannelStatus;
  onMessage(handler: (msg: InboundMessage) => void): void;
  send(conversationId: string, text: string, options?: SendOptions): Promise<string | null>;
  sendFile(conversationId: string, filePath: string, options?: SendOptions & { caption?: string; fileName?: string }): Promise<string | null>;
  react(conversationId: string, messageId: string, emoji: string): Promise<void>;
  /** Your own chat — "Message yourself", or your chat with your DEX bot. The only place DEX sends to on its own. */
  homeChat(): string | null;
  /** A message with real buttons (Telegram, Discord). Without it, answers go numbered. */
  sendPrompt?(conversationId: string, prompt: ChatPrompt, options?: SendOptions): Promise<string | null>;
  /** "typing…" in the chat for a few seconds. */
  typing?(conversationId: string): void;
}

const LABEL: Record<ChatChannel, { name: string; home: string; thread: string; newTask: string }> = {
  whatsapp: { name: 'WhatsApp', home: 'your WhatsApp ("Message yourself")', thread: 'this WhatsApp thread', newTask: '@DEX starts a new task' },
  telegram: { name: 'Telegram', home: 'your DEX bot on Telegram', thread: 'this Telegram chat', newTask: 'a new message starts a new task' },
  discord: { name: 'Discord', home: 'your DEX bot on Discord', thread: 'this Discord chat', newTask: 'a new message starts a new task' },
};

/** A question DEX asked in a chat answers to the next message there for this long. */
const QUESTION_WINDOW_MS = 30 * 60_000;
/** Chat apps' "typing…" fades after ~5 s; refreshed while a task works. */
const TYPING_EVERY_MS = 4_500;
/** Never type for longer than this in one go (a stuck task shouldn't look busy forever). */
const TYPING_MAX_MS = 15 * 60_000;

const HELP: Record<ChatChannel, string> = {
  whatsapp: "*DEX on WhatsApp*\n\n• *@DEX <task>* starts a task: \"@DEX find me a flight to Goa on Friday\"\n• ↩ *Reply* to any of DEX's messages to keep going, or answer its question with a number\n• Send a photo or file with *@DEX* in the caption and DEX gets it\n• *@DEX status* — what's running · *@DEX stop* — stop it (reply to a task to stop that one)",
  telegram: "*DEX on Telegram*\n\n• Send a task: \"find me a flight to Goa on Friday\"\n• Tap DEX's buttons, or ↩ reply to keep going\n• Send a photo or file and DEX gets it\n• /status — what's running · /stop — stop it · /new — start fresh",
  discord: "*DEX on Discord*\n\n• Send a task: \"find me a flight to Goa on Friday\"\n• Press DEX's buttons, or reply to keep going\n• Send a photo or file and DEX gets it\n• /status — what's running · /stop — stop it · /new — start fresh",
};

/** Where files sent from a chat land, so the task (and you, later) can find them. */
function inboxDir(): string {
  return path.join(app.getPath('downloads'), 'DEX from chats', new Date().toISOString().slice(0, 10));
}

/** Full answers, not an 80-character teaser — both apps handle long messages fine. */
const MAX_SUMMARY_CHARS = 1500;
/** Files a chat task produced that go along with its answer automatically. */
const MAX_AUTO_FILES = 5;

/**
 * WhatsApp, Telegram and Discord ↔ sessions.
 *
 * Conversations are threads, the way the apps themselves show them:
 *   - A new task: "@DEX <task>" in WhatsApp's "Message yourself" chat, or
 *     any message to your DEX bot on Telegram or Discord.
 *   - A question the task asks (dex-ui) arrives with buttons (numbered on
 *     WhatsApp); a tap, a number or the next message answers it.
 *   - /stop, /status, /help, /new (WhatsApp: "@DEX stop" …).
 *   - A *reply* (swipe → reply) to any message of a task — DEX's answer, or
 *     your own message that started it — → a follow-up in that same task.
 *   - On WhatsApp, a reply to something DEX doesn't know, with "@DEX" → a new
 *     task that gets the quoted message as context ("@DEX summarise this").
 *   - Anything else in WhatsApp is a note to yourself and is left alone.
 *
 * Status shows as a reaction on your latest message in the thread
 * (👀 received · ⏳ taking a while · ✅ done · ❌ failed), so the chat
 * doesn't fill up with "working on it" messages; DEX's answer arrives as a
 * reply quoting what you asked. A task answers in the app it came from.
 */
export class ChannelRouter {
  private threads = new ThreadStore();
  /** Your latest message in each session: where reactions and quotes go. */
  private anchors = new Map<string, { channel: ChatChannel; conversationId: string; messageId: string }>();
  private stuckNotified = new Set<string>();
  /** Files already delivered per session, so the Done message doesn't repeat them. */
  private delivered = new Map<string, Set<string>>();
  private startSessionFn: StartSessionFn | null = null;
  private followUpFn: FollowUpFn | null = null;
  /** The question DEX is waiting on in each chat ("whatsapp:<chat>"): the next message answers it. */
  private questions = new Map<string, { sessionId: string; replies: string[]; labels: string[]; at: number }>();
  /** Sessions whose turn ended on a question — no "Done" for those, it isn't. */
  private asked = new Set<string>();
  private typingTimers = new Map<string, { timer: ReturnType<typeof setInterval>; since: number }>();

  setStartSession(fn: StartSessionFn): void {
    this.startSessionFn = fn;
  }

  setFollowUp(fn: FollowUpFn): void {
    this.followUpFn = fn;
  }

  constructor(
    private sessionManager: SessionManager,
    private adapters: Partial<Record<ChatChannel, ChatAdapter>>,
  ) {
    for (const adapter of Object.values(adapters)) adapter?.onMessage((msg) => this.handleInbound(msg));

    sessionManager.onEvent('session-completed', (session) => {
      const origin = this.chatOrigin(session.id);
      if (!origin) return;

      const doneEvent = [...session.output].reverse().find(
        (e: { type: string }) => e.type === 'done',
      ) as { type: string; summary?: string } | undefined;
      const summary = clip((doneEvent?.summary ?? '').trim() || 'Task completed.', MAX_SUMMARY_CHARS);

      mainLogger.info('channelRouter.notify.completed', {
        sessionId: session.id,
        channel: origin.channel,
        convId: origin.conversationId,
      });

      this.stuckNotified.delete(session.id);
      this.stopTyping(session.id);
      if (this.asked.has(session.id)) {
        // The turn ended on a question shown as its own message: that's what the user answers.
        this.asked.delete(session.id);
        this.reactOnAnchor(session.id, '🤔');
        if (summary.length > 300) this.sendAndTrack(session.id, origin.channel, origin.conversationId, summary);
        return;
      }
      this.reactOnAnchor(session.id, '✅');
      // Whatever the task produced (its ledger's files) comes along — the
      // user is on their phone, a path on this PC is no use to them. Then
      // the answer, so it reads as the wrap-up.
      void this.sendProducedFiles(session.id)
        .catch((err) => mainLogger.warn('channelRouter.autoFiles.failed', { error: (err as Error).message }))
        .finally(() => this.sendAndTrack(
          session.id,
          origin.channel,
          origin.conversationId,
          `✅ *Done*\n\n${summary}\n\n_↩ Reply to this to continue · ${LABEL[origin.channel].newTask}_`,
        ));
    });

    sessionManager.onEvent('session-error', (session) => {
      const origin = this.chatOrigin(session.id);
      if (!origin) return;

      const error = clip(session.error ?? 'Unknown error', 500);

      mainLogger.info('channelRouter.notify.error', {
        sessionId: session.id,
        channel: origin.channel,
        convId: origin.conversationId,
      });

      this.stuckNotified.delete(session.id);
      this.stopTyping(session.id);
      this.asked.delete(session.id);
      this.reactOnAnchor(session.id, '❌');
      this.sendAndTrack(
        session.id,
        origin.channel,
        origin.conversationId,
        `❌ *Couldn't finish*\n\n${error}\n\n_↩ Reply to this to retry or steer it · ${LABEL[origin.channel].newTask}_`,
      );
    });

    // "Stuck" only means 30s without progress — often just a slow page. That
    // deserves a status light, not a message claiming it needs input.
    sessionManager.onEvent('session-updated', (session) => {
      if (session.status === 'running' && !this.asked.has(session.id)) this.startTyping(session.id);
      else if (session.status !== 'stuck') this.stopTyping(session.id);
      if (session.status !== 'stuck') {
        if (session.status === 'running' && this.stuckNotified.delete(session.id)) {
          this.reactOnAnchor(session.id, '👀');
        }
        return;
      }
      if (this.stuckNotified.has(session.id)) return;
      if (!this.chatOrigin(session.id)) return;

      this.stuckNotified.add(session.id);
      mainLogger.info('channelRouter.notify.stuck', { sessionId: session.id });
      this.reactOnAnchor(session.id, '⏳');
    });

    // A widget the task showed (dex-ui): in the chat, as a message with buttons.
    sessionManager.onEvent('session-output', (id, event) => {
      const ev = event as { type?: string; widget?: Widget };
      if (ev?.type !== 'widget' || !ev.widget) return;
      const origin = this.chatOrigin(id);
      if (origin) this.showWidget(id, origin.channel, origin.conversationId, ev.widget);
    });
  }

  private showWidget(sessionId: string, channel: ChatChannel, conversationId: string, widget: Widget): void {
    const adapter = this.adapters[channel];
    const prompt = adapter ? widgetToChat(widget) : null;
    if (!adapter || !prompt) return;
    const picks = prompt.rows.flat().filter((b) => b.reply);
    if (prompt.asks) {
      this.questions.set(`${channel}:${conversationId}`, {
        sessionId,
        replies: picks.map((b) => b.reply as string),
        labels: picks.map((b) => b.label.replace(/^\d+\.\s*/, '')),
        at: Date.now(),
      });
      this.asked.add(sessionId);
      this.stopTyping(sessionId);
    }
    const anchor = this.anchors.get(sessionId);
    const quoteMessageId = anchor?.channel === channel ? anchor.messageId : undefined;
    const sending = adapter.sendPrompt && prompt.rows.length
      ? adapter.sendPrompt(conversationId, prompt, { quoteMessageId })
      : adapter.send(conversationId, numbered(prompt).text, { quoteMessageId });
    mainLogger.info('channelRouter.widget', { sessionId, channel, type: widget.type, buttons: picks.length, asks: prompt.asks });
    sending
      .then((sentId) => { if (sentId) this.threads.link(sentId, sessionId); })
      .catch((err) => mainLogger.warn('channelRouter.widget.failed', { channel, error: (err as Error).message }));
  }

  private startTyping(sessionId: string): void {
    if (this.typingTimers.has(sessionId)) return;
    const origin = this.chatOrigin(sessionId);
    const adapter = origin ? this.adapters[origin.channel] : undefined;
    if (!origin || !adapter?.typing) return;
    const tick = () => {
      const t = this.typingTimers.get(sessionId);
      if (t && Date.now() - t.since > TYPING_MAX_MS) { this.stopTyping(sessionId); return; }
      try { adapter.typing?.(origin.conversationId); } catch { /* best-effort */ }
    };
    this.typingTimers.set(sessionId, { timer: setInterval(tick, TYPING_EVERY_MS), since: Date.now() });
    tick();
  }

  private stopTyping(sessionId: string): void {
    const t = this.typingTimers.get(sessionId);
    if (t) clearInterval(t.timer);
    this.typingTimers.delete(sessionId);
  }

  /** The chat a session came from, when it came from one this router serves. */
  private chatOrigin(sessionId: string): { channel: ChatChannel; conversationId: string } | null {
    const origin = this.sessionManager.getSessionOrigin(sessionId);
    const channel = origin.originChannel as ChatChannel | null;
    if (!channel || !this.adapters[channel] || !origin.originConversationId) return null;
    return { channel, conversationId: origin.originConversationId };
  }

  handleInbound(msg: InboundMessage): void {
    if (this.command(msg)) return;
    const threadSessionId = this.threads.get(msg.replyToMessageId);
    const qKey = `${msg.channelId}:${msg.conversationId}`;
    const question = this.questions.get(qKey);

    // A reply to one of a task's messages continues that task ("2" picks DEX's second answer).
    if (threadSessionId && this.sessionManager.getSession(threadSessionId)) {
      if (question?.sessionId === threadSessionId) {
        this.questions.delete(qKey);
        const picked = msg.pressed ? null : pickedReply(msg.text, question.replies, question.labels);
        if (picked) msg = { ...msg, text: picked };
      }
      this.continueSession(threadSessionId, msg);
      return;
    }

    // DEX just asked something here: the next message answers it. On WhatsApp,
    // where the chat is also your notes, only a pick ("2", or an answer's own
    // words) counts without a swipe-reply.
    if (question && !msg.replyToMessageId && Date.now() - question.at < QUESTION_WINDOW_MS && this.sessionManager.getSession(question.sessionId)) {
      const picked = pickedReply(msg.text, question.replies, question.labels);
      if (picked || msg.channelId !== 'whatsapp') {
        this.questions.delete(qKey);
        this.continueSession(question.sessionId, { ...msg, text: picked ?? msg.text });
        return;
      }
    }

    // Only "@DEX" (or any message to the Telegram bot) starts something new.
    if (!msg.mentioned) {
      mainLogger.info('channelRouter.ignored', { reason: msg.replyToMessageId ? 'replyToUnknown' : 'noTrigger' });
      return;
    }

    const { text, attachments } = this.withFiles(msg);
    const prompt = msg.replyToMessageId && msg.quotedText
      ? `${text}\n\nContext — the message I'm replying to:\n"""\n${clip(msg.quotedText, 4000)}\n"""`
      : text;
    this.createNewSession(msg, prompt, attachments);
  }

  /**
   * Files sent with a message: saved under Downloads › DEX from chats (named
   * in the prompt, so the task can use them); pictures, PDFs and text also go
   * to the model as attachments, so it sees them.
   */
  private withFiles(msg: InboundMessage): { text: string; attachments: InboundAttachment[] } {
    const files = msg.attachments ?? [];
    if (!files.length) return { text: msg.text, attachments: [] };
    const saved: string[] = [];
    const attachments: InboundAttachment[] = [];
    for (const f of files.slice(0, 5)) {
      try {
        const dir = inboxDir();
        fs.mkdirSync(dir, { recursive: true });
        const safe = [...f.name].filter((c) => c.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(c)).join('').slice(0, 120) || 'file';
        const { name, ext } = path.parse(safe);
        let target = path.join(dir, safe);
        for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${name} (${i})${ext}`);
        fs.writeFileSync(target, f.bytes);
        saved.push(target);
      } catch (err) {
        mainLogger.warn('channelRouter.inboundFile.saveFailed', { error: (err as Error).message });
      }
      const kind = classifyMime(f.mime);
      if (kind !== 'other' && f.bytes.byteLength > 0 && f.bytes.byteLength <= maxBytesForMime(f.mime)) attachments.push(f);
    }
    mainLogger.info('channelRouter.inboundFiles', { count: files.length, saved: saved.length, attached: attachments.length });
    const list = saved.length ? `\n\n(Sent with this message, saved on this PC: ${saved.join(', ')})` : '';
    return { text: `${msg.text}${list}`, attachments };
  }

  /**
   * /stop, /status, /help, /new on Telegram and Discord; "@DEX stop",
   * "@DEX status", "@DEX help" on WhatsApp. True when it was one.
   */
  private command(msg: InboundMessage): boolean {
    const channel = asChat(msg.channelId);
    if (!channel || msg.pressed) return false;
    const t = msg.text.trim();
    const m = channel === 'whatsapp'
      ? (msg.mentioned ? /^(stop|cancel|status|help)\s*$/i.exec(t) : null)
      : /^\/(stop|cancel|status|help|new)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(t);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const say = (text: string) => { void this.adapters[channel]?.send(msg.conversationId, text, { quoteMessageId: msg.messageId }).catch(() => null); };
    const mine = this.chatSessions(channel, msg.conversationId);
    const live = mine.filter((s) => s.status === 'running' || s.status === 'stuck' || s.status === 'paused');
    mainLogger.info('channelRouter.command', { channel, cmd, live: live.length });

    if (cmd === 'help') { say(HELP[channel]); return true; }
    if (cmd === 'new') {
      this.questions.delete(`${channel}:${msg.conversationId}`);
      const rest = (m[2] ?? '').trim();
      if (!rest) { say('OK — send the new task.'); return true; }
      const { text, attachments } = this.withFiles({ ...msg, text: rest });
      this.createNewSession({ ...msg, text: rest }, text, attachments);
      return true;
    }
    if (cmd === 'status') {
      if (!mine.length) { say('No tasks from this chat yet.'); return true; }
      const icon: Record<string, string> = { running: '⏳', stuck: '⏳', paused: '⏸', idle: '✅', stopped: '⏹', draft: '•' };
      const lines = mine.slice(0, 6).map((s) => `${icon[s.status] ?? '•'} ${clip(s.prompt.split('\n')[0], 70)}${s.status === 'running' || s.status === 'stuck' ? ` — working, ${ageOf(s.createdAt)}` : s.status === 'paused' ? ' — paused' : ''}`);
      say(`${live.length ? `*${live.length} running*` : '*Nothing running*'}\n\n${lines.join('\n')}`);
      return true;
    }
    // stop / cancel: the task you replied to, else the newest running one here.
    const target = this.threads.get(msg.replyToMessageId) ?? live[0]?.id;
    const session = target ? this.sessionManager.getSession(target) : undefined;
    if (!session || !['running', 'stuck', 'paused'].includes(session.status)) { say('Nothing is running here.'); return true; }
    this.sessionManager.cancelSession(session.id);
    this.stopTyping(session.id);
    this.reactOnAnchor(session.id, '❌');
    say(`⏹ Stopped “${clip(session.prompt.split('\n')[0], 80)}”.`);
    return true;
  }

  /** Tasks that came from this chat, newest first. */
  private chatSessions(channel: ChatChannel, conversationId: string): Array<{ id: string; prompt: string; status: string; createdAt: number }> {
    return this.sessionManager.listSessions().filter((s) => {
      const o = this.sessionManager.getSessionOrigin(s.id);
      return o.originChannel === channel && o.originConversationId === conversationId;
    });
  }

  private continueSession(sessionId: string, msg: InboundMessage): void {
    mainLogger.info('channelRouter.replyFollowUp', {
      sessionId,
      channel: msg.channelId,
      replyToMessageId: msg.replyToMessageId,
      textLength: msg.text.length,
      pressed: !!msg.pressed,
    });
    this.threads.link(msg.messageId, sessionId);
    this.setAnchor(sessionId, msg);
    this.asked.delete(sessionId);
    msg.ack?.('👀');
    const { text, attachments } = this.withFiles(msg);

    if (!this.followUpFn) {
      mainLogger.error('channelRouter.followUpUnavailable', { sessionId });
      msg.ack?.('❌');
      return;
    }
    (attachments.length ? this.followUpFn(sessionId, text, attachments) : this.followUpFn(sessionId, text))
      .then((result) => {
        if (result?.error) {
          mainLogger.warn('channelRouter.followUpFailed', { sessionId, error: String(result.error) });
          msg.ack?.('❌');
          const channel = asChat(msg.channelId);
          if (channel) this.sendAndTrack(sessionId, channel, msg.conversationId, `❌ Couldn't continue that task: ${String(result.error)}`);
        }
      })
      .catch((err) => {
        mainLogger.error('channelRouter.followUpFailed', { sessionId, error: (err as Error).message });
        msg.ack?.('❌');
      });
  }

  private createNewSession(msg: InboundMessage, prompt: string, attachments: InboundAttachment[] = []): void {
    const t0 = Date.now();
    try {
      const id = this.sessionManager.createSession(prompt, {
        originChannel: msg.channelId,
        originConversationId: msg.conversationId,
      });
      if (attachments.length) {
        try {
          const turn = this.sessionManager.getNextAttachmentTurnIndex(id);
          for (const a of attachments) this.sessionManager.saveAttachment(id, a, turn);
        } catch (err) {
          mainLogger.warn('channelRouter.attachments.failed', { sessionId: id, error: (err as Error).message });
        }
      }

      mainLogger.info('channelRouter.newSession', {
        sessionId: id,
        channel: msg.channelId,
        promptLength: prompt.length,
        createMs: Date.now() - t0,
      });

      this.threads.link(msg.messageId, id);
      this.setAnchor(id, msg);
      msg.ack?.('👀');

      const onStartFailed = (err: unknown) => {
        mainLogger.error('channelRouter.startSessionFailed', {
          sessionId: id,
          error: (err as Error).message,
        });
        msg.ack?.('❌');
      };
      if (this.startSessionFn) {
        this.startSessionFn(id).catch(onStartFailed);
      } else {
        this.sessionManager.startSession(id);
      }
    } catch (err) {
      mainLogger.error('channelRouter.createSessionFailed', {
        error: (err as Error).message,
      });
      msg.ack?.('❌');
    }
  }

  private setAnchor(sessionId: string, msg: InboundMessage): void {
    const channel = asChat(msg.channelId);
    if (channel) this.anchors.set(sessionId, { channel, conversationId: msg.conversationId, messageId: msg.messageId });
  }

  /**
   * `dex-send`: deliver files into the task's chat thread — or, for a task
   * started in the hub, into your own chat (WhatsApp first, else your
   * Telegram bot). Never anywhere else.
   */
  async sendFiles(sessionId: string, files: OutgoingFile[], caption?: string): Promise<{ sent: number; to: string }> {
    const target = this.fileTarget(sessionId);
    const adapter = this.adapters[target.channel];
    if (!adapter) throw new Error(`${LABEL[target.channel].name} isn't set up in DEX.`);
    const anchor = this.anchors.get(sessionId);
    const quoteMessageId = anchor?.channel === target.channel ? anchor.messageId : undefined;
    const done = this.delivered.get(sessionId) ?? new Set<string>();
    this.delivered.set(sessionId, done);
    let sent = 0;
    for (const [i, file] of files.slice(0, MAX_FILES).entries()) {
      const sentId = await adapter.sendFile(target.conversationId, file.path, {
        fileName: file.fileName,
        caption: i === 0 ? caption : undefined,
        quoteMessageId: i === 0 ? quoteMessageId : undefined,
      });
      if (sentId) {
        sent++;
        done.add(file.path.toLowerCase());
        this.threads.link(sentId, sessionId);
      }
    }
    mainLogger.info('channelRouter.filesSent', { sessionId, channel: target.channel, sent, requested: files.length });
    return { sent, to: target.thread ? LABEL[target.channel].thread : LABEL[target.channel].home };
  }

  /** Where a task's files go: its own chat, else your own chat in a connected app. */
  private fileTarget(sessionId: string): { channel: ChatChannel; conversationId: string; thread: boolean } {
    const origin = this.chatOrigin(sessionId);
    if (origin) {
      if (this.adapters[origin.channel]?.status !== 'connected') {
        throw new Error(`${LABEL[origin.channel].name} isn't connected in DEX right now. Tell the user where the file is, and that they can reconnect it in Settings → Channels.`);
      }
      return { ...origin, thread: true };
    }
    for (const channel of CHATS) {
      const adapter = this.adapters[channel];
      const home = adapter?.status === 'connected' ? adapter.homeChat() : null;
      if (home) return { channel, conversationId: home, thread: false };
    }
    throw new Error("No chat app (WhatsApp, Telegram or Discord) is connected in DEX. Tell the user where the file is, and that they can connect one in Settings → Channels.");
  }

  /** The task's recorded files (`dex-state file`) not already sent with dex-send. */
  private async sendProducedFiles(sessionId: string): Promise<void> {
    const recorded = this.sessionManager.getTaskState(sessionId)?.files ?? [];
    const already = this.delivered.get(sessionId);
    const pending: OutgoingFile[] = [];
    for (const f of recorded) {
      if (pending.length >= MAX_AUTO_FILES) break;
      const checked = await checkFile(f.path);
      if ('error' in checked || already?.has(checked.path.toLowerCase())) continue;
      pending.push({ path: checked.path, fileName: f.name });
    }
    if (pending.length > 0) await this.sendFiles(sessionId, pending);
  }

  private reactOnAnchor(sessionId: string, emoji: string): void {
    const anchor = this.anchors.get(sessionId);
    if (anchor) void this.adapters[anchor.channel]?.react(anchor.conversationId, anchor.messageId, emoji);
  }

  /** Send as a reply to your latest message in the task, and remember it so replying to it continues the task. */
  private sendAndTrack(sessionId: string, channel: ChatChannel, convId: string, text: string): void {
    const adapter = this.adapters[channel];
    if (!adapter) return;
    const anchor = this.anchors.get(sessionId);
    const quoteMessageId = anchor?.channel === channel ? anchor.messageId : undefined;
    adapter.send(convId, text, { quoteMessageId })
      .then((sentId) => {
        if (sentId) {
          this.threads.link(sentId, sessionId);
          mainLogger.info('channelRouter.tracked', { sentId, sessionId, channel });
        }
      })
      .catch((err) => {
        mainLogger.error('channelRouter.notify.sendFailed', {
          channel,
          error: (err as Error).message,
        });
      });
  }

  destroy(): void {
    for (const id of [...this.typingTimers.keys()]) this.stopTyping(id);
    this.questions.clear();
    this.anchors.clear();
    this.stuckNotified.clear();
    this.delivered.clear();
  }
}

function asChat(channelId: string): ChatChannel | null {
  return (CHATS as readonly string[]).includes(channelId) ? channelId as ChatChannel : null;
}

function ageOf(at: number): string {
  const m = Math.max(1, Math.round((Date.now() - at) / 60_000));
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
