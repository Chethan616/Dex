import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-router-'));

vi.mock('electron', () => ({ app: { getPath: () => userData }, BrowserWindow: class {}, desktopCapturer: {}, screen: {} }));
vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ChannelRouter } from '../../../src/main/channels/ChannelRouter';
import type { InboundMessage } from '../../../src/main/channels/types';

type Handler = (...args: any[]) => void;

function setup() {
  const handlers: Record<string, Handler> = {};
  const sessions = new Map<string, any>();
  let n = 0;
  const sessionManager = {
    onEvent: (name: string, fn: Handler) => { handlers[name] = fn; },
    origin: { originChannel: 'whatsapp' as string | null, originConversationId: 'me@s.whatsapp.net' as string | null },
    getSessionOrigin: () => sessionManager.origin,
    taskFiles: [] as Array<{ path: string; name: string; at: number }>,
    getTaskState: () => ({ files: sessionManager.taskFiles }),
    getSession: (id: string) => sessions.get(id),
    createSession: vi.fn((prompt: string) => {
      const id = `s${++n}`;
      sessions.set(id, { id, prompt, output: [], status: 'draft' });
      return id;
    }),
    startSession: vi.fn(),
    listSessions: () => [...sessions.values()].reverse().map((x) => ({ ...x, createdAt: x.createdAt ?? Date.now() })),
    cancelSession: vi.fn((id: string) => { const x = sessions.get(id); if (x) x.status = 'stopped'; }),
    getNextAttachmentTurnIndex: () => 0,
    saveAttachment: vi.fn(),
  };
  let sent = 0;
  const adapter = {
    onMessage: vi.fn(),
    send: vi.fn(async () => `dex-${++sent}`),
    react: vi.fn(async () => {}),
    sendFile: vi.fn(async (..._args: unknown[]) => `file-${++sent}`),
    homeChat: () => 'me@s.whatsapp.net',
    status: 'connected',
  };
  const telegram = {
    onMessage: vi.fn(),
    send: vi.fn(async (..._args: unknown[]) => `tg:42:${++sent}`),
    sendPrompt: vi.fn(async (..._args: unknown[]) => `tg:42:${++sent}`),
    typing: vi.fn(),
    react: vi.fn(async () => {}),
    sendFile: vi.fn(async (..._args: unknown[]) => `tg:42:${++sent}`),
    homeChat: () => '42',
    status: 'connected',
  };
  const router = new ChannelRouter(sessionManager as any, { whatsapp: adapter as any, telegram: telegram as any });
  const start = vi.fn(async () => {});
  const followUp = vi.fn(async () => ({ queued: true }));
  router.setStartSession(start);
  router.setFollowUp(followUp);
  return { router, handlers, sessions, sessionManager, adapter, telegram, start, followUp };
}

const msg = (over: Partial<InboundMessage>): InboundMessage => ({
  channelId: 'whatsapp',
  from: 'me@s.whatsapp.net',
  fromName: 'Me',
  text: 'hello',
  timestamp: Date.now(),
  conversationId: 'me@s.whatsapp.net',
  messageId: `m-${Math.random()}`,
  mentioned: false,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ChannelRouter threading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts a task only for @DEX', () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'buy milk' }));
    expect(t.sessionManager.createSession).not.toHaveBeenCalled();
    t.router.handleInbound(msg({ text: 'find a flight', mentioned: true }));
    expect(t.sessionManager.createSession).toHaveBeenCalledWith('find a flight', expect.anything());
    expect(t.start).toHaveBeenCalledWith('s1');
  });

  it('continues the same task when replying to DEX\'s answer, without @DEX', async () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'find a flight to NYC', mentioned: true, messageId: 'u1' }));
    t.handlers['session-completed']({ id: 's1', prompt: 'find a flight to NYC', output: [{ type: 'done', summary: 'Found 3 flights.' }] });
    await flush();
    expect(t.adapter.send).toHaveBeenCalledWith(
      'me@s.whatsapp.net',
      expect.stringContaining('Found 3 flights.'),
      { quoteMessageId: 'u1' },
    );

    t.router.handleInbound(msg({ text: 'At what time', replyToMessageId: 'dex-1', messageId: 'u2' }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'At what time');
    expect(t.sessionManager.createSession).toHaveBeenCalledTimes(1);

    // Replying to your own follow-up keeps the thread too.
    t.router.handleInbound(msg({ text: 'and the cheapest?', replyToMessageId: 'u2' }));
    await flush();
    expect(t.followUp).toHaveBeenLastCalledWith('s1', 'and the cheapest?');
  });

  it('ignores replies to unknown messages unless @DEX, which gets the quote as context', () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'hm', replyToMessageId: 'note-1', quotedText: 'my note' }));
    expect(t.sessionManager.createSession).not.toHaveBeenCalled();
    t.router.handleInbound(msg({ text: 'summarise this', mentioned: true, replyToMessageId: 'note-1', quotedText: 'my note' }));
    expect(t.sessionManager.createSession.mock.calls[0][0]).toContain('my note');
  });

  it('remembers threads across restarts', async () => {
    const a = setup();
    a.router.handleInbound(msg({ text: 'task', mentioned: true, messageId: 'persist-1' }));
    await new Promise((r) => setTimeout(r, 600));
    const b = setup();
    b.sessions.set('s1', { id: 's1' });
    b.router.handleInbound(msg({ text: 'more', replyToMessageId: 'persist-1' }));
    await flush();
    expect(b.followUp).toHaveBeenCalledWith('s1', 'more');
  });

  it('shows "stuck" as a reaction, not a message', () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'slow task', mentioned: true, messageId: 'u9' }));
    t.handlers['session-updated']({ id: 's1', status: 'stuck', prompt: 'slow task' });
    expect(t.adapter.react).toHaveBeenLastCalledWith('me@s.whatsapp.net', 'u9', '⏳');
    expect(t.adapter.send).not.toHaveBeenCalled();
  });
});

