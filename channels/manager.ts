/**
 * Channels, started and stopped while Dex is running.
 *
 * They used to be started once, in `startChannels`, from environment
 * variables. Two things were wrong with that, and the second is the one that
 * shows:
 *
 * **The owner id came from `process.env`.** The settings store already had
 * `telegramOwner` and `discordOwner`, the Settings screen already wrote them,
 * and the health check already read them — so the screen could report Telegram
 * ready while the core, reading `DEX_OWNER_TELEGRAM`, had never started it.
 * A status that is computed from different facts than the behaviour is worse
 * than no status.
 *
 * **Pairing needed a restart.** Entering a token and an owner id did nothing
 * until the core was restarted, and nothing said so. A settings screen whose
 * change only takes effect after a restart it never mentions is a settings
 * screen that lies — the same reason `set_config` already rebuilds the Brain
 * in place.
 *
 * So channels live here: started, stopped and re-read on demand, with the
 * configuration coming from the same store the screen writes to.
 */
import { ChannelAdapter, ChannelRuntime } from './base_channel';
import { DiscordChannel } from './discord';
import { TelegramChannel } from './telegram';
import { WhatsAppChannel } from './whatsapp';
import { readConfig, reloadConfig } from '../core/settings/config_store';
import { CredentialStore } from '../core/secrets/credential_store';

export type ChannelId = 'telegram' | 'discord' | 'whatsapp';

export interface ChannelState {
  id: ChannelId;
  name: string;
  /** Running right now. */
  running: boolean;
  /** Both halves of the configuration are present. */
  configured: boolean;
  /** Why it is not running, in a sentence the owner can act on. */
  reason: string;
  /** The last error from a start attempt, if it failed. */
  error?: string;
}

const NAMES: Record<ChannelId, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
};

export class ChannelManager {
  private live = new Map<ChannelId, ChannelAdapter>();
  private errors = new Map<ChannelId, string>();

  constructor(
    private runtime: ChannelRuntime,
    private credentials: CredentialStore,
  ) {}

  /**
   * What each channel needs, and whether it has it.
   *
   * A token alone is not enough: a bot listening with no configured owner
   * rejects every message, and a bot that is *running* but silently ignoring
   * everything is far harder to diagnose than one that says why it did not
   * start.
   */
  private requirements(id: ChannelId): { ready: boolean; reason: string; token?: string } {
    const config = readConfig();

    if (id === 'whatsapp') {
      // No token: WhatsApp pairs by scanning a QR code, so the opt-in is the
      // switch itself.
      if (!config.whatsappEnabled) return { ready: false, reason: 'not switched on' };
      if (!config.whatsappOwner) {
        return { ready: false, reason: 'no owner number set' };
      }
      return { ready: true, reason: '' };
    }

    const key = id === 'telegram' ? 'telegram_bot_token' : 'discord_bot_token';
    const legacy = id === 'telegram' ? 'TELEGRAM_BOT_TOKEN' : 'DISCORD_BOT_TOKEN';
    const token = this.credentials.resolve(key, legacy);
    const owner = id === 'telegram' ? config.telegramOwner : config.discordOwner;

    if (!token && !owner) return { ready: false, reason: 'not set up' };
    if (!token) return { ready: false, reason: 'no bot token' };
    if (!owner) return { ready: false, reason: 'no owner id — nobody would be allowed to talk to it' };
    return { ready: true, reason: '', token };
  }

  private build(id: ChannelId, token?: string): ChannelAdapter {
    switch (id) {
      case 'telegram':
        return new TelegramChannel(token!, this.runtime);
      case 'discord':
        return new DiscordChannel(token!, this.runtime);
      case 'whatsapp':
        return new WhatsAppChannel(this.runtime);
    }
  }

  /**
   * Start one channel, or leave it alone if it is already running.
   *
   * Returns the reason it did not start rather than throwing: a channel that
   * cannot connect is a normal state to be reported, not a failure that should
   * take down whatever asked.
   */
  async start(id: ChannelId): Promise<ChannelState> {
    if (this.live.has(id)) return this.state(id);

    const need = this.requirements(id);
    if (!need.ready) return this.state(id);

    const channel = this.build(id, need.token);
    try {
      await channel.start();
      this.live.set(id, channel);
      this.errors.delete(id);
    } catch (err) {
      this.errors.set(id, err instanceof Error ? err.message : String(err));
    }
    return this.state(id);
  }

  async stop(id: ChannelId): Promise<ChannelState> {
    const channel = this.live.get(id);
    this.live.delete(id);
    if (channel) {
      await channel.stop().catch(() => undefined);
    }
    return this.state(id);
  }

  /**
   * Bring every channel into line with the configuration as it stands now.
   *
   * Called at startup and after any settings change, so pairing takes effect
   * where the owner made it rather than at the next restart. A channel whose
   * configuration changed is stopped and started again — reconnecting with a
   * new token is the whole point, and no adapter can swap one in place.
   */
  async sync({ restart = false } = {}): Promise<ChannelState[]> {
    reloadConfig();

    for (const id of Object.keys(NAMES) as ChannelId[]) {
      const need = this.requirements(id);
      const running = this.live.has(id);

      if (!need.ready && running) {
        await this.stop(id);
      } else if (need.ready && running && restart) {
        await this.stop(id);
        await this.start(id);
      } else if (need.ready && !running) {
        await this.start(id);
      }
    }
    return this.states();
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.live.keys()]) {
      await this.stop(id);
    }
  }

  state(id: ChannelId): ChannelState {
    const need = this.requirements(id);
    const running = this.live.has(id);
    const error = this.errors.get(id);

    return {
      id,
      name: NAMES[id],
      running,
      configured: need.ready,
      reason: running ? '' : (error ? 'it could not connect' : need.reason),
      error,
    };
  }

  states(): ChannelState[] {
    return (Object.keys(NAMES) as ChannelId[]).map((id) => this.state(id));
  }

  /**
   * Send the owner a message on a channel, to prove it works.
   *
   * The point of this is that "connected" is otherwise a claim. A token can be
   * valid, the bot can be running, the owner id can be a plausible-looking
   * number that belongs to somebody else — and every screen in the app would
   * say connected. A message that arrives on the owner's phone is the only
   * check that covers the whole path.
   */
  async sendTest(id: ChannelId, text: string): Promise<{ ok: boolean; detail: string }> {
    const channel = this.live.get(id);
    if (!channel) {
      const state = this.state(id);
      return {
        ok: false,
        detail: state.configured
          ? `${state.name} is not running${state.error ? `: ${state.error}` : ''}`
          : `${state.name} is ${state.reason}`,
      };
    }

    const config = readConfig();
    const owner =
      id === 'telegram' ? config.telegramOwner
      : id === 'discord' ? config.discordOwner
      : config.whatsappOwner;

    try {
      const sendTo = (channel as ChannelAdapter & {
        sendTo?: (to: string, text: string) => Promise<void>;
      }).sendTo;

      if (typeof sendTo !== 'function') {
        return {
          ok: false,
          detail: `${NAMES[id]} cannot start a conversation — message it first, then reply`,
        };
      }

      await sendTo.call(channel, owner, text);
      return { ok: true, detail: `Sent to ${owner} on ${NAMES[id]}` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
