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

type Handler = (session: any) => void;

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
  };
  let sent = 0;
  const adapter = {
    onMessage: vi.fn(),
    send: vi.fn(async () => `dex-${++sent}`),
    react: vi.fn(async () => {}),
    sendFile: vi.fn(async (..._args: unknown[]) => `file-${++sent}`),
    selfChatJid: () => 'me@s.whatsapp.net',
    status: 'connected',
  };
  const router = new ChannelRouter(sessionManager as any, adapter as any);
  const start = vi.fn(async () => {});
  const followUp = vi.fn(async () => ({ queued: true }));
  router.setStartSession(start);
  router.setFollowUp(followUp);
  return { router, handlers, sessions, sessionManager, adapter, start, followUp };
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
    await expect(t.router.sendFiles('s1', [{ path: file }])).rejects.toThrow(/isn't connected/);
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