describe('ChannelRouter file delivery (dex-send)', () => {
  const file = path.join(userData, 'Aadhaar.pdf');
  fs.writeFileSync(file, 'pdf');

  it('sends into the task thread, quoting the request, and replies to the file continue the task', async () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'fetch my aadhaar card', mentioned: true, messageId: 'u1' }));
    const res = await t.router.sendFiles('s1', [{ path: file }], 'Your Aadhaar card');
    expect(res.sent).toBe(1);
    expect(t.adapter.sendFile).toHaveBeenCalledWith('me@s.whatsapp.net', file, expect.objectContaining({ caption: 'Your Aadhaar card', quoteMessageId: 'u1' }));
    t.router.handleInbound(msg({ text: 'the back side too', replyToMessageId: 'file-1' }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'the back side too');
  });

  it('a hub task sends to your own chat', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: null, originConversationId: null };
    await t.router.sendFiles('hub-1', [{ path: file }]);
    expect((t.adapter.sendFile.mock.calls[0] as unknown[])[0]).toBe('me@s.whatsapp.net');
  });

  it('refuses when WhatsApp is not connected', async () => {
    const t = setup();
    t.adapter.status = 'disconnected';
    await expect(t.router.sendFiles('s1', [{ path: file }])).rejects.toThrow(/WhatsApp isn't connected/);
  });

  it('a hub task goes to your Telegram bot when WhatsApp is off, and fails only when neither is on', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: null, originConversationId: null };
    t.adapter.status = 'disconnected';
    const res = await t.router.sendFiles('hub-2', [{ path: file }]);
    expect((t.telegram.sendFile.mock.calls[0] as unknown[])[0]).toBe('42');
    expect(res.to).toMatch(/Telegram/);
    t.telegram.status = 'disconnected';
    await expect(t.router.sendFiles('hub-3', [{ path: file }])).rejects.toThrow(/No chat app \(WhatsApp, Telegram or Discord\) is connected/);
  });

  it('on Done, sends the files the task recorded (once), then the answer', async () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'export my marks', mentioned: true, messageId: 'u1' }));
    t.sessionManager.taskFiles = [{ path: file, name: 'Aadhaar.pdf', at: 1 }];
    t.handlers['session-completed']({ id: 's1', prompt: 'x', output: [{ type: 'done', summary: 'Here it is.' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.adapter.sendFile).toHaveBeenCalledTimes(1);
    expect(t.adapter.send).toHaveBeenCalledWith('me@s.whatsapp.net', expect.stringContaining('Here it is.'), expect.anything());
    expect(t.adapter.sendFile.mock.invocationCallOrder[0]).toBeLessThan(t.adapter.send.mock.invocationCallOrder[0]);

    // A later turn doesn't resend it.
    t.handlers['session-completed']({ id: 's1', prompt: 'x', output: [{ type: 'done', summary: 'Again.' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.adapter.sendFile).toHaveBeenCalledTimes(1);
  });
});

describe('ChannelRouter on Telegram', () => {
  const tg = (over: Partial<InboundMessage>): InboundMessage => msg({ channelId: 'telegram', from: '42', conversationId: '42', mentioned: true, ...over });

  it('starts a task from any message to the bot, answers there, and threads replies', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'book a cab', messageId: 'tg:42:1' }));
    expect(t.sessionManager.createSession).toHaveBeenCalledWith('book a cab', { originChannel: 'telegram', originConversationId: '42' });

    t.handlers['session-completed']({ id: 's1', prompt: 'book a cab', output: [{ type: 'done', summary: 'Booked.' }] });
    await flush();
    expect(t.adapter.send).not.toHaveBeenCalled();
    expect(t.telegram.send).toHaveBeenCalledWith('42', expect.stringContaining('a new message starts a new task'), { quoteMessageId: 'tg:42:1' });
    expect(t.telegram.react).toHaveBeenCalledWith('42', 'tg:42:1', '✅');

    t.router.handleInbound(tg({ text: 'make it an SUV', replyToMessageId: 'tg:42:1', mentioned: true }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'make it an SUV');
    expect(t.sessionManager.createSession).toHaveBeenCalledTimes(1);
  });
});

