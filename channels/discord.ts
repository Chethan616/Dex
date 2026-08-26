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

  async stop(): Promise<void> {
    await this.client.destroy();
  }
}
