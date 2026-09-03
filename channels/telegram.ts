import { Bot, InputFile } from 'grammy';
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

  /**
   * Message the owner directly.
   *
   * Telegram will refuse this until the owner has sent the bot something at
   * least once — bots cannot open a conversation. The error says so plainly
   * rather than being swallowed, because "press start on your bot first" is
   * an instruction the owner can follow and "could not send" is not.
   */
  async sendTo(to: string, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(to, text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/chat not found|bot can't initiate|blocked/i.test(detail)) {
        throw new Error(
          `Telegram will not let a bot message you first. Open the bot in ` +
            `Telegram and send it anything, then try again. (${detail})`,
        );
      }
      throw err;
    }
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
        // As a document, always. Telegram compresses anything sent as a photo,
        // and a screenshot the owner asked to be sent should arrive as the
        // screenshot rather than as a smaller picture of one.
        sendFile: async (filePath, caption) => {
          await ctx.replyWithDocument(new InputFile(filePath), { caption });
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
