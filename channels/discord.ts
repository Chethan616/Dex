import { Client, Events, GatewayIntentBits, Message, Partials } from 'discord.js';
import { ChannelAdapter, ChannelRuntime, Reply } from './base_channel';

/**
 * Discord, via discord.js v14.
 *
 * Needs the MESSAGE CONTENT intent enabled on the application, which Discord
 * gates deliberately — without it every message arrives with an empty body and
 * Dex would look broken rather than unprivileged, so that case is reported
 * explicitly at startup.
 */
export class DiscordChannel implements ChannelAdapter {
  readonly source = 'discord' as const;
  readonly name = 'Discord';

  private client: Client;

  constructor(private token: string, private runtime: ChannelRuntime) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      // Without these, a DM from someone the bot has not seen before arrives as
      // a partial and is dropped.
      partials: [Partials.Channel, Partials.Message],
    });
  }

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (ready) => {
      console.log(`\x1b[36m[discord]\x1b[0m listening as ${ready.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      if (!message.content) {
        console.warn(
          '\x1b[33m[discord]\x1b[0m message had no content — enable the ' +
            'MESSAGE CONTENT intent in the Discord developer portal.',
        );
        return;
      }

      const reply: Reply = {
        send: async (text) => (await message.reply(text)).id,
        edit: async (handle, text) => {
          const existing = await message.channel.messages.fetch(handle).catch(() => null);
          await existing?.edit(text);
        },
        sendFile: async (filePath, caption) => {
          await message.reply({
            content: caption,
            files: [filePath],
          });
        },
      };

      await this.runtime.handle(
        this.source,
        {
          senderId: message.author.id,
          // A DM has no guild. Anything inside a server is a group, including
          // a channel only the owner happens to be reading.
          chatType: message.guild ? 'group' : 'direct',
          chatId: message.channelId,
          text: message.content,
        },
        reply,
      );
    });

    await this.client.login(this.token);
  }

  /**
   * DM the owner.
   *
   * Discord refuses this unless the bot and the owner share a server and the
   * owner's privacy settings allow DMs from server members. Both are things
   * the owner can change, so the error names them rather than reporting a
   * bare failure.
   */
  async sendTo(to: string, text: string): Promise<void> {
    try {
      const user = await this.client.users.fetch(to);
      await user.send(text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/cannot send messages to this user|50007|Unknown User/i.test(detail)) {
        throw new Error(
          'Discord will not deliver it. The bot has to share a server with ' +
            'you, and your privacy settings have to allow DMs from server ' +
            `members. (${detail})`,
        );
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }
}
