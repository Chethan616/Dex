/**
 * Credential CLI — the only supported way to put a secret where DEX can read it.
 *
 *   npm run cred -- list
 *   npm run cred -- set google_oauth_client_secret
 *   npm run cred -- get google_account_email
 *   npm run cred -- delete google_oauth_client_secret
 *
 * `set` reads the value from stdin with echo off, so it never reaches the
 * shell history, the process list, or the scrollback.
 */
import * as readline from 'readline';
import { CredentialStore } from '../core/secrets/credential_store';

const store = new CredentialStore();

/** Secrets DEX itself looks for, so `list` can show what is still missing. */
const KNOWN: Record<string, string> = {
  google_oauth_client_id: 'Google Workspace MCP — OAuth client id',
  google_oauth_client_secret: 'Google Workspace MCP — OAuth client secret',
  google_account_email: 'Which Google account DEX acts as',
  ms365_client_id: 'Microsoft 365 MCP — application (client) id',
  ms365_client_secret: 'Microsoft 365 MCP — client secret',
  ms365_tenant_id: 'Microsoft 365 MCP — directory (tenant) id',
  ms365_account_email: 'Which Microsoft account DEX acts as',
  telegram_bot_token: 'Telegram bot token from @BotFather',
  discord_bot_token: 'Discord bot token from the developer portal',
  groq_api_key: 'Groq API key — the Brain',
  gemini_api_key: 'Google AI Studio key',
  anthropic_api_key: 'Anthropic API key',
};

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
    process.stdout.write(question);
    // Swallow the echo. readline still collects the keystrokes.
    output._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const [command, name] = process.argv.slice(2);

  if (!command || command === 'help') {
    console.log('Usage: npm run cred -- <list|set|get|delete|check> [name]');
    console.log(`Store: ${store.location}`);
    return;
  }

  if (command === 'list' || command === 'check') {
    const present = new Set(store.list());
    console.log(`Store: ${store.location}\n`);
    const names = [...new Set([...present, ...Object.keys(KNOWN)])].sort();
    for (const entry of names) {
      const mark = present.has(entry) ? '\x1b[32m✓\x1b[0m' : '\x1b[90m·\x1b[0m';
      const note = KNOWN[entry] ?? '';
      console.log(`  ${mark} ${entry.padEnd(30)} ${note}`);
    }
    console.log('\n  ✓ = stored and encrypted   · = not set');
    return;
  }

  if (!name) {
    console.error(`"${command}" needs a credential name.`);
    process.exit(1);
  }

  if (command === 'set') {
    const value = await promptHidden(`Value for ${name} (input hidden): `);
    if (!value.trim()) {
      console.error('Nothing entered — no change made.');
      process.exit(1);
    }
    store.set(name, value.trim());
    console.log(`\x1b[32m✓\x1b[0m ${name} encrypted for this Windows account only.`);
    return;
  }

  if (command === 'get') {
    const value = store.get(name);
    if (value === undefined) {
      console.error(`${name} is not set.`);
      process.exit(1);
    }
    // Printed on purpose — `get` exists so the owner can check what is stored.
    process.stdout.write(`${value}\n`);
    return;
  }

  if (command === 'delete') {
    console.log(store.delete(name) ? `Deleted ${name}.` : `${name} was not set.`);
    return;
  }

  console.error(`Unknown command "${command}".`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
