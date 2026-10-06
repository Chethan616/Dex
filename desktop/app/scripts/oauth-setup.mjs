#!/usr/bin/env node
/**
 * One-time PUBLISHER step — done once by whoever ships DEX, never by users.
 * Registers DEX's sign-in apps with Google, Slack and GitHub, the way Claude's
 * connectors work: the product owns one app per service, users only click
 * "Connect" and approve it.
 *
 * Writes config/oauth-clients.json (gitignored; local builds package it) and
 * uploads it — plus config/firebase.json — as encrypted GitHub Actions
 * secrets, so every release built by .github/workflows/dex-release.yml has
 * them baked in. Run:  yarn oauth:setup   (re-run any time)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'config', 'oauth-clients.json');
const firebaseCfg = path.join(root, 'config', 'firebase.json');

const SLACK_PORT = 53682;
const SLACK_SCOPES = ['channels:history', 'channels:read', 'chat:write', 'reactions:write', 'users:read', 'users.profile:read', 'groups:read', 'im:history'];

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function open(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url.replace(/&/g, '^&')] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}

const clients = read(target);
const project = read(firebaseCfg).projectId;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(q)).trim();

async function provider(key, title, url, steps, fields) {
  const have = clients[key]?.clientId;
  console.log(`\n${bold(title)} ${have ? dim(`(configured: ${have.slice(0, 16)}…)`) : ''}`);
  const go = await ask(`  ${have ? 'Replace it' : 'Set it up'} now? [${have ? 'y/N' : 'Y/n'}] `);
  if (have ? !/^y/i.test(go) : /^n/i.test(go)) return;
  console.log(`  Opening ${cyan(url.length > 90 ? `${url.slice(0, 90)}…` : url)}`);
  open(url);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  const entry = {};
  for (const [field, label] of fields) {
    const value = await ask(`  ${label}: `);
    if (!value) { console.log(dim('  skipped')); return; }
    entry[field] = value;
  }
  if (key === 'slack') entry.redirectUri = `http://127.0.0.1:${SLACK_PORT}/slack/callback`;
  clients[key] = entry;
  fs.writeFileSync(target, `${JSON.stringify(clients, null, 2)}\n`, { mode: 0o600 });
  console.log(`  ✓ saved to ${path.relative(process.cwd(), target)}`);
}

console.log(bold('DEX sign-in apps (one-time, publisher only)'));
console.log(dim('Users never see this — they only click “Connect”. Nothing here is committed; it is stored as encrypted release secrets.'));

await provider(
  'google',
  'Google — Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts, Tasks, Chat',
  `https://console.cloud.google.com/auth/clients/create${project ? `?project=${project}` : ''}`,
  [
    'If asked, configure the consent screen: app name DEX, your email, Audience “External”.',
    'Application type: Desktop app · Name: DEX · Create. (A Desktop client secret is not confidential — Google expects it inside the app.)',
    'Copy the Client ID and Client secret below.',
    'Then Audience → “Publish app”, so anyone can connect (not just test users). Gmail/Drive scopes show an “unverified app” notice until Google verifies DEX — submit under Verification Center when ready.',
  ],
  [['clientId', 'Client ID'], ['clientSecret', 'Client secret']],
);

const slackManifest = {
  display_information: { name: 'DEX', description: 'Your AI agent on your PC', background_color: '#131318' },
  features: { bot_user: { display_name: 'DEX', always_online: false } },
  oauth_config: { redirect_urls: [`http://127.0.0.1:${SLACK_PORT}/slack/callback`], scopes: { bot: SLACK_SCOPES } },
  settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
};
await provider(
  'slack',
  'Slack — channels and messages',
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest))}`,
  [
    'Pick your workspace — scopes and redirect URL are pre-filled — and Create.',
    'Manage Distribution → remove hard-coded info if flagged → “Activate Public Distribution”, so any workspace can connect.',
    'Basic Information → App Credentials.',
    'Copy the Client ID and Client Secret below.',
  ],
  [['clientId', 'Client ID'], ['clientSecret', 'Client Secret']],
);

await provider(
  'github',
  'GitHub — repositories, issues, pull requests',
  'https://github.com/settings/applications/new',
  [
    'Name: DEX · Homepage: https://github.com/Chethan616/Dex · Callback URL: http://127.0.0.1 · Register.',
    'Tick “Enable Device Flow” → Update.',
    'Copy the Client ID below (no secret needed).',
  ],
  [['clientId', 'Client ID']],
);

await provider(
  'microsoft',
  'Microsoft 365 — Outlook, Calendar, OneDrive, SharePoint, Teams, To Do',
  'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade',
  [
    'Name: DEX · Supported account types: Accounts in any organizational directory and personal Microsoft accounts.',
    'Redirect URI: Platform: Mobile and desktop applications · Redirect URI: http://127.0.0.1 · Register.',
    'Under Authentication → Advanced settings, allow public client flows: Yes.',
    'Copy the Application (client) ID below.',
    'Optional: Under Certificates & secrets, create a client secret if needed, or leave blank for PKCE.',
  ],
  [['clientId', 'Application (client) ID'], ['clientSecret', 'Client secret (optional)']],
);

rl.close();

// Hand the config to the release pipeline, so installed builds have it with
// zero setup. Encrypted repo secrets via the GitHub CLI; nothing is committed.
const REPO = 'Chethan616/Dex';
function setSecret(name, file) {
  if (!fs.existsSync(file)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn('gh', ['secret', 'set', name, '-R', REPO], { stdio: ['pipe', 'ignore', 'pipe'], shell: process.platform === 'win32' });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code !== 0) console.log(dim(`  ${name}: ${err.trim() || `gh exited ${code}`}`));
      resolve(code === 0);
    });
    child.stdin.end(fs.readFileSync(file));
  });
}
console.log(`\n${bold('Release secrets')} ${dim(`(${REPO})`)}`);
for (const [name, file] of [['DEX_OAUTH_CLIENTS_JSON', target], ['DEX_FIREBASE_CONFIG_JSON', firebaseCfg]]) {
  const ok = await setSecret(name, file);
  console.log(`  ${ok ? '✓' : '·'} ${name}${ok ? '' : dim(' — not uploaded (needs `gh auth login` with repo access)')}`);
}
console.log(`\n${bold('Done.')} Restart DEX — Settings → Accounts shows plain Connect buttons, and the next tagged release ships them to everyone.`);
