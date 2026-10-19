/**
 * The Discord channel (main/channels/DiscordAdapter.ts) against a fake
 * Gateway and REST API: the token check, identifying on the Gateway, pairing
 * the bot to whoever sends the code, who it listens to, button presses, and
 * that the token never leaves the credential store.
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

/** A Gateway socket that records what DEX sends and lets the test speak for Discord. */
const { sockets, FakeSocket } = vi.hoisted(() => {
  const sockets: Array<InstanceType<typeof FakeSocket>> = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent: Array<{ op: number; d: unknown }> = [];
    private handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    constructor(readonly url: string) { sockets.push(this); }
    on(event: string, fn: (...a: unknown[]) => void) { (this.handlers[event] ??= []).push(fn); return this; }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; for (const fn of this.handlers.close ?? []) fn(code); }
    terminate() { this.close(1006); }
    frame(f: unknown) { for (const fn of this.handlers.message ?? []) fn(Buffer.from(JSON.stringify(f))); }
  }
  return { sockets, FakeSocket };
});
vi.mock('ws', () => ({ default: FakeSocket }));

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

import { DiscordAdapter, toDiscordMarkdown } from '../../../src/main/channels/DiscordAdapter';
import type { InboundMessage } from '../../../src/main/channels/types';

const TOKEN = 'unit-test-bot-token-x.only.not-a-real-discord-token';
const BOT = '900';
const OWNER = '7';

function fakeDiscord() {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> | null; auth: string }> = [];
  let nextId = 5000;
  const fetchMock = vi.fn(async (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    const path = url.replace('https://discord.com/api/v10', '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ method: init.method ?? 'GET', path, body, auth: init.headers?.authorization ?? '' });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (path === '/users/@me') return json({ id: BOT, username: 'My DEX', bot: true });
    if (path === '/oauth2/applications/@me') return json({ id: '901' });
    if (path === '/users/@me/channels') return json({ id: '777' });
    if (/^\/channels\/\d+\/messages$/.test(path)) return json({ id: String(nextId++) });
    return new Response(null, { status: 204 });
  });
  return { calls, fetchMock, sent: () => calls.filter((c) => /\/messages$/.test(c.path) && c.method === 'POST') };
}

const settle = () => new Promise((r) => setTimeout(r, 10));
const message = (over: Record<string, unknown>) => ({
  op: 0, s: 2, t: 'MESSAGE_CREATE',
  d: { id: String(Math.floor(Math.random() * 1e6)), channel_id: '777', author: { id: OWNER, username: 'chethan', global_name: 'Chethan' }, content: 'hi', timestamp: new Date().toISOString(), mentions: [] as unknown[], attachments: [] as unknown[], ...over },
});

