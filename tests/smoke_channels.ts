/**
 * Slice 5 — who is allowed to command Dex from a chat, and what a stranger sees.
 *
 * This is the security boundary of the whole remote surface. Dex acts on a
 * personal machine with Full Access available; a gap here is a stranger in a
 * group chat driving someone's desktop. So the gate is tested exhaustively and
 * the adapters are kept thin enough to have nothing of their own to test.
 *
 * Needs no bot tokens — every rule here is decidable locally.
 *
 * Run: npm run test:channels
 */
import './support/isolate';
import { ChannelRuntime, Inbound, Reply } from '../channels/base_channel';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { OwnerGate } from '../core/owner_gate';
import { DexRequest } from '../core/events/types';
import { Gateway } from '../core/gateway';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const OWNER = '123456789';
const STRANGER = '987654321';

const gate = new OwnerGate({
  telegram_id: OWNER,
  discord_id: OWNER,
  whatsapp: OWNER,
  trigger_prefix: '@dex',
});

function msg(overrides: Partial<DexRequest> = {}): DexRequest {
  return {
    requestId: '',
    sessionId: '',
    source: 'telegram',
    senderId: OWNER,
    text: 'set volume to 30',
    timestamp: Date.now(),
    chatType: 'direct',
    ...overrides,
  };
}

// ── the gate ─────────────────────────────────────────────────────────────────

function testGate(): void {
  section('Owner Gate — identity');

  check('a direct message from the owner is allowed', gate.evaluate(msg()).allow);
  check(
    'a direct message from anyone else is refused',
    !gate.evaluate(msg({ senderId: STRANGER })).allow,
  );
  check(
    'an unconfigured channel refuses everything',
    !new OwnerGate({}).evaluate(msg()).allow,
    'a bot with no owner set must not accept the first person who messages it',
  );
  check(
    'the CLI is the owner by definition',
    gate.evaluate(msg({ source: 'cli', senderId: 'anything' })).allow,
  );
  check(
    'the Flutter bar is trusted at the connection level',
    gate.evaluate(msg({ source: 'flutter', senderId: 'anything' })).allow,
  );
  check(
    'a numeric id from an API matches a string id from config',
    new OwnerGate({ telegram_id: 123456789 }).evaluate(msg({ senderId: '123456789' })).allow,
    'Telegram sends numbers; config holds strings',
  );
  check('an empty message is not a command', !gate.evaluate(msg({ text: '   ' })).allow);

  section('Owner Gate — groups need to be addressed');

  const inGroup = (text: string, senderId = OWNER) =>
    gate.evaluate(msg({ chatType: 'group', text, senderId }));

  check(
    'the owner with the prefix is allowed',
    inGroup('@dex set volume to 30').allow,
  );
  check(
    'and the prefix is stripped from what runs',
    (inGroup('@dex set volume to 30') as { text: string }).text === 'set volume to 30',
    JSON.stringify(inGroup('@dex set volume to 30')),
  );
  check(
    'the owner WITHOUT the prefix is ignored',
    !inGroup('set volume to 30').allow,
    'otherwise every sentence they type to another person becomes a command',
  );
  check(
    'a stranger WITH the prefix is still ignored',
    !inGroup('@dex set volume to 30', STRANGER).allow,
    'knowing the magic word is not authorisation',
  );
  check('the prefix is case-insensitive', inGroup('@DEX set volume to 30').allow);
  check('a comma after the prefix works', inGroup('@dex, set volume to 30').allow);
  check('a colon after the prefix works', inGroup('@dex: set volume to 30').allow);

  // The dangerous near-miss: a longer word that merely starts with the prefix.
  check(
    '"@dexter" is NOT the prefix',
    !inGroup('@dexter is a good name').allow,
    'a substring match here would run a command nobody issued',
  );
  check(
    'the prefix must be at the start',
    !inGroup('tell @dex to set volume to 30').allow,
  );
  check(
    'the prefix alone is not a command',
    !inGroup('@dex').allow,
  );
  check(
    'a direct message needs no prefix',
    gate.evaluate(msg({ chatType: 'direct', text: 'set volume to 30' })).allow,
  );

  section('Owner Gate — refusals stay local');

  const refusal = gate.evaluate(msg({ senderId: STRANGER }));
  check(
    'a refusal carries a reason for the local log',
    !refusal.allow && typeof (refusal as { reason: string }).reason === 'string',
  );
}

