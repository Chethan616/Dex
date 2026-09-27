/**
 * "Add to Slack": OAuth v2 install of DEX's Slack app into a workspace. The
 * bot token and team id it returns are exactly what the Slack MCP server
 * wants (SLACK_BOT_TOKEN, SLACK_TEAM_ID).
 *
 * Slack matches redirect URLs exactly, so the loopback port is fixed. If the
 * Slack app insists on HTTPS, register an HTTPS relay (firebase/hosting has
 * one: oauth/slack.html) as DEX_SLACK_REDIRECT_URI — it forwards the code to
 * this same loopback address.
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { randomToken, startLoopback, type Loopback } from './loopback';

export const SLACK_LOOPBACK_PORT = 53682;
export const SLACK_BOT_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'reactions:write',
  'users:read',
  'users.profile:read',
  'groups:read',
  'im:history',
];

export interface SlackAccount {
  botToken: string;
  teamId: string;
  teamName?: string;
}

let active: Loopback | null = null;

export function cancelSlack(): void {
  active?.close();
  active = null;
}

export async function connectSlack(): Promise<SlackAccount> {
  const client = oauthClient('slack');
  if (!client?.clientSecret) {
    throw new Error('Slack sign-in isn’t set up in this build yet (no Slack app). See docs/ACCOUNTS_SETUP.md.');
  }
  cancelSlack();
  const loopback = await startLoopback({ port: SLACK_LOOPBACK_PORT, path: '/slack/callback', providerName: 'Slack' });
  active = loopback;
  const redirectUri = client.redirectUri ?? loopback.redirectUri;
  const state = randomToken(16);

  const auth = new URL('https://slack.com/oauth/v2/authorize');
  auth.search = new URLSearchParams({
    client_id: client.clientId,
    scope: SLACK_BOT_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
  }).toString();
  await shell.openExternal(auth.toString());

  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) throw new Error('The Slack response didn’t match this request. Try again.');
    if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'You cancelled the Slack install.' : `Slack said: ${params.get('error')}`);
    const code = params.get('code');
    if (!code) throw new Error('Slack didn’t return a code.');

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; access_token?: string; team?: { id?: string; name?: string } };
    if (!json.ok || !json.access_token || !json.team?.id) throw new Error(`Slack install failed: ${json.error ?? res.status}`);
    mainLogger.info('accounts.slack.connected', { team: json.team.name });
    return { botToken: json.access_token, teamId: json.team.id, teamName: json.team.name };
  } finally {
    if (active === loopback) active = null;
  }
}

export async function revokeSlack(token: string): Promise<void> {
  try {
    await fetch('https://slack.com/api/auth.revoke', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    mainLogger.warn('accounts.slack.revokeFailed', { error: (err as Error).message });
  }
}
