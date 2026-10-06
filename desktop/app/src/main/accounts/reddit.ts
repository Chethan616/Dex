/**
 * Reddit installed-app OAuth. DEX opens Reddit in the user's browser, receives
 * the authorization code on loopback, and stores only the refresh token in the
 * OS credential store. Reddit's installed apps have a public client ID and no
 * client secret.
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { randomToken, startLoopback, type Loopback } from './loopback';

export const REDDIT_LOOPBACK_PORT = 53683;
export const REDDIT_REDIRECT_URI = `http://127.0.0.1:${REDDIT_LOOPBACK_PORT}/reddit/callback`;

const REDDIT_SCOPES = ['identity', 'read', 'history', 'submit', 'edit', 'save'];

export interface RedditAccount {
  refreshToken: string;
  username: string;
  name?: string;
}

let active: Loopback | null = null;

export function cancelReddit(): void {
  active?.close();
  active = null;
}

export async function connectReddit(): Promise<RedditAccount> {
  const client = oauthClient('reddit');
  if (!client) {
    throw new Error('Reddit sign-in needs an approved Reddit app client ID. See the Reddit section in docs/ACCOUNTS_SETUP.md.');
  }
  cancelReddit();
  const state = randomToken(16);
  const loopback = await startLoopback({ port: REDDIT_LOOPBACK_PORT, path: '/reddit/callback', providerName: 'Reddit', expectedState: state });
  active = loopback;
  const redirectUri = client.redirectUri ?? loopback.redirectUri;

  const auth = new URL('https://www.reddit.com/api/v1/authorize');
  auth.search = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    state,
    redirect_uri: redirectUri,
    duration: 'permanent',
    scope: REDDIT_SCOPES.join(' '),
  }).toString();
  await shell.openExternal(auth.toString());

  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) throw new Error('The Reddit response didn’t match this sign-in. Try again.');
    if (params.get('error')) {
      throw new Error(params.get('error') === 'access_denied' ? 'You cancelled the Reddit sign-in.' : `Reddit said: ${params.get('error')}`);
    }
    const code = params.get('code');
    if (!code) throw new Error('Reddit didn’t return a sign-in code.');

    const basic = Buffer.from(`${client.clientId}:`).toString('base64');
    const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'DEX desktop app',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; error?: string; message?: string };
    if (!tokenResponse.ok || !tokens.access_token) {
      throw new Error(`Reddit sign-in failed: ${tokens.error ?? tokens.message ?? tokenResponse.status}`);
    }
    if (!tokens.refresh_token) throw new Error('Reddit did not return a refresh token. Disconnect DEX in Reddit settings and try again.');

    const meResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: { authorization: `Bearer ${tokens.access_token}`, 'user-agent': 'DEX desktop app' },
    });
    const me = (await meResponse.json()) as { name?: string; subreddit?: { title?: string } };
    if (!meResponse.ok || !me.name) throw new Error(`Reddit could not confirm the signed-in account (${meResponse.status}).`);

    mainLogger.info('accounts.reddit.connected', { username: me.name });
    return { refreshToken: tokens.refresh_token, username: me.name, name: me.subreddit?.title };
  } finally {
    if (active === loopback) active = null;
  }
}

export async function revokeReddit(clientId: string, token: string): Promise<void> {
  try {
    const basic = Buffer.from(`${clientId}:`).toString('base64');
    await fetch('https://www.reddit.com/api/v1/revoke_token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'DEX desktop app',
      },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token' }),
    });
  } catch (err) {
    mainLogger.warn('accounts.reddit.revokeFailed', { error: (err as Error).message });
  }
}
