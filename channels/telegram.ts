import { Bot } from 'grammy';
import { ChannelAdapter, ChannelRuntime, Reply } from './base_channel';

/**
 * Telegram, via grammY.
 *
 * Thin on purpose. Everything that decides *whether* to act, streams progress,
 * or answers an approval lives in ChannelRuntime — this file only knows how
 * Telegram delivers a message and how it edits one.
 */
export class TelegramChannel implements ChannelAdapter {
  readonly source = 'telegram' as const;
  readonly name = 'Telegram';

  private bot: Bot;

  constructor(token: string, private runtime: ChannelRuntime) {
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    this.bot.on('message:text', async (ctx) => {
      const from = ctx.from?.id;
      if (from == null) return;

      const reply: Reply = {
        send: async (text) => {
          const sent = await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() =>
            // Markdown is rejected when a step's output contains stray
            // formatting characters. The message matters more than its styling.
            ctx.reply(text),
          );
          return String(sent.message_id);
        },
        edit: async (handle, text) => {
          await ctx.api
            .editMessageText(ctx.chat.id, Number(handle), text, { parse_mode: 'Markdown' })
            .catch(() => ctx.api.editMessageText(ctx.chat.id, Number(handle), text));
        },
      };

      await this.runtime.handle(
        this.source,
        {
          senderId: String(from),
          // Telegram calls a one-to-one chat "private"; everything else has
          // other people in it.
          chatType: ctx.chat.type === 'private' ? 'direct' : 'group',
          chatId: String(ctx.chat.id),
          text: ctx.message.text ?? '',
        },
        reply,
      );
    });

    // start() resolves only when the bot stops, so it is deliberately not
    // awaited — the caller wants "listening", not "finished".
    void this.bot.start({
      onStart: (info) => console.log(`\x1b[36m[telegram]\x1b[0m listening as @${info.username}`),
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
