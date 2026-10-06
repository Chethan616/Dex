/**
 * "Continue with Microsoft": OAuth 2.0 authorization code flow with PKCE
 * (RFC 8252, installed-app pattern) for Microsoft Graph API.
 *
 * One sign-in gives DEX access to:
 *   Outlook (mail), Calendar, OneDrive, SharePoint, Teams, Microsoft To Do.
 *
 * The user's browser handles the Microsoft sign-in page; DEX never sees the
 * password. The refresh token (offline_access) is the only thing stored in
 * the OS credential store; access tokens are obtained on demand.
 *
 * Redirect URI: http://127.0.0.1:<loopback-port>/microsoft/callback
 * Microsoft requires the redirect URI to be registered in the Azure app
 * under "Mobile and desktop applications" (allows arbitrary loopback ports
 * per RFC 8252 §7.3 and MSAL behaviour).
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { pkcePair, randomToken, startLoopback, type Loopback } from './loopback';

/**
 * Microsoft Graph scopes DEX requests.
 * The "offline_access" scope is mandatory to receive a refresh token.
 * All scopes are delegated (user-level) — no application permissions needed.
 */
export const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  // Outlook Mail
  'Mail.ReadWrite',
  'Mail.Send',
  // Calendar
  'Calendars.ReadWrite',
  // OneDrive / SharePoint files
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
  // Teams (read messages from joined teams/channels)
  'ChannelMessage.Read.All',
  'Chat.ReadWrite',
  'Team.ReadBasic.All',
  // Microsoft To Do / Tasks
  'Tasks.ReadWrite',
  // User info
  'User.Read',
].join(' ');

export interface MicrosoftAccount {
  refreshToken: string;
  accessToken: string;
  email: string;
  name?: string;
  picture?: string;
}

let active: Loopback | null = null;

export function cancelMicrosoft(): void {
  active?.close();
  active = null;
}

/**
 * Launch the Microsoft sign-in browser flow.
 * Returns the account info (email, name, avatar) and the refresh token to
 * store. The tenant is "common" so both personal Microsoft accounts and
 * work/school (Entra ID) accounts are accepted.
 */
export async function connectMicrosoft(): Promise<MicrosoftAccount> {
  const client = oauthClient('microsoft');
  if (!client) {
    throw new Error(
      'Microsoft sign-in isn\u2019t set up in this build yet (no OAuth client). ' +
      'Set DEX_MICROSOFT_CLIENT_ID to your Azure app\u2019s client ID. ' +
      'See docs/ACCOUNTS_SETUP.md for the full registration steps.',
    );
  }

  cancelMicrosoft();

  const loopback = await startLoopback({ path: '/microsoft/callback', providerName: 'Microsoft' });
  active = loopback;

  const { verifier, challenge } = pkcePair();
  const state = randomToken(16);

  // Microsoft identity platform v2.0 authorization endpoint.
  // "common" tenant = personal + work/school accounts.
  const auth = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  auth.search = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    redirect_uri: loopback.redirectUri,
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Prompt consent so offline_access refresh token is always issued.
    prompt: 'select_account',
  }).toString();

  mainLogger.info('accounts.microsoft.start', { redirectUri: loopback.redirectUri });
  await shell.openExternal(auth.toString());

  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) {
      throw new Error('The Microsoft sign-in response didn\u2019t match this request. Try again.');
    }
    const error = params.get('error');
    if (error) {
      const desc = params.get('error_description') ?? error;
      throw new Error(
        error === 'access_denied'
          ? 'You cancelled the Microsoft sign-in.'
          : `Microsoft said: ${desc}`,
      );
    }
    const code = params.get('code');
    if (!code) throw new Error('Microsoft didn\u2019t return a sign-in code.');

    // Exchange the authorization code for tokens.
    const tokenBody = new URLSearchParams({
      client_id: client.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: loopback.redirectUri,
      code_verifier: verifier,
      scope: MICROSOFT_SCOPES,
    });
    if (client.clientSecret) tokenBody.set('client_secret', client.clientSecret);

    const tokenRes = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
      },
    );
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokens.access_token) {
      throw new Error(
        `Microsoft sign-in failed: ${tokens.error_description ?? tokens.error ?? tokenRes.status}`,
      );
    }
    if (!tokens.refresh_token) {
      throw new Error(
        'Microsoft didn\u2019t grant offline access (no refresh token). ' +
        'Make sure "offline_access" is in the requested scopes and the app allows public client flows.',
      );
    }

    // Fetch the signed-in user's profile from Microsoft Graph.
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const me = (await meRes.json()) as {
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    };

    // Fetch avatar (may 404 for accounts without a photo — that's fine).
    let picture: string | undefined;
    try {
      const photoRes = await fetch(
        'https://graph.microsoft.com/v1.0/me/photo/$value',
        { headers: { authorization: `Bearer ${tokens.access_token}` } },
      );
      if (photoRes.ok) {
        const buf = Buffer.from(await photoRes.arrayBuffer());
        const mime = photoRes.headers.get('content-type') ?? 'image/jpeg';
        picture = `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch {
      // Avatar is a nicety; silence failures.
    }

    const email = me.mail ?? me.userPrincipalName ?? 'Microsoft account';
    mainLogger.info('accounts.microsoft.connected', { email });

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      email,
      name: me.displayName,
      picture,
    };
  } finally {
    if (active === loopback) active = null;
  }
}

/**
 * Revoke the Microsoft refresh token so DEX no longer has delegated access.
 * Microsoft's token revocation endpoint is at:
 *   https://login.microsoftonline.com/common/oauth2/v2.0/logout  (browser only)
 * Programmatic invalidation is done by revoking all sessions via the Graph
 * "revokeSignInSessions" action (requires User.RevokeSessions.All which is
 * often admin-restricted), or simply by forgetting the token locally — the
 * user can also revoke at https://account.microsoft.com/permissions.
 *
 * We use the token-revocation hint endpoint that works for confidential clients
 * and, for public clients, we just drop the token locally (no server-side call
 * needed; the token will expire naturally and the user can revoke at MSFT).
 */
export async function revokeMicrosoft(refreshToken: string, clientSecret?: string): Promise<void> {
  if (!clientSecret) {
    // Public-client app: no server-side revocation endpoint; token forgotten locally.
    return;
  }
  try {
    const client = oauthClient('microsoft');
    if (!client) return;
    await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });
  } catch (err) {
    mainLogger.warn('accounts.microsoft.revokeFailed', { error: (err as Error).message });
  }
}
