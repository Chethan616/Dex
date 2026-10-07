import { mainLogger } from '../logger';
import type { SessionManager } from '../sessions/SessionManager';
import type { ChannelStatus, InboundMessage, SendOptions } from './types';
import { ThreadStore } from './threadStore';
import { checkFile, MAX_FILES, type OutgoingFile } from './outbox';

export type StartSessionFn = (id: string) => Promise<void>;
/** Continue an existing session with a new message (queues if it's running). */
export type FollowUpFn = (id: string, text: string) => Promise<Record<string, unknown>>;

/** The chat apps a task can come from and answer to. */
export type ChatChannel = 'whatsapp' | 'telegram';

/** What the router needs from a chat app (WhatsAppAdapter, TelegramAdapter). */
export interface ChatAdapter {
  status: ChannelStatus;
  onMessage(handler: (msg: InboundMessage) => void): void;
  send(conversationId: string, text: string, options?: SendOptions): Promise<string | null>;
  sendFile(conversationId: string, filePath: string, options?: SendOptions & { caption?: string; fileName?: string }): Promise<string | null>;
  react(conversationId: string, messageId: string, emoji: string): Promise<void>;
  /** Your own chat — "Message yourself", or your chat with your DEX bot. The only place DEX sends to on its own. */
  homeChat(): string | null;
}

const LABEL: Record<ChatChannel, { name: string; home: string; thread: string; newTask: string }> = {
  whatsapp: { name: 'WhatsApp', home: 'your WhatsApp ("Message yourself")', thread: 'this WhatsApp thread', newTask: '@DEX starts a new task' },
  telegram: { name: 'Telegram', home: 'your DEX bot on Telegram', thread: 'this Telegram chat', newTask: 'a new message starts a new task' },
};

/** Full answers, not an 80-character teaser — both apps handle long messages fine. */
const MAX_SUMMARY_CHARS = 1500;
/** Files a chat task produced that go along with its answer automatically. */
const MAX_AUTO_FILES = 5;

/**
 * WhatsApp and Telegram ↔ sessions.
 *
 * Conversations are threads, the way the apps themselves show them:
 *   - A new task: "@DEX <task>" in WhatsApp's "Message yourself" chat, or
 *     any message to your DEX bot on Telegram.
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
  }

  /** The chat a session came from, when it came from one this router serves. */
  private chatOrigin(sessionId: string): { channel: ChatChannel; conversationId: string } | null {
    const origin = this.sessionManager.getSessionOrigin(sessionId);
    const channel = origin.originChannel as ChatChannel | null;
    if (!channel || !this.adapters[channel] || !origin.originConversationId) return null;
    return { channel, conversationId: origin.originConversationId };
  }

  handleInbound(msg: InboundMessage): void {
    const threadSessionId = this.threads.get(msg.replyToMessageId);

    // A reply to one of a task's messages continues that task.
    if (threadSessionId && this.sessionManager.getSession(threadSessionId)) {
      this.continueSession(threadSessionId, msg);
      return;
    }

    // Only "@DEX" (or any message to the Telegram bot) starts something new.
    if (!msg.mentioned) {
      mainLogger.info('channelRouter.ignored', { reason: msg.replyToMessageId ? 'replyToUnknown' : 'noTrigger' });
      return;
    }

    const prompt = msg.replyToMessageId && msg.quotedText
      ? `${msg.text}\n\nContext — the message I'm replying to:\n"""\n${clip(msg.quotedText, 4000)}\n"""`
      : msg.text;
    this.createNewSession(msg, prompt);
  }

  private continueSession(sessionId: string, msg: InboundMessage): void {
    mainLogger.info('channelRouter.replyFollowUp', {
      sessionId,
      channel: msg.channelId,
      replyToMessageId: msg.replyToMessageId,
      textLength: msg.text.length,
    });
    this.threads.link(msg.messageId, sessionId);
    this.setAnchor(sessionId, msg);
    msg.ack?.('👀');

    if (!this.followUpFn) {
      mainLogger.error('channelRouter.followUpUnavailable', { sessionId });
      msg.ack?.('❌');
      return;
    }
    this.followUpFn(sessionId, msg.text)
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

  private createNewSession(msg: InboundMessage, prompt: string): void {
    const t0 = Date.now();
    try {
      const id = this.sessionManager.createSession(prompt, {
        originChannel: msg.channelId,
        originConversationId: msg.conversationId,
      });

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
    for (const channel of ['whatsapp', 'telegram'] as const) {
      const adapter = this.adapters[channel];
      const home = adapter?.status === 'connected' ? adapter.homeChat() : null;
      if (home) return { channel, conversationId: home, thread: false };
    }
    throw new Error("Neither WhatsApp nor Telegram is connected in DEX. Tell the user where the file is, and that they can connect one in Settings → Channels.");
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
    this.anchors.clear();
    this.stuckNotified.clear();
    this.delivered.clear();
  }
}

function asChat(channelId: string): ChatChannel | null {
  return channelId === 'whatsapp' || channelId === 'telegram' ? channelId : null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