// ── the runtime ──────────────────────────────────────────────────────────────

/** Records everything a channel would have sent. */
function recorder(): Reply & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: async (text) => {
      sent.push(text);
      return String(sent.length - 1);
    },
    edit: async (handle, text) => {
      sent[Number(handle)] = text;
    },
  };
}

function fakeGateway(result: Partial<{ status: string; summary: string }> = {}) {
  const calls: string[] = [];
  const gateway = {
    calls,
    handle: async (_source: string, _sender: string, text: string) => {
      calls.push(text);
      return {
        status: result.status ?? 'COMPLETED',
        summary: result.summary ?? 'done',
        requestId: 'req_1',
      };
    },
  };
  return gateway as unknown as Gateway & { calls: string[] };
}

async function testRuntime(): Promise<void> {
  section('Channel runtime — a stranger gets silence, not a refusal');

  {
    const gateway = fakeGateway();
    const runtime = new ChannelRuntime(gateway, gate, new ConfirmationManager(2_000, 2_000));
    const reply = recorder();

    const inbound: Inbound = {
      senderId: STRANGER,
      chatType: 'group',
      chatId: 'c1',
      text: '@dex set volume to 30',
    };
    await runtime.handle('telegram', inbound, reply);

    check(
      'nothing at all is sent back to a non-owner',
      reply.sent.length === 0,
      JSON.stringify(reply.sent),
    );
    check('and no task is run', gateway.calls.length === 0);
  }

  {
    const gateway = fakeGateway();
    const runtime = new ChannelRuntime(gateway, gate, new ConfirmationManager(2_000, 2_000));
    const reply = recorder();

    await runtime.handle(
      'telegram',
      { senderId: OWNER, chatType: 'group', chatId: 'c1', text: '@dex set volume to 30' },
      reply,
    );

    check('the owner gets a reply', reply.sent.length > 0);
    check(
      'and the task runs with the prefix already stripped',
      gateway.calls[0] === 'set volume to 30',
      JSON.stringify(gateway.calls),
    );
    check(
      'the final message reports the outcome',
      reply.sent.join(' ').includes('done'),
      JSON.stringify(reply.sent),
    );
  }

  {
    // A group message with no prefix must not even reach the Gateway.
    const gateway = fakeGateway();
    const runtime = new ChannelRuntime(gateway, gate, new ConfirmationManager(2_000, 2_000));
    const reply = recorder();
    await runtime.handle(
      'telegram',
      { senderId: OWNER, chatType: 'group', chatId: 'c1', text: 'set volume to 30' },
      reply,
    );
    check(
      'an unaddressed group message runs nothing and says nothing',
      gateway.calls.length === 0 && reply.sent.length === 0,
    );
  }

  section('Channel runtime — approvals answered from chat');

  {
    const confirmations = new ConfirmationManager(2_000, 2_000);
    const gateway = fakeGateway();
    const runtime = new ChannelRuntime(gateway, gate, confirmations);
    const reply = recorder();

    // Answering something that is not pending must not throw, and must not be
    // mistaken for a task.
    await runtime.handle(
      'telegram',
      { senderId: OWNER, chatType: 'direct', chatId: 'c1', text: '/yes abcd' },
      reply,
    );
    check(
      'an approval code that is not pending is reported, not run as a task',
      gateway.calls.length === 0 &&
        reply.sent.some((m) => m.includes('no longer waiting')),
      JSON.stringify(reply.sent),
    );
  }

  {
    const gateway = fakeGateway();
    const runtime = new ChannelRuntime(gateway, gate, new ConfirmationManager(2_000, 2_000));
    const reply = recorder();
    await runtime.handle(
      'telegram',
      { senderId: OWNER, chatType: 'direct', chatId: 'c1', text: 'yes please do it' },
      reply,
    );
    check(
      'ordinary text that merely starts with "yes" is still a task',
      gateway.calls[0] === 'yes please do it',
      JSON.stringify(gateway.calls),
    );
  }
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Slice 5 — channels and the Owner Gate\x1b[0m');
  testGate();
  await testRuntime();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