const cabin = { type: 'ask', title: 'Which cabin?', fields: [{ id: 'cabin', kind: 'choice', options: ['Economy', 'Business'] }] };

describe('ChannelRouter: a task\'s questions in a chat', () => {
  const tg = (over: Partial<InboundMessage>): InboundMessage => msg({ channelId: 'telegram', from: '42', conversationId: '42', mentioned: true, ...over });

  it('Telegram: a question arrives with buttons; a press answers it, and the turn ends without "Done"', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'book me a flight', messageId: 'tg:42:1' }));
    t.handlers['session-output']('s1', { type: 'widget', id: 'w1', widget: cabin });
    await flush();
    expect(t.telegram.sendPrompt).toHaveBeenCalledTimes(1);
    const prompt = t.telegram.sendPrompt.mock.calls[0][1] as { text: string; rows: Array<Array<{ label: string; reply?: string }>> };
    expect(prompt.text).toContain('Which cabin?');
    expect(prompt.rows.flat().map((b) => b.reply)).toEqual(['Economy', 'Business']);

    t.handlers['session-completed']({ id: 's1', prompt: 'x', output: [{ type: 'done', summary: 'Asked which cabin.' }] });
    await flush();
    expect(t.telegram.send).not.toHaveBeenCalled();
    expect(t.telegram.react).toHaveBeenCalledWith('42', 'tg:42:1', '🤔');

    const promptId = await t.telegram.sendPrompt.mock.results[0].value;
    t.router.handleInbound(tg({ text: 'Business', messageId: promptId, replyToMessageId: promptId, pressed: true }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'Business');
    expect(t.sessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('Telegram: after a question, the next message answers it instead of starting a task', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'book me a flight', messageId: 'tg:42:1' }));
    t.handlers['session-output']('s1', { type: 'widget', id: 'w1', widget: cabin });
    t.router.handleInbound(tg({ text: 'business please', messageId: 'tg:42:9' }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'business please');
    // Answered: the next message is a new task again.
    t.router.handleInbound(tg({ text: 'and order pizza', messageId: 'tg:42:10' }));
    expect(t.sessionManager.createSession).toHaveBeenCalledTimes(2);
  });

  it('WhatsApp: answers come numbered, and a bare "2" picks the second', async () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'book me a flight', mentioned: true, messageId: 'wa-1' }));
    t.handlers['session-output']('s1', { type: 'widget', id: 'w1', widget: cabin });
    await flush();
    const text = (t.adapter.send.mock.calls as unknown as Array<[string, string]>)[0][1];
    expect(text).toContain('*1.* Economy');
    expect(text).toContain('*2.* Business');
    expect(text).toContain('Reply with a number');

    t.router.handleInbound(msg({ text: 'remember to buy milk' }));
    expect(t.followUp).not.toHaveBeenCalled();
    t.router.handleInbound(msg({ text: '2' }));
    await flush();
    expect(t.followUp).toHaveBeenCalledWith('s1', 'Business');
  });

  it('cards go with a Select per card and an Open link', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'find hotels', messageId: 'tg:42:1' }));
    t.handlers['session-output']('s1', { type: 'widget', id: 'w2', widget: { type: 'cards', title: 'Hotels', items: [
      { title: 'Taj', price: '₹9,000', url: 'https://example.com/taj', actions: [{ label: 'Select', reply: 'Book the Taj' }] },
      { title: 'Ibis', price: '₹3,000', actions: [{ label: 'Select', reply: 'Book the Ibis' }] },
    ] } });
    await flush();
    const prompt = t.telegram.sendPrompt.mock.calls[0][1] as { text: string; rows: Array<Array<{ label: string; reply?: string; url?: string }>> };
    expect(prompt.text).toContain('*1. Taj* · ₹9,000');
    const flat = prompt.rows.flat();
    expect(flat.filter((b) => b.reply).map((b) => b.reply)).toEqual(['Book the Taj', 'Book the Ibis']);
    expect(flat.find((b) => b.url)?.url).toBe('https://example.com/taj');
  });
});

