import { randomUUID } from 'crypto';
import { Gateway } from '../core/gateway';
import { OwnerGate } from '../core/owner_gate';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { ConfirmationRequest, DexEvent, DexRequest } from '../core/events/types';
import { bus } from '../core/events/bus';

/**
 * Everything a remote channel does that is not talking to its own API.
 *
 * Telegram, Discord and WhatsApp differ in how they receive a message and how
 * they send one back. They do not differ in who is allowed to command Dex, how
 * progress is streamed, or how an approval is answered — so none of that lives
 * in the adapters. Three copies of an authorisation check is three chances to
 * get it wrong, and the failure mode is a stranger driving someone's desktop.
 */

export interface Inbound {
  senderId: string;
  chatType: 'direct' | 'group';
  chatId: string;
  text: string;
}

export interface Reply {
  /** Send a new message. Returns a handle if the channel supports editing. */
  send(text: string): Promise<string | undefined>;
  /** Replace an earlier message, for live progress. Optional. */
  edit?(handle: string, text: string): Promise<void>;
  /**
   * Send a file to this conversation. Optional — not every channel can.
   *
   * Where a channel cannot, the delivery agent says where the file is on the
   * machine instead. That is the honest outcome: the task produced the file,
   * and only the last step could not happen.
   */
  sendFile?(filePath: string, caption?: string): Promise<void>;
}

export interface ChannelAdapter {
  readonly source: DexRequest['source'];
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Start a conversation with the owner, rather than replying inside one.
   *
   * Optional because not every platform allows it and none of them allow it
   * unconditionally: a Telegram bot cannot message someone who has never
   * messaged it, and a Discord bot cannot DM a user who shares no server with
   * it. That is not a reason to leave it out — it is the reason it exists.
   * The Settings screen's "send yourself a test message" needs the whole path
   * exercised, because a token can be valid, the bot can be running, and the
   * owner id can be a plausible number belonging to somebody else, and every
   * status in the app would still say connected. A message that arrives is
   * the only check that covers all of it; a failure here names which part
   * broke.
   */
  sendTo?(to: string, text: string): Promise<void>;
}

/** Progress edits are rate-limited by every chat API; one a second is plenty. */
const EDIT_INTERVAL_MS = 1_100;

/** Events worth showing a phone. The rest are noise on a small screen. */
const SHOWN: ReadonlySet<string> = new Set([
  'planning', 'selecting', 'executing', 'retrying', 'awaiting', 'done', 'failed', 'cancelled',
]);

export class ChannelRuntime {
  /** Pending approvals keyed by a short code the owner can actually type. */
  private awaiting = new Map<string, { request: ConfirmationRequest; reply: Reply }>();

  constructor(
    private gateway: Gateway,
    private ownerGate: OwnerGate,
    private confirmations: ConfirmationManager,
  ) {}

  /**
   * Handle one inbound message.
   *
   * Returns quietly for anything the gate rejects. That silence is the feature:
   * replying "you are not authorised" confirms the bot is listening, tells an
   * attacker their id is merely wrong, and turns any group Dex sits in into
   * something it talks back in. A non-owner should not be able to tell Dex is
   * there at all.
   */
  async handle(
    source: DexRequest['source'],
    message: Inbound,
    reply: Reply,
  ): Promise<void> {
    const probe: DexRequest = {
      requestId: '',
      sessionId: '',
      source,
      senderId: message.senderId,
      text: message.text,
      timestamp: Date.now(),
      chatType: message.chatType,
      chatId: message.chatId,
    };

    const decision = this.ownerGate.evaluate(probe);
    if (!decision.allow) {
      if (process.env.DEX_DEBUG === 'true') {
        console.log(`\x1b[90m[${source}] ignored — ${decision.reason}\x1b[0m`);
      }
      return;
    }

    // An answer to a pending approval, not a new task.
    if (await this.tryAnswerConfirmation(decision.text, reply)) return;

    await this.run(source, message, decision.text, reply);
  }

