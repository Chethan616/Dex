/**
 * The Telegram channel (main/channels/TelegramAdapter.ts) against a fake
 * Bot API: the token check, pairing the bot to its owner, who it listens
 * to, and that the token never leaves the credential store.
 */
import Module from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logs: unknown[] = [];
vi.mock('../../../src/main/logger', () => ({
  mainLogger: {
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
    error: (...a: unknown[]) => logs.push(a),
    debug: () => {},
  },
}));

const vault = new Map<string, string>();
const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function load(request, parent, isMain) {
  if (request === 'keytar') {
    return {
      getPassword: async (s: string, a: string) => vault.get(`${s}/${a}`) ?? null,
      setPassword: async (s: string, a: string, v: string) => { vault.set(`${s}/${a}`, v); },
      deletePassword: async (s: string, a: string) => vault.delete(`${s}/${a}`),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import { TelegramAdapter, toTelegramHtml } from '../../../src/main/channels/TelegramAdapter';
import type { InboundMessage } from '../../../src/main/channels/types';

const TOKEN = '12345:not-a-real-token-only-for-tests';

/** A Bot API that answers getMe, holds getUpdates open, and records what DEX sent. */
function fakeTelegram() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const pending: Array<Array<Record<string, unknown>>> = [];
  let wake: (() => void) | null = null;
  let nextId = 100;
  let updateId = 1;
  const fetchMock = vi.fn(async (url: string, init: { body?: string; signal?: AbortSignal }) => {
    const method = url.split('/').pop() as string;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ method, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    if (method === 'getMe') return ok({ id: 555, is_bot: true, first_name: 'My DEX', username: 'my_dex_bot' });
    if (method === 'getUpdates') {
      if (!pending.length) {
        await new Promise<void>((resolve, reject) => {
          wake = resolve;
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return ok(pending.shift() ?? []);
    }
    if (method === 'sendMessage') return ok({ message_id: nextId++, date: 0, chat: { id: Number(body.chat_id), type: 'private' } });
    return ok(true);
  });
  const deliver = (from: number, text: string, extra: Record<string, unknown> = {}) => {
    pending.push([{ update_id: updateId++, message: { message_id: nextId++, date: Math.floor(Date.now() / 1000), chat: { id: from, type: 'private' }, from: { id: from, first_name: from === 7 ? 'Chethan' : 'Stranger' }, text, ...extra } }]);
    const w = wake; wake = null; w?.();
  };
  return { calls, fetchMock, deliver, sent: () => calls.filter((c) => c.method === 'sendMessage') };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Telegram channel', () => {
  let api: ReturnType<typeof fakeTelegram>;
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vault.clear();
    logs.length = 0;
    api = fakeTelegram();
    vi.stubGlobal('fetch', api.fetchMock);
    adapter = new TelegramAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.unstubAllGlobals();
  });

  it('turns away anything that isn’t a bot token, without calling Telegram', async () => {
    await expect(adapter.connect('my password')).rejects.toThrow(/@BotFather/);
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('pairs with whoever opens the link, then answers only them', async () => {
    const info = await adapter.connect(TOKEN);
    expect(info.bot).toBe('my_dex_bot');
    expect(info.owner).toBeNull();
    expect(info.pairUrl).toMatch(/^https:\/\/t\.me\/my_dex_bot\?start=[\w-]+$/);
    const code = new URL(info.pairUrl as string).searchParams.get('start');

    const inbound: InboundMessage[] = [];
    adapter.onMessage((m) => inbound.push(m));

    // Before pairing: a message is answered, never acted on.
    api.deliver(9, 'hello');
    await settle();
    expect(inbound).toHaveLength(0);
    expect(String(api.sent().at(-1)?.body.text)).toMatch(/isn’t paired yet/);

    api.deliver(7, `/start ${code}`);
    await settle();
    expect(adapter.info().owner).toBe('Chethan');
    expect(adapter.info().pairUrl).toBeNull();
    expect(adapter.homeChat()).toBe('7');
    expect(String(api.sent().at(-1)?.body.text)).toMatch(/Paired with DEX/);

    // Someone else finds the bot: told once, ignored after.
    api.deliver(9, 'do my homework');
    await settle();
    api.deliver(9, 'please');
    await settle();
    expect(api.sent().filter((c) => c.body.chat_id === '9' && /private DEX bot/.test(String(c.body.text)))).toHaveLength(1);
    expect(inbound).toHaveLength(0);

    // The owner: every message is for DEX; replies carry their thread.
    api.deliver(7, 'find a flight to Goa', { reply_to_message: { message_id: 3, date: 0, chat: { id: 7, type: 'private' }, text: 'earlier answer' } });
    await settle();
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ channelId: 'telegram', text: 'find a flight to Goa', conversationId: '7', mentioned: true, replyToMessageId: 'tg:7:3', quotedText: 'earlier answer' });
    expect(inbound[0].messageId).toMatch(/^tg:7:\d+$/);
  });

  it('keeps the token in the credential store and out of the log', async () => {
    await adapter.connect(TOKEN);
    expect([...vault.values()].join()).toContain(TOKEN);
    expect(JSON.stringify(adapter.info())).not.toContain(TOKEN);
    api.fetchMock.mockImplementationOnce(async () => { throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/sendMessage`); });
    await adapter.react('7', 'tg:7:1', '✅');
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it('maps DEX’s status lights onto Telegram’s reactions and replies in-thread', async () => {
    await adapter.connect(TOKEN);
    await adapter.react('7', 'tg:7:12', '✅');
    const reaction = api.calls.find((c) => c.method === 'setMessageReaction');
    expect(reaction?.body).toMatchObject({ chat_id: '7', message_id: 12, reaction: [{ type: 'emoji', emoji: '👍' }] });

    const id = await adapter.send('7', '✅ *Done*\n\nBooked.', { quoteMessageId: 'tg:7:12' });
    expect(id).toMatch(/^tg:7:\d+$/);
    expect(api.sent().at(-1)?.body).toMatchObject({ parse_mode: 'HTML', reply_parameters: { message_id: 12, allow_sending_without_reply: true } });
  });

  it('remembers the bot and its owner across restarts', async () => {
    const info = await adapter.connect(TOKEN);
    const code = new URL(info.pairUrl as string).searchParams.get('start');
    api.deliver(7, `/start ${code}`);
    await settle();
    await adapter.disconnect();

    const again = new TelegramAdapter();
    await again.resume();
    expect(again.info()).toMatchObject({ bot: 'my_dex_bot', owner: 'Chethan', pairUrl: null });
    await again.disconnect();
  });
});

describe('Telegram formatting', () => {
  it('turns WhatsApp-style and Markdown emphasis into Telegram HTML, escaping the rest', () => {
    expect(toTelegramHtml('✅ *Done*\n\n2 < 3 & **cheap**\n\n_↩ Reply to this_')).toBe('✅ <b>Done</b>\n\n2 &lt; 3 &amp; <b>cheap</b>\n\n<i>↩ Reply to this</i>');
    expect(toTelegramHtml('run `dex-send` on file_name_here.pdf')).toBe('run <code>dex-send</code> on file_name_here.pdf');
    expect(toTelegramHtml('2*3*4')).toBe('2*3*4');
  });
});
