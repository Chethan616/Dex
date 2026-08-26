import { DexRequest } from './events/types';

/**
 * Who is allowed to command Dex, and when.
 *
 * Every channel funnels through here, and the decision is made in exactly one
 * place on purpose. Three adapters each implementing "is this the owner, and
 * did they use the prefix" is three chances to get it subtly wrong, and the
 * failure mode is a stranger in a group chat driving someone's desktop.
 *
 * The rules, from SAFETY.md §1:
 *   - a direct message from the owner            -> allow
 *   - a group message from the owner with @dex   -> allow, prefix stripped
 *   - a group message from the owner without it  -> ignore, silently
 *   - anything from anyone else, anywhere        -> ignore, silently
 *
 * "Silently" is load-bearing. Replying "you are not authorised" confirms the
 * bot is listening, tells an attacker their id is wrong rather than that
 * nothing is there, and turns any group Dex is in into something it talks back
 * in. A non-owner should not be able to tell Dex exists.
 */

export interface OwnerConfig {
  whatsapp?: string | null;
  telegram_id?: number | string | null;
  discord_id?: string | null;
  slack_user_id?: string | null;
  /** What summons Dex in a group. Case-insensitive. */
  trigger_prefix?: string;
}

export type GateDecision =
  | { allow: true; text: string }
  /** `reason` is for the local log only. It is never sent anywhere. */
  | { allow: false; reason: string };

const DEFAULT_PREFIX = '@dex';

export class OwnerGate {
  constructor(private config: OwnerConfig = {}) {}

  private get prefix(): string {
    return (this.config.trigger_prefix || DEFAULT_PREFIX).toLowerCase();
  }

  /** The configured owner id for a channel, or null if none is set. */
  private ownerFor(source: DexRequest['source']): string | null {
    switch (source) {
      case 'telegram':
        return this.config.telegram_id == null ? null : String(this.config.telegram_id);
      case 'discord':
        return this.config.discord_id ?? null;
      case 'whatsapp':
        return this.config.whatsapp ?? null;
      case 'slack':
        return this.config.slack_user_id ?? null;
      default:
        return null;
    }
  }

  /**
   * The full decision, including the text to actually run.
   *
   * Returns the message with the trigger prefix removed, because stripping and
   * allowing are the same decision — separating them invites a caller to act on
   * one without the other.
   */
  evaluate(request: DexRequest & { chatType?: 'direct' | 'group' }): GateDecision {
    const text = request.text.trim();

    // Local surfaces. The CLI runs as the owner by definition, and the Flutter
    // bar is restricted to loopback with a token at the connection level —
    // there is no remote sender to identify here.
    if (request.source === 'cli' || request.source === 'flutter') {
      return text ? { allow: true, text } : { allow: false, reason: 'Empty message' };
    }

    const owner = this.ownerFor(request.source);
    if (!owner) {
      return {
        allow: false,
        reason: `No owner configured for ${request.source} — refusing everything`,
      };
    }

    // Compared as trimmed strings: Telegram ids arrive as numbers from the API
    // and strings from config, and `5 == "5"` being true by accident is not a
    // property worth depending on for an authorisation check.
    if (String(request.senderId).trim() !== owner.trim()) {
      return { allow: false, reason: 'Not the owner' };
    }

    if (request.chatType !== 'group') {
      return text ? { allow: true, text } : { allow: false, reason: 'Empty message' };
    }

    // In a group, even the owner has to ask for Dex explicitly. Otherwise every
    // sentence they type to another person becomes a command.
    const stripped = stripPrefix(text, this.prefix);
    if (stripped === null) {
      return { allow: false, reason: 'Group message without the trigger prefix' };
    }
    return stripped
      ? { allow: true, text: stripped }
      : { allow: false, reason: 'Prefix with no command after it' };
  }

  /** Kept for callers that only need the yes/no. */
  verify(request: DexRequest & { chatType?: 'direct' | 'group' }): boolean {
    return this.evaluate(request).allow;
  }
}

/**
 * Removes the trigger prefix, or returns null if it is not there.
 *
 * Matches only at the start and only as a whole token: "@dexter set volume"
 * is not addressed to Dex, and treating it as though it were would run a
 * command nobody issued.
 */
function stripPrefix(text: string, prefix: string): string | null {
  const lowered = text.toLowerCase();
  if (!lowered.startsWith(prefix)) return null;

  const rest = text.slice(prefix.length);
  if (rest.length > 0 && !/^[\s,:!]/.test(rest)) return null;

  return rest.replace(/^[\s,:!]+/, '').trim();
}
