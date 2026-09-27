/**
 * "Connect GitHub" with the OAuth device flow.
 *
 * DEX shows a short code, opens github.com/login/device, and the user types
 * (pastes — it's already on the clipboard) the code there. No client secret
 * and no redirect server are involved, which is why GitHub built this flow
 * for native apps. The resulting token works as the GitHub MCP server's
 * GITHUB_PERSONAL_ACCESS_TOKEN.
 */
import { execFile } from 'node:child_process';
import { clipboard, shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';

const SCOPES = 'repo read:org read:user user:email workflow gist notifications';

export interface GitHubDeviceCode {
  userCode: string;
  verificationUri: string;
}

export interface GitHubAccount {
  token: string;
  login: string;
  name?: string;
  avatar?: string;
}

let cancelled = false;

/**
 * If the GitHub CLI is installed and signed in, its token is a ready-made
 * connection: no OAuth app to register, no code to type. `gh auth token`
 * prints the token of the active account.
 */
export function githubTokenFromCli(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      const token = stdout?.trim();
      resolve(!err && token && /^(gho_|ghp_|github_pat_|ghu_)/.test(token) ? token : null);
    });
  });
}

let ghAvailable: boolean | null = null;
/** Cached: whether a signed-in GitHub CLI is on this machine. */
export async function githubCliAvailable(): Promise<boolean> {
  if (ghAvailable === null) ghAvailable = (await githubTokenFromCli()) !== null;
  return ghAvailable;
}

async function whoAmI(token: string): Promise<{ login?: string; name?: string; avatar_url?: string } | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  return res.ok ? (res.json() as Promise<{ login?: string; name?: string; avatar_url?: string }>) : null;
}

/** Connect with the GitHub CLI's login. */
export async function connectGitHubViaCli(): Promise<GitHubAccount> {
  const token = await githubTokenFromCli();
  if (!token) throw new Error('The GitHub CLI isn’t signed in. Run `gh auth login`, or set up a GitHub OAuth app.');
  const user = await whoAmI(token);
  if (!user?.login) throw new Error('GitHub didn’t accept the CLI’s token. Run `gh auth refresh` and try again.');
  mainLogger.info('accounts.github.connectedViaCli', { login: user.login });
  return { token, login: user.login, name: user.name, avatar: user.avatar_url };
}

export function cancelGitHub(): void {
  cancelled = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connectGitHub(onCode: (code: GitHubDeviceCode) => void): Promise<GitHubAccount> {
  const client = oauthClient('github');
  if (!client) {
    throw new Error('GitHub sign-in isn’t set up in this build yet (no OAuth app). See docs/ACCOUNTS_SETUP.md.');
  }
  cancelled = false;

  const start = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, scope: SCOPES }),
  });
  const device = (await start.json()) as {
    device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error_description?: string;
  };
  if (!start.ok || !device.device_code || !device.user_code) {
    throw new Error(`GitHub didn’t start the sign-in: ${device.error_description ?? start.status}`);
  }

  clipboard.writeText(device.user_code);
  onCode({ userCode: device.user_code, verificationUri: device.verification_uri ?? 'https://github.com/login/device' });
  await shell.openExternal(device.verification_uri ?? 'https://github.com/login/device');

  let interval = Math.max(5, device.interval ?? 5) * 1000;
  const deadline = Date.now() + (device.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    if (cancelled) throw new Error('Sign-in cancelled.');
    const poll = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const result = (await poll.json()) as { access_token?: string; error?: string; interval?: number };
    if (result.access_token) {
      const user = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${result.access_token}`, accept: 'application/vnd.github+json' },
      }).then((r) => r.json() as Promise<{ login?: string; name?: string; avatar_url?: string }>);
      mainLogger.info('accounts.github.connected', { login: user.login });
      return { token: result.access_token, login: user.login ?? 'GitHub', name: user.name, avatar: user.avatar_url };
    }
    if (result.error === 'authorization_pending') continue;
    if (result.error === 'slow_down') { interval = (result.interval ?? interval / 1000 + 5) * 1000; continue; }
    if (result.error === 'access_denied') throw new Error('You cancelled the GitHub sign-in.');
    if (result.error === 'expired_token') break;
    throw new Error(`GitHub sign-in failed: ${result.error ?? poll.status}`);
  }
  throw new Error('The GitHub code expired. Start again from DEX.');
}
