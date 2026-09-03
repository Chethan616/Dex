/**
 * Pairing a chat channel, and proving it works.
 *
 *     npm run test:connectors
 *
 * The bug behind this: owner ids were read from `process.env.DEX_OWNER_TELEGRAM`
 * while `telegramOwner` sat in the settings store, written by the Settings
 * screen and read by the health check. So the screen could report Telegram
 * ready while the core, looking somewhere else entirely, had never started it —
 * and the OwnerGate, looking at the same empty variable, would have rejected
 * the owner's messages if it had.
 *
 * Nothing here touches a real Telegram, Discord or WhatsApp account. The
 * adapters are replaced with fakes; what is under test is which facts the
 * manager reads and what it does with them.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-connectors-'));
process.env.DEX_CONFIG = path.join(scratch, 'settings.json');
process.env.DEX_DB = path.join(scratch, 'dex.db');

// eslint-disable-next-line import/first
import { ChannelManager } from '../channels/manager';
// eslint-disable-next-line import/first
import { readConfig, reloadConfig, writeConfig } from '../core/settings/config_store';

/** Change a few settings, the way the Settings screen does. */
function settings(changes: Record<string, unknown>): void {
  writeConfig({ ...readConfig(), ...changes } as never);
  reloadConfig();
}

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

/** A credential store that holds what it is given and nothing else. */
class FakeCredentials {
  private values = new Map<string, string>();
  resolve(name: string): string | undefined {
    return this.values.get(name);
  }
  set(name: string, value: string): void {
    this.values.set(name, value);
  }
  clear(name: string): void {
    this.values.delete(name);
  }
}

const credentials = new FakeCredentials();
const runtime = {} as never;

function manager(): ChannelManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ChannelManager(runtime, credentials as any);
}

function stateOf(m: ChannelManager, id: 'telegram' | 'discord' | 'whatsapp') {
  return m.states().find((s) => s.id === id)!;
}

section('Nothing configured is a normal state, reported as one');

let m = manager();
check('telegram is not set up', stateOf(m, 'telegram').reason === 'not set up');
check('and not running', !stateOf(m, 'telegram').running);
check('and not claimed to be configured', !stateOf(m, 'telegram').configured);
check(
  'whatsapp says it is switched off rather than misconfigured',
  stateOf(m, 'whatsapp').reason === 'not switched on',
);

section('Half configured is refused, and says which half');

credentials.set('telegram_bot_token', 'fake-token');
m = manager();
check(
  'a token with no owner id will not start',
  !stateOf(m, 'telegram').configured,
);
check(
  'and says so, because a bot with no owner rejects everything silently',
  stateOf(m, 'telegram').reason.includes('owner'),
  stateOf(m, 'telegram').reason,
);

settings({ telegramOwner: '12345' });
credentials.clear('telegram_bot_token');
m = manager();
check('an owner id with no token will not start either',
  !stateOf(m, 'telegram').configured);
check('and names the missing half', stateOf(m, 'telegram').reason === 'no bot token',
  stateOf(m, 'telegram').reason);

section('The owner id comes from settings, which is the whole bug');

credentials.set('telegram_bot_token', 'fake-token');
delete process.env.DEX_OWNER_TELEGRAM;
reloadConfig();
m = manager();

check(
  'with both halves in settings, it is ready to start',
  stateOf(m, 'telegram').configured,
  stateOf(m, 'telegram').reason,
);
check(
  'and no environment variable was involved',
  process.env.DEX_OWNER_TELEGRAM === undefined,
);
check(
  'the settings store is where the screen wrote it',
  readConfig().telegramOwner === '12345',
);

// Clearing the owner in Settings has to take the channel down with it.
settings({ telegramOwner: '' });
m = manager();
check(
  'removing the owner id un-configures it again',
  !stateOf(m, 'telegram').configured,
);

section('Discord is gated the same way, on its own settings');

settings({ telegramOwner: '12345', discordOwner: '' });
credentials.set('discord_bot_token', 'fake-discord');
m = manager();
check('discord has a token but no owner', !stateOf(m, 'discord').configured);
check('telegram is unaffected', stateOf(m, 'telegram').configured);

settings({ discordOwner: '999' });
m = manager();
check('and configuring discord does not disturb telegram',
  stateOf(m, 'discord').configured && stateOf(m, 'telegram').configured);

section('WhatsApp pairs by QR, so its opt-in is the switch');

settings({ whatsappEnabled: true, whatsappOwner: '' });
m = manager();
check('switched on with no number is not configured',
  !stateOf(m, 'whatsapp').configured);
check('and says which part is missing',
  stateOf(m, 'whatsapp').reason.includes('number'),
  stateOf(m, 'whatsapp').reason);

settings({ whatsappOwner: '919999999999' });
m = manager();
check('with a number it is ready', stateOf(m, 'whatsapp').configured);

settings({ whatsappEnabled: false });
m = manager();
check('switching it off is enough to stop it',
  !stateOf(m, 'whatsapp').configured);

section('A test message reports the truth, not a claim');

m = manager();
void (async () => {
  const result = await m.sendTest('telegram', 'hello');
  check(
    'testing a channel that is not running says so',
    !result.ok,
    result.detail,
  );
  check(
    'and names the channel rather than failing anonymously',
    result.detail.toLowerCase().includes('telegram'),
    result.detail,
  );

  fs.rmSync(scratch, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