describe('Discord channel', () => {
  let api: ReturnType<typeof fakeDiscord>;
  let adapter: DiscordAdapter;

  beforeEach(() => {
    vault.clear();
    logs.length = 0;
    sockets.length = 0;
    api = fakeDiscord();
    vi.stubGlobal('fetch', api.fetchMock);
    adapter = new DiscordAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.unstubAllGlobals();
  });

  it('turns away anything that isn’t a bot token, without calling Discord', async () => {
    await expect(adapter.connect('hunter2')).rejects.toThrow(/Reset Token/);
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  async function online() {
    const info = await adapter.connect(TOKEN);
    const ws = sockets[0];
    ws.frame({ op: 10, d: { heartbeat_interval: 40_000 } });
    ws.frame({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.example' } });
    return { info, ws };
  }

  it('identifies on the Gateway with the token, and offers an invite link and a pairing code', async () => {
    const { info, ws } = await online();
    expect(ws.sent.find((f) => f.op === 2)).toMatchObject({ op: 2, d: { token: TOKEN, intents: (1 << 9) | (1 << 12) } });
    expect(info.inviteUrl).toBe('https://discord.com/oauth2/authorize?client_id=901&scope=bot&permissions=117824');
    expect(info.pairCode).toMatch(/^DEX-[0-9A-F]{8}$/);
    expect(adapter.info().status).toBe('connected');
    expect(api.calls.every((c) => c.auth === `Bot ${TOKEN}`)).toBe(true);
  });

  it('pairs with whoever sends the code, opens a DM with them, then answers only them', async () => {
    const { info, ws } = await online();
    const got: InboundMessage[] = [];
    adapter.onMessage((m) => got.push(m));

    // Someone without the code, in a DM: told it isn't paired.
    ws.frame(message({ author: { id: '66', username: 'rando' }, content: 'hello?', channel_id: '660' }));
    await settle();
    expect(api.sent().at(-1)?.body?.content).toMatch(/isn’t paired yet/);

    // The owner @mentions it in their server with the code.
    ws.frame(message({ guild_id: '1', channel_id: '55', content: `<@${BOT}> ${info.pairCode}`, mentions: [{ id: BOT }] }));
    await settle();
    expect(adapter.info()).toMatchObject({ owner: 'Chethan', pairCode: null, dmUrl: 'https://discord.com/channels/@me/777' });
    expect(api.calls.some((c) => c.path === '/users/@me/channels' && c.body?.recipient_id === OWNER)).toBe(true);
    expect(api.sent().at(-1)).toMatchObject({ path: '/channels/777/messages' });
    expect(String(api.sent().at(-1)?.body?.content)).toContain('**Paired with DEX');
    expect(adapter.homeChat()).toBe('777');
    expect(got).toHaveLength(0);

    // A stranger in a DM now: told once that it's private, never routed.
    ws.frame(message({ author: { id: '66', username: 'rando' }, content: 'do my homework', channel_id: '660' }));
    ws.frame(message({ author: { id: '66', username: 'rando' }, content: 'please', channel_id: '660' }));
    await settle();
    expect(api.sent().filter((c) => String(c.body?.content).includes('private DEX bot'))).toHaveLength(1);

    // In a server, only messages that mention it count.
    ws.frame(message({ guild_id: '1', channel_id: '55', content: 'just chatting' }));
    ws.frame(message({ id: '42', content: 'find me a flight to Goa', message_reference: { message_id: '41' }, referenced_message: { id: '41', content: 'earlier' } }));
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ channelId: 'discord', text: 'find me a flight to Goa', conversationId: '777', messageId: 'dc:777:42', replyToMessageId: 'dc:777:41', quotedText: 'earlier', mentioned: true });

    // The token is never logged.
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(vault.get('DEX/discord')).toContain(TOKEN);
  });

  it('sends questions with buttons; a press keeps the choice on the message and goes on as the answer', async () => {
    const { info, ws } = await online();
    ws.frame(message({ content: info.pairCode }));
    await settle();
    const got: InboundMessage[] = [];
    adapter.onMessage((m) => got.push(m));

    const id = await adapter.sendPrompt('777', { text: '*Which cabin?*', rows: [[{ label: 'Economy', reply: 'Economy' }, { label: 'Business', reply: 'Business' }], [{ label: 'Open', url: 'https://example.com' }]], asks: true }, { quoteMessageId: 'dc:777:42' });
    const sent = api.sent().at(-1)!;
    expect(sent.body).toMatchObject({ content: '**Which cabin?**', message_reference: { message_id: '42' } });
    const rows = sent.body?.components as Array<{ components: Array<{ style: number; label: string; custom_id?: string; url?: string }> }>;
    expect(rows[0].components.map((b) => b.label)).toEqual(['Economy', 'Business']);
    expect(rows[1].components[0]).toMatchObject({ style: 5, url: 'https://example.com' });

    const press = rows[0].components[1].custom_id;
    ws.frame({ op: 0, s: 9, t: 'INTERACTION_CREATE', d: { id: 'i1', token: 'itok', type: 3, user: { id: OWNER, global_name: 'Chethan' }, data: { custom_id: press }, message: { id: id!.split(':')[2], channel_id: '777' } } });
    await settle();
    const callback = api.calls.find((c) => c.path === '/interactions/i1/itok/callback');
    expect(callback?.body).toMatchObject({ type: 7 });
    expect(JSON.stringify(callback?.body)).toContain('✓ Business');
    expect(got).toEqual([expect.objectContaining({ text: 'Business', pressed: true, replyToMessageId: id, messageId: id })]);

    // Someone else's press is refused, privately.
    ws.frame({ op: 0, s: 10, t: 'INTERACTION_CREATE', d: { id: 'i2', token: 't2', type: 3, member: { user: { id: '66' } }, data: { custom_id: press }, message: { id: '1', channel_id: '55' } } });
    await settle();
    expect(api.calls.find((c) => c.path === '/interactions/i2/t2/callback')?.body).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(got).toHaveLength(1);
  });

  it('a new status light replaces the old reaction', async () => {
    await online();
    await adapter.react('777', 'dc:777:42', '👀');
    await adapter.react('777', 'dc:777:42', '✅');
    const r = api.calls.filter((c) => c.path.includes('/reactions/'));
    expect(r.map((c) => `${c.method} ${decodeURIComponent(c.path)}`)).toEqual([
      'PUT /channels/777/messages/42/reactions/👀/@me',
      'DELETE /channels/777/messages/42/reactions/👀/@me',
      'PUT /channels/777/messages/42/reactions/✅/@me',
    ]);
  });

  it('stops for good when Discord rejects the token', async () => {
    const { ws } = await online();
    ws.close(4004);
    expect(adapter.info()).toMatchObject({ status: 'error', error: expect.stringMatching(/token/) });
    await settle();
    expect(sockets).toHaveLength(1);
  });
});

describe('Discord formatting', () => {
  it('turns WhatsApp-style emphasis into Markdown, leaving Markdown and code alone', () => {
    expect(toDiscordMarkdown('*Done* — ~old~ and **kept** and _italic_')).toBe('**Done** — ~~old~~ and **kept** and _italic_');
    expect(toDiscordMarkdown('run `a *b* c` now')).toBe('run `a *b* c` now');
  });
});
