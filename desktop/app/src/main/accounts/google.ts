/**
 * "Continue with Google": one sign-in that gives DEX's built-in Google server
 * (mcp-servers/google) Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts
 * and Tasks — and gives the Firebase bridge the same identity, so the phone
 * app pairs by signing in with the same account.
 *
 * Installed-app OAuth (RFC 8252): system browser + loopback redirect + PKCE.
 * `access_type=offline` + `prompt=consent` so Google always returns a refresh
 * token, which is the only thing stored (in the OS credential store).
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { pkcePair, randomToken, startLoopback, type Loopback } from './loopback';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/tasks',
  // Google Chat: read spaces, messages and memberships; send messages
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
];

export interface GoogleAccount {
  refreshToken: string;
  idToken?: string;
  email: string;
  name?: string;
  picture?: string;
}

let active: Loopback | null = null;

export function cancelGoogle(): void {
  active?.close();
  active = null;
}

export async function connectGoogle(): Promise<GoogleAccount> {
  const client = oauthClient('google');
  if (!client) {
    throw new Error('Google sign-in isn’t set up in this build yet (no OAuth client). See docs/ACCOUNTS_SETUP.md.');
  }
  cancelGoogle();
  const loopback = await startLoopback({ providerName: 'Google' });
  active = loopback;
  const { verifier, challenge } = pkcePair();
  const state = randomToken(16);

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: loopback.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  mainLogger.info('accounts.google.start', { redirectUri: loopback.redirectUri });
  await shell.openExternal(auth.toString());

  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) throw new Error('The sign-in response didn’t match this request. Try again.');
    const error = params.get('error');
    if (error) throw new Error(error === 'access_denied' ? 'You cancelled the Google sign-in.' : `Google said: ${error}`);
    const code = params.get('code');
    if (!code) throw new Error('Google didn’t return a sign-in code.');

    const tokenBody = new URLSearchParams({
      client_id: client.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: loopback.redirectUri,
    });
    if (client.clientSecret) tokenBody.set('client_secret', client.clientSecret);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !tokens.access_token) {
      throw new Error(`Google sign-in failed: ${tokens.error_description ?? tokens.error ?? res.status}`);
    }
    if (!tokens.refresh_token) {
      throw new Error('Google didn’t grant offline access. Remove DEX at myaccount.google.com/permissions and connect again.');
    }

    const who = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json() as Promise<{ email?: string; name?: string; picture?: string }>);

    mainLogger.info('accounts.google.connected', { email: who.email });
    return {
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      email: who.email ?? 'Google account',
      name: who.name,
      picture: who.picture,
    };
  } finally {
    if (active === loopback) active = null;
  }
}

/** A fresh Google ID token from the stored refresh token (Firebase sign-in). */
export async function refreshGoogleIdToken(refreshToken: string): Promise<string | null> {
  const client = oauthClient('google');
  if (!client) return null;
  const body = new URLSearchParams({ client_id: client.clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as { id_token?: string };
  return res.ok && json.id_token ? json.id_token : null;
}

export async function revokeGoogle(refreshToken: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' });
  } catch (err) {
    mainLogger.warn('accounts.google.revokeFailed', { error: (err as Error).message });
  }
}