  private async run(
    source: DexRequest['source'],
    message: Inbound,
    text: string,
    reply: Reply,
  ): Promise<void> {
    const lines: string[] = [];
    let handle: string | undefined;
    let lastEdit = 0;
    let pendingEdit: NodeJS.Timeout | undefined;

    handle = await reply.send(`⏳ ${text}`);

    const render = () => `⏳ ${text}\n\n${lines.slice(-8).join('\n')}`;

    const flush = async () => {
      if (!handle || !reply.edit) return;
      lastEdit = Date.now();
      try {
        await reply.edit(handle, render());
      } catch {
        // A failed progress edit must never fail the task it is describing.
      }
    };

    const unsubscribe = bus.subscribeAll((event: DexEvent) => {
      if (!SHOWN.has(event.type)) return;
      lines.push(`${symbolFor(event.type)} ${event.message}`);

      if (!reply.edit || !handle) return;
      const since = Date.now() - lastEdit;
      if (since >= EDIT_INTERVAL_MS) {
        void flush();
      } else if (!pendingEdit) {
        // Coalesce a burst of steps into one edit rather than being throttled
        // by the chat API and losing them.
        pendingEdit = setTimeout(() => {
          pendingEdit = undefined;
          void flush();
        }, EDIT_INTERVAL_MS - since);
      }
    });

    // Approvals raised during this task go back to the chat that asked.
    const detach = this.confirmations.registerProvider({
      name: `${source}:${message.chatId}`,
      present: (request) => void this.present(request, reply),
      withdraw: (requestId, stepId) => {
        for (const [code, entry] of this.awaiting) {
          if (entry.request.requestId === requestId && entry.request.stepId === stepId) {
            this.awaiting.delete(code);
          }
        }
      },
    });

    try {
      // The reply is handed to the Gateway so that "send it to me" resolves to
      // this conversation. Without it, a plan that produces a file has nowhere
      // to put it and the owner gets a path to a machine they are away from.
      const result = await this.gateway.handle(source, message.senderId, text, {
        source,
        send: (body: string) => reply.send(body),
        ...(reply.sendFile
          ? { sendFile: (file: string, caption?: string) => reply.sendFile!(file, caption) }
          : {}),
      });
      if (pendingEdit) clearTimeout(pendingEdit);

      const summary =
        `${result.status === 'COMPLETED' ? '✅' : result.status === 'CANCELLED' ? '⏹' : '❌'} ` +
        `${result.summary}` +
        (result.workflow ? `\n\n_via saved workflow_ \`${result.workflow}\`` : '') +
        (result.suggestSave
          ? `\n\nYou have done this ${result.suggestSave.times}× — save it from the Dex Bar.`
          : '');

      const body = lines.length ? `${lines.slice(-8).join('\n')}\n\n${summary}` : summary;

      if (handle && reply.edit) {
        await reply.edit(handle, body);
      } else {
        await reply.send(summary);
      }
    } catch (err) {
      await reply.send(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      unsubscribe();
      detach();
    }
  }

  // ── approvals over chat ───────────────────────────────────────────────────

  private async present(request: ConfirmationRequest, reply: Reply): Promise<void> {
    // Short, typeable, and unique among what is currently pending — a phone
    // keyboard is a bad place to retype a UUID.
    const code = randomUUID().slice(0, 4);
    this.awaiting.set(code, { request, reply });

    const tier = request.tier === 1 ? 'Over to you' : `Tier ${request.tier} — approval needed`;
    await reply.send(
      `⚠️ *${tier}*\n` +
        `\`${request.capability}:${request.action}\`\n` +
        `${request.description}\n\n` +
        (request.tier === 1
          ? `Reply \`/done ${code}\` once you have done it, or \`/skip ${code}\`.`
          : `Reply \`/yes ${code}\` to approve, \`/no ${code}\` to reject.`),
    );
  }

  /** Returns true if the message was an approval answer rather than a task. */
  private async tryAnswerConfirmation(text: string, reply: Reply): Promise<boolean> {
    const match = text.match(/^\/(yes|no|done|skip)\s+([a-z0-9]{4})\b/i);
    if (!match) return false;

    const [, verb, code] = match;
    const entry = this.awaiting.get(code.toLowerCase());
    if (!entry) {
      await reply.send('That approval is no longer waiting — it was answered or it timed out.');
      return true;
    }

    this.awaiting.delete(code.toLowerCase());
    const verdict =
      verb.toLowerCase() === 'yes'
        ? 'approved'
        : verb.toLowerCase() === 'done'
          ? 'handed_off'
          : 'rejected';

    // The stepVersion still travels with the answer, so an approval typed
    // against a step that has since been rewritten is refused server-side —
    // exactly as it is from the Dex Bar.
    const outcome = this.confirmations.respond(
      entry.request.requestId,
      entry.request.stepId,
      entry.request.stepVersion,
      verdict,
    );

    if (!outcome.accepted) await reply.send(`Not applied — ${outcome.reason}`);
    return true;
  }
}

function symbolFor(type: string): string {
  switch (type) {
    case 'done': return '✓';
    case 'failed': return '✗';
    case 'retrying': return '↻';
    case 'awaiting': return '⏸';
    case 'cancelled': return '⏹';
    default: return '·';
  }
}
