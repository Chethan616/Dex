/**
 * Discord sign-in (OAuth2, authorization code + PKCE) for the Discord
 * connector: who you are, your servers, and the channels DEX may post to.
 *
 * Discord gives OAuth apps no way to read anyone's messages, so the connector
 * is about posting: each channel is a webhook Discord creates when you pick
 * that channel on its own consent screen ("webhook.incoming"). Signing in
 * picks the first; "Add a channel" picks more. Removing one deletes its
 * webhook, so DEX can't post there any more.
 *
 * Redirect: http://127.0.0.1:53685/discord/callback, registered on DEX's
 * Discord application (docs/ACCOUNTS_SETUP.md › Discord). With "Public
 * Client" on, no secret is needed (PKCE); a client secret, if configured, is
 * sent too.
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { pkcePair, randomToken, startLoopback, type Loopback } from './loopback';

export const DISCORD_LOOPBACK_PORT = 53685;
export const DISCORD_REDIRECT_URI = `http://127.0.0.1:${DISCORD_LOOPBACK_PORT}/discord/callback`;
const API = 'https://discord.com/api/v10';

/** A channel DEX may post to: the webhook Discord made when you picked it. */
export interface DiscordChannel {
  id: string;
  token: string;
  channelId: string;
  guildId: string;
  /** What Settings and the agent call it: "<server> · #<n>" until renamed. */
  label: string;
}

export interface DiscordAccount {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  username: string;
  name?: string;
  picture?: string;
  channel?: DiscordChannel;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  webhook?: { id: string; token: string; channel_id: string; guild_id: string; name?: string };
}

let active: Loopback | null = null;

export function cancelDiscord(): void {
  active?.close();
  active = null;
}

function client(): { clientId: string; clientSecret?: string } {
  const c = oauthClient('discord');
  if (!c) throw new Error('Discord sign-in needs DEX’s Discord app client ID. See the Discord section in docs/ACCOUNTS_SETUP.md.');
  return c;
}

/** The browser half: Discord's consent screen, back on loopback with a code, exchanged for tokens. */
async function authorize(scopes: string[]): Promise<TokenResponse> {
  const { clientId, clientSecret } = client();
  cancelDiscord();
  const state = randomToken(16);
  const pkce = pkcePair();
  const loopback = await startLoopback({ port: DISCORD_LOOPBACK_PORT, path: '/discord/callback', providerName: 'Discord', expectedState: state });
  active = loopback;
  const auth = new URL('https://discord.com/oauth2/authorize');
  auth.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: DISCORD_REDIRECT_URI,
    scope: scopes.join(' '),
    state,
    prompt: 'consent',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  }).toString();
  await shell.openExternal(auth.toString());
  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) throw new Error('The Discord response didn’t match this sign-in. Try again.');
    if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'You cancelled the Discord sign-in.' : `Discord said: ${params.get('error_description') ?? params.get('error')}`);
    const code = params.get('code');
    if (!code) throw new Error('Discord didn’t return a sign-in code.');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI, client_id: clientId, code_verifier: pkce.verifier });
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await fetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await res.json().catch(() => ({})) as TokenResponse;
    if (!res.ok || !tokens.access_token) throw new Error(`Discord sign-in failed: ${tokens.error_description ?? tokens.error ?? res.status}`);
    return tokens;
  } finally {
    if (active === loopback) active = null;
  }
}

async function guildName(accessToken: string, guildId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/users/@me/guilds`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return ((await res.json()) as Array<{ id: string; name: string }>).find((g) => g.id === guildId)?.name ?? null;
  } catch {
    return null;
  }
}

async function toChannel(accessToken: string, w: NonNullable<TokenResponse['webhook']>, taken: DiscordChannel[]): Promise<DiscordChannel> {
  const server = (await guildName(accessToken, w.guild_id)) ?? 'Discord server';
  const same = taken.filter((c) => c.guildId === w.guild_id).length;
  return { id: w.id, token: w.token, channelId: w.channel_id, guildId: w.guild_id, label: same ? `${server} (${same + 1})` : server };
}

/** "Continue with Discord": your account, and the first channel DEX may post to. */
export async function connectDiscord(): Promise<DiscordAccount> {
  const tokens = await authorize(['identify', 'guilds', 'webhook.incoming']);
  const me = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const user = await me.json().catch(() => ({})) as { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  if (!me.ok || !user.id) throw new Error(`Discord could not confirm the signed-in account (${me.status}).`);
  const channel = tokens.webhook ? await toChannel(tokens.access_token as string, tokens.webhook, []) : undefined;
  mainLogger.info('accounts.discord.connected', { channel: Boolean(channel) });
  return {
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 604_800) * 1000,
    username: user.username ?? user.id,
    name: user.global_name ?? undefined,
    picture: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : undefined,
    channel,
  };
}

/**
 * "Add a channel": Discord's channel picker again. The same scopes as signing
 * in, so the new grant can stand in for the old one: its tokens replace the
 * stored ones (revoking either would end the whole authorization).
 */
export async function addDiscordChannel(taken: DiscordChannel[]): Promise<{ channel: DiscordChannel; accessToken: string; refreshToken: string; expiresAt: number }> {
  const tokens = await authorize(['identify', 'guilds', 'webhook.incoming']);
  if (!tokens.webhook) throw new Error('Discord didn’t create a webhook. Pick a channel on its page and press Authorize.');
  return {
    channel: await toChannel(tokens.access_token as string, tokens.webhook, taken),
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 604_800) * 1000,
  };
}

/** A fresh access token (Discord's last a week, and each refresh replaces the refresh token). */
export async function refreshDiscord(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const { clientId, clientSecret } = client();
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await res.json().catch(() => ({})) as TokenResponse;
  if (!res.ok || !tokens.access_token) throw new Error(tokens.error === 'invalid_grant' ? 'The Discord connection expired. Reconnect it in Connectors.' : `Discord refresh failed: ${tokens.error ?? res.status}`);
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refreshToken, expiresAt: Date.now() + (tokens.expires_in ?? 604_800) * 1000 };
}

/** Delete a channel's webhook: DEX can't post there any more. */
export async function deleteDiscordChannel(c: DiscordChannel): Promise<void> {
  try {
    await fetch(`${API}/webhooks/${c.id}/${c.token}`, { method: 'DELETE' });
  } catch (err) {
    mainLogger.warn('accounts.discord.webhookDeleteFailed', { error: (err as Error).message });
  }
}

export async function revokeDiscord(token: string): Promise<void> {
  try {
    const c = oauthClient('discord');
    if (!c) return;
    const body = new URLSearchParams({ token, client_id: c.clientId });
    if (c.clientSecret) body.set('client_secret', c.clientSecret);
    await fetch(`${API}/oauth2/token/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  } catch (err) {
    mainLogger.warn('accounts.discord.revokeFailed', { error: (err as Error).message });
  }
}

/** The channels kept in the connection (DISCORD_CHANNELS), read defensively. */
export function parseChannels(raw: string | undefined): DiscordChannel[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((c): c is DiscordChannel => Boolean(c && typeof c === 'object'
      && /^\d+$/.test(String((c as DiscordChannel).id)) && typeof (c as DiscordChannel).token === 'string'
      && /^\d+$/.test(String((c as DiscordChannel).channelId)) && typeof (c as DiscordChannel).label === 'string'));
  } catch {
    return [];
  }
}
