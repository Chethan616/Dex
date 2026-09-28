import { mainLogger } from '../logger';
import type { SessionManager } from '../sessions/SessionManager';
import type { WhatsAppAdapter } from './WhatsAppAdapter';
import type { InboundMessage } from './types';
import { ThreadStore } from './threadStore';
import { checkFile, MAX_FILES, type OutgoingFile } from './outbox';

export type StartSessionFn = (id: string) => Promise<void>;
/** Continue an existing session with a new message (queues if it's running). */
export type FollowUpFn = (id: string, text: string) => Promise<Record<string, unknown>>;

/** Full answers, not an 80-character teaser — WhatsApp handles long messages fine. */
const MAX_SUMMARY_CHARS = 1500;
/** Files a WhatsApp task produced that go along with its answer automatically. */
const MAX_AUTO_FILES = 5;
const FOOTER = '_↩ Reply to this to continue · @DEX starts a new task_';

/**
 * WhatsApp ↔ sessions.
 *
 * Conversations are threads, the way WhatsApp itself shows them:
 *   - "@DEX <task>" as a new message → a new task.
 *   - A WhatsApp *reply* (swipe → reply) to any message of a task — DEX's
 *     answer, or your own message that started it — → a follow-up in that
 *     same task. No "@DEX" needed.
 *   - A reply to something DEX doesn't know, with "@DEX" → a new task that
 *     gets the quoted message as context ("@DEX summarise this").
 *   - Anything else is a note to yourself and is left alone.
 *
 * Status shows as a reaction on your latest message in the thread
 * (👀 received · ⏳ taking a while · ✅ done · ❌ failed), so the chat
 * doesn't fill up with "working on it" messages; DEX's answer arrives as a
 * reply quoting what you asked.
 */
export class ChannelRouter {
  private threads = new ThreadStore();
  /** Your latest message in each session: where reactions and quotes go. */
  private anchors = new Map<string, { conversationId: string; messageId: string }>();
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
    private adapter: WhatsAppAdapter,
  ) {
    adapter.onMessage((msg) => this.handleInbound(msg));

    sessionManager.onEvent('session-completed', (session) => {
      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      const doneEvent = [...session.output].reverse().find(
        (e: { type: string }) => e.type === 'done',
      ) as { type: string; summary?: string } | undefined;
      const summary = clip((doneEvent?.summary ?? '').trim() || 'Task completed.', MAX_SUMMARY_CHARS);

      mainLogger.info('channelRouter.notify.completed', {
        sessionId: session.id,
        convId: origin.originConversationId,
      });

      this.stuckNotified.delete(session.id);
      this.reactOnAnchor(session.id, '✅');
      const convId = origin.originConversationId;
      // Whatever the task produced (its ledger's files) comes along — the
      // user is on their phone, a path on this PC is no use to them. Then
      // the answer, so it reads as the wrap-up.
      void this.sendProducedFiles(session.id)
        .catch((err) => mainLogger.warn('channelRouter.autoFiles.failed', { error: (err as Error).message }))
        .finally(() => this.sendAndTrack(session.id, convId, `✅ *Done*\n\n${summary}\n\n${FOOTER}`));
    });

    sessionManager.onEvent('session-error', (session) => {
      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      const error = clip(session.error ?? 'Unknown error', 500);

      mainLogger.info('channelRouter.notify.error', {
        sessionId: session.id,
        convId: origin.originConversationId,
      });

      this.stuckNotified.delete(session.id);
      this.reactOnAnchor(session.id, '❌');
      this.sendAndTrack(
        session.id,
        origin.originConversationId,
        `❌ *Couldn't finish*\n\n${error}\n\n_↩ Reply to this to retry or steer it · @DEX starts a new task_`,
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

      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      this.stuckNotified.add(session.id);
      mainLogger.info('channelRouter.notify.stuck', { sessionId: session.id });
      this.reactOnAnchor(session.id, '⏳');
    });
  }

  handleInbound(msg: InboundMessage): void {
    const threadSessionId = this.threads.get(msg.replyToMessageId);

    // A reply to one of a task's messages continues that task.
    if (threadSessionId && this.sessionManager.getSession(threadSessionId)) {
      this.continueSession(threadSessionId, msg);
      return;
    }

    // Only "@DEX" starts something new.
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
      replyToMessageId: msg.replyToMessageId,
      textLength: msg.text.length,
    });
    this.threads.link(msg.messageId, sessionId);
    this.anchors.set(sessionId, { conversationId: msg.conversationId, messageId: msg.messageId });
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
          this.sendAndTrack(sessionId, msg.conversationId, `❌ Couldn't continue that task: ${String(result.error)}`);
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
        originChannel: 'whatsapp',
        originConversationId: msg.conversationId,
      });

      mainLogger.info('channelRouter.newSession', {
        sessionId: id,
        promptLength: prompt.length,
        createMs: Date.now() - t0,
      });

      this.threads.link(msg.messageId, id);
      this.anchors.set(id, { conversationId: msg.conversationId, messageId: msg.messageId });
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

  /**
   * `dex-send`: deliver files into the task's WhatsApp thread — or, for a
   * task started in the hub, into your own "Message yourself" chat. Never
   * anywhere else.
   */
  async sendFiles(sessionId: string, files: OutgoingFile[], caption?: string): Promise<{ sent: number; to: string }> {
    const origin = this.sessionManager.getSessionOrigin(sessionId);
    const convId = origin.originChannel === 'whatsapp' && origin.originConversationId
      ? origin.originConversationId
      : this.adapter.selfChatJid();
    if (!convId || this.adapter.status !== 'connected') {
      throw new Error("WhatsApp isn't connected in DEX. Tell the user where the file is, and that they can connect WhatsApp in Settings → Connections.");
    }
    const quoteMessageId = this.anchors.get(sessionId)?.messageId;
    const done = this.delivered.get(sessionId) ?? new Set<string>();
    this.delivered.set(sessionId, done);
    let sent = 0;
    for (const [i, file] of files.slice(0, MAX_FILES).entries()) {
      const sentId = await this.adapter.sendFile(convId, file.path, {
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
    mainLogger.info('channelRouter.filesSent', { sessionId, sent, requested: files.length });
    return { sent, to: origin.originChannel === 'whatsapp' ? 'this WhatsApp thread' : 'your WhatsApp ("Message yourself")' };
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
    if (anchor) void this.adapter.react(anchor.conversationId, anchor.messageId, emoji);
  }

  /** Send as a reply to your latest message in the task, and remember it so replying to it continues the task. */
  private sendAndTrack(sessionId: string, convId: string, text: string): void {
    const quoteMessageId = this.anchors.get(sessionId)?.messageId;
    this.adapter.send(convId, text, { quoteMessageId })
      .then((sentId) => {
        if (sentId) {
          this.threads.link(sentId, sessionId);
          mainLogger.info('channelRouter.tracked', { sentId, sessionId });
        }
      })
      .catch((err) => {
        mainLogger.error('channelRouter.notify.sendFailed', {
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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
