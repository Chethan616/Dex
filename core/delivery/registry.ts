/**
 * Where a task's replies can be sent back to.
 *
 * The point of this file is one sentence: **"send it to me" has to mean the
 * place the request came from.**
 *
 * A message arriving from WhatsApp is handled by a ChannelRuntime that holds a
 * `Reply` bound to that chat. By the time a plan is running, that binding is
 * three layers away — the Gateway made a plan, the Orchestrator picked a step,
 * an agent is executing it — and none of those know a WhatsApp conversation
 * exists. So the channel registers its reply against the request id on the way
 * in, and the delivery agent looks it up on the way out.
 *
 * Keyed by request, not by channel, deliberately. Dex has one owner but several
 * open conversations, and a file asked for on WhatsApp must not arrive on
 * Telegram because that adapter happened to be the last one to speak.
 *
 * Entries are removed when the task finishes. A `Reply` holds a live socket to
 * a chat service; keeping them for tasks that ended would leak a handle per
 * request and, worse, leave a stale target that a later task could deliver to.
 */

export interface DeliveryTarget {
  /** Which channel — for the message the owner sees, and for the log. */
  source: string;
  /** Send a plain message back to the conversation. */
  send(text: string): Promise<string | undefined>;
  /**
   * Send a file, if this channel can.
   *
   * Optional because not every channel can. The CLI cannot, and neither can
   * the Flutter app — for those, "the file is at C:\Users\…" is the honest
   * answer rather than a silent failure or a pretend success.
   */
  sendFile?(filePath: string, caption?: string): Promise<void>;
}

class DeliveryRegistry {
  private targets = new Map<string, DeliveryTarget>();

  /** Called by the channel runtime as a request enters. */
  register(requestId: string, target: DeliveryTarget): void {
    if (!requestId) return;
    this.targets.set(requestId, target);
  }

  get(requestId: string): DeliveryTarget | undefined {
    return this.targets.get(requestId);
  }

  /** Called when the task ends, whatever the outcome. */
  release(requestId: string): void {
    this.targets.delete(requestId);
  }

  /** For the delivery agent's error message, so it can say what IS possible. */
  canSendFiles(requestId: string): boolean {
    return typeof this.targets.get(requestId)?.sendFile === 'function';
  }
}

export const delivery = new DeliveryRegistry();