describe('ChannelRouter commands', () => {
  const tg = (over: Partial<InboundMessage>): InboundMessage => msg({ channelId: 'telegram', from: '42', conversationId: '42', mentioned: true, ...over });

  it('/status lists the chat\'s tasks; /stop stops the running one', async () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'watch the price of a PS5', messageId: 'tg:42:1' }));
    t.sessions.get('s1').status = 'running';
    t.router.handleInbound(tg({ text: '/status', messageId: 'tg:42:2' }));
    await flush();
    expect(t.telegram.send).toHaveBeenLastCalledWith('42', expect.stringMatching(/1 running[\s\S]*watch the price of a PS5 — working/), { quoteMessageId: 'tg:42:2' });

    t.router.handleInbound(tg({ text: '/stop', messageId: 'tg:42:3' }));
    await flush();
    expect(t.sessionManager.cancelSession).toHaveBeenCalledWith('s1');
    expect(t.telegram.send).toHaveBeenLastCalledWith('42', expect.stringContaining('Stopped'), { quoteMessageId: 'tg:42:3' });
    expect(t.sessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('on WhatsApp it\'s "@DEX stop"; plain "stop" is a note', async () => {
    const t = setup();
    t.router.handleInbound(msg({ text: 'stop', mentioned: false }));
    expect(t.adapter.send).not.toHaveBeenCalled();
    t.router.handleInbound(msg({ text: 'stop', mentioned: true }));
    await flush();
    expect(t.adapter.send).toHaveBeenCalledWith('me@s.whatsapp.net', 'Nothing is running here.', expect.anything());
    expect(t.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('/new <task> starts fresh even while a question waits', () => {
    const t = setup();
    t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
    t.router.handleInbound(tg({ text: 'book me a flight', messageId: 'tg:42:1' }));
    t.handlers['session-output']('s1', { type: 'widget', id: 'w1', widget: cabin });
    t.router.handleInbound(tg({ text: '/new order a pizza', messageId: 'tg:42:5' }));
    expect(t.sessionManager.createSession).toHaveBeenLastCalledWith('order a pizza', { originChannel: 'telegram', originConversationId: '42' });
    expect(t.followUp).not.toHaveBeenCalled();
  });
});

describe('ChannelRouter: photos and files sent from a chat', () => {
  it('saves them under Downloads › DEX from chats, names them in the prompt, and attaches pictures', () => {
    const t = setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    t.router.handleInbound(msg({ text: 'what is this?', mentioned: true, attachments: [
      { name: 'photo.png', mime: 'image/png', bytes: png },
      { name: 'notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('x') },
    ] }));
    const prompt = t.sessionManager.createSession.mock.calls[0][0] as string;
    expect(prompt).toMatch(/^what is this\?\n\n\(Sent with this message, saved on this PC: .*DEX from chats.*photo\.png, .*notes\.docx\)$/);
    const saved = prompt.match(/saved on this PC: (.*?photo\.png)/)?.[1] as string;
    expect(fs.readFileSync(saved)).toEqual(png);
    // The picture goes to the model; the .docx stays a file on disk.
    expect(t.sessionManager.saveAttachment).toHaveBeenCalledTimes(1);
    expect(t.sessionManager.saveAttachment).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'photo.png' }), 0);
  });
});

describe('ChannelRouter typing', () => {
  it('shows "typing…" while a chat task runs and stops when it ends', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.sessionManager.origin = { originChannel: 'telegram', originConversationId: '42' };
      t.handlers['session-updated']({ id: 's1', status: 'running' });
      expect(t.telegram.typing).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(9_100);
      expect(t.telegram.typing).toHaveBeenCalledTimes(3);
      t.handlers['session-updated']({ id: 's1', status: 'idle' });
      vi.advanceTimersByTime(20_000);
      expect(t.telegram.typing).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
