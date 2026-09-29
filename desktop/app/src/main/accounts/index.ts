/**
 * Connected accounts: Google, GitHub, Slack — signed in with one click,
 * never configured with tokens or file paths.
 *
 * Each account is backed by an MCP connection (mcp/store.ts): signing in
 * fills the credential the server needs and switches it on, so every engine
 * gets the tools on its next task with no further setup. Secrets go only to
 * the OS credential store; this file keeps the harmless profile (email,
 * name, avatar) in userData so Settings can show who is connected without
 * touching the keychain.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';
import { listConnections, removeConnection, setConnection } from '../mcp/store';
import { oauthClient, type OAuthProvider } from './oauthClients';
import { cancelGoogle, connectGoogle, refreshGoogleIdToken, revokeGoogle } from './google';
import { cancelGitHub, connectGitHub, connectGitHubViaCli, githubCliAvailable } from './github';
import { cancelHuggingFace, connectHuggingFace, connectHuggingFaceToken, forgetHuggingFace, huggingFacePlan, loadHuggingFace } from './huggingface';
import { huggingFaceUsage } from '../threed/usage';
import { cancelSlack, connectSlack, revokeSlack } from './slack';

export interface AccountProfile {
  identity: string;
  name?: string;
  picture?: string;
  connectedAt: number;
}

export interface AccountInfo {
  provider: OAuthProvider;
  /** Something can sign this provider in (an OAuth client, or for GitHub the CLI). */
  available: boolean;
  /** How the sign-in will happen, so the button can say so. */
  via: 'oauth' | 'cli' | 'none';
  connected: boolean;
  profile?: AccountProfile;
  /**
   * Running from source rather than an installed build. Only then may the UI
   * mention developer setup; an installed DEX never tells its user to run a
   * command — a provider this build can't sign in to is simply not shown.
   */
  devBuild: boolean;
  /** Hugging Face only: the plan (sets the daily GPU time) and today's use. */
  huggingface?: { plan: 'pro' | 'free' | null; modelsToday: number; refillsAt?: number };
}

export type AccountProgress =
  | { provider: OAuthProvider; phase: 'browser' }
  | { provider: OAuthProvider; phase: 'code'; userCode: string; verificationUri: string }
  | { provider: OAuthProvider; phase: 'done'; profile: AccountProfile }
  | { provider: OAuthProvider; phase: 'error'; error: string };

const PROVIDERS: OAuthProvider[] = ['google', 'github', 'slack', 'huggingface'];

/** Fires with the provider whenever an account connects or disconnects. */
export const accountEvents = new EventEmitter();

function profilesPath(): string {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function readProfiles(): Partial<Record<OAuthProvider, AccountProfile>> {
  try {
    return JSON.parse(fs.readFileSync(profilesPath(), 'utf-8')) as Partial<Record<OAuthProvider, AccountProfile>>;
  } catch {
    return {};
  }
}

function writeProfile(provider: OAuthProvider, profile: AccountProfile | null): void {
  const all = readProfiles();
  if (profile) all[provider] = profile;
  else delete all[provider];
  try {
    fs.writeFileSync(profilesPath(), JSON.stringify(all, null, 2), 'utf-8');
  } catch (err) {
    mainLogger.warn('accounts.profiles.writeFailed', { error: (err as Error).message });
  }
}

function broadcast(event: AccountProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('accounts:progress', event);
  }
}

export async function listAccounts(): Promise<AccountInfo[]> {
  const connections = new Map((await listConnections()).map((c) => [c.id, c]));
  const profiles = readProfiles();
  const cli = await githubCliAvailable();
  const hf = await loadHuggingFace();
  const hfPlan = hf ? await huggingFacePlan().catch(() => null) : null;
  return PROVIDERS.map((provider) => {
    // Hugging Face has no MCP server behind it and needs no registered app
    // (its client ID is DEX's public metadata document), so it's always
    // available and "connected" means a stored sign-in.
    if (provider === 'huggingface') {
      return {
        provider,
        available: true,
        via: 'oauth' as const,
        connected: Boolean(hf),
        devBuild: !app.isPackaged,
        profile: hf ? { identity: hf.username, name: hf.name, picture: hf.picture, connectedAt: 0 } : undefined,
        huggingface: hf ? { plan: hfPlan, ...huggingFaceUsage() } : undefined,
      };
    }
    const connection = connections.get(provider);
    const connected = Boolean(connection?.enabled && Object.values(connection.values).some((v) => v));
    const hasClient = provider === 'slack' ? Boolean(oauthClient('slack')?.clientSecret) : Boolean(oauthClient(provider));
    const via: AccountInfo['via'] = hasClient ? 'oauth' : provider === 'github' && cli ? 'cli' : 'none';
    return {
      provider,
      available: via !== 'none',
      via,
      connected,
      devBuild: !app.isPackaged,
      profile: connected ? profiles[provider] ?? (connection?.identity ? { identity: connection.identity, connectedAt: 0 } : undefined) : undefined,
    };
  });
}

/** The stored Google refresh token, for the Firebase bridge. */
export async function googleRefreshToken(): Promise<string | null> {
  const google = (await listConnections()).find((c) => c.id === 'google');
  return google?.enabled ? google.values.GOOGLE_REFRESH_TOKEN || null : null;
}

export async function googleIdToken(): Promise<string | null> {
  const refresh = await googleRefreshToken();
  return refresh ? refreshGoogleIdToken(refresh) : null;
}

let inFlight: OAuthProvider | null = null;

export async function connectAccount(provider: OAuthProvider): Promise<{ ok: boolean; profile?: AccountProfile; error?: string }> {
  if (inFlight && inFlight !== provider) cancelAccount(inFlight);
  inFlight = provider;
  broadcast({ provider, phase: 'browser' });
  try {
    let profile: AccountProfile;
    if (provider === 'google') {
      const account = await connectGoogle();
      await setConnection('google', { enabled: true, values: { GOOGLE_REFRESH_TOKEN: account.refreshToken }, identity: account.email });
      profile = { identity: account.email, name: account.name, picture: account.picture, connectedAt: Date.now() };
    } else if (provider === 'github') {
      // No OAuth app registered but the GitHub CLI is signed in: use that.
      const account = !oauthClient('github') && (await githubCliAvailable())
        ? await connectGitHubViaCli()
        : await connectGitHub((code) => broadcast({ provider, phase: 'code', ...code }));
      await setConnection('github', { enabled: true, values: { GITHUB_PERSONAL_ACCESS_TOKEN: account.token }, identity: account.login });
      profile = { identity: account.login, name: account.name, picture: account.avatar, connectedAt: Date.now() };
    } else if (provider === 'huggingface') {
      const account = await connectHuggingFace();
      profile = { identity: account.username, name: account.name, picture: account.picture, connectedAt: Date.now() };
      writeProfile(provider, profile);
      broadcast({ provider, phase: 'done', profile });
      accountEvents.emit('changed', provider);
      return { ok: true, profile };
    } else {
      const account = await connectSlack();
      await setConnection('slack', { enabled: true, values: { SLACK_BOT_TOKEN: account.botToken, SLACK_TEAM_ID: account.teamId }, identity: account.teamName ?? account.teamId });
      profile = { identity: account.teamName ?? account.teamId, connectedAt: Date.now() };
    }
    writeProfile(provider, profile);
    // Record the server's tool names now, so the very next task's prompt can
    // name them (the agent otherwise hunts for tools or falls back to the
    // browser). Best-effort: a slow first npx download mustn't block sign-in.
    void verifyAndRecord(provider);
    broadcast({ provider, phase: 'done', profile });
    accountEvents.emit('changed', provider);
    return { ok: true, profile };
  } catch (err) {
    const error = (err as Error).message;
    mainLogger.warn('accounts.connect.failed', { provider, error });
    broadcast({ provider, phase: 'error', error });
    return { ok: false, error };
  } finally {
    if (inFlight === provider) inFlight = null;
  }
}

async function verifyAndRecord(provider: OAuthProvider): Promise<void> {
  try {
    const { findServerDefinition } = await import('../mcp/catalog');
    const { verifyServer } = await import('../mcp/client');
    const definition = findServerDefinition(provider);
    const connection = (await listConnections()).find((c) => c.id === provider);
    if (!definition || !connection) return;
    const result = await verifyServer(definition, connection.values);
    if (result.ok && result.toolNames?.length) await setConnection(provider, { toolNames: result.toolNames });
  } catch (err) {
    mainLogger.warn('accounts.verify.failed', { provider, error: (err as Error).message });
  }
}

export function cancelAccount(provider: OAuthProvider): void {
  if (provider === 'google') cancelGoogle();
  else if (provider === 'github') cancelGitHub();
  else if (provider === 'huggingface') cancelHuggingFace();
  else cancelSlack();
}

export async function disconnectAccount(provider: OAuthProvider): Promise<void> {
  const connection = (await listConnections()).find((c) => c.id === provider);
  // Revoke on the provider's side too, so "disconnect" really means it.
  if (provider === 'google' && connection?.values.GOOGLE_REFRESH_TOKEN) await revokeGoogle(connection.values.GOOGLE_REFRESH_TOKEN);
  if (provider === 'slack' && connection?.values.SLACK_BOT_TOKEN) await revokeSlack(connection.values.SLACK_BOT_TOKEN);
  if (provider === 'huggingface') await forgetHuggingFace();
  else await removeConnection(provider);
  writeProfile(provider, null);
  accountEvents.emit('changed', provider);
  mainLogger.info('accounts.disconnected', { provider });
}

function asProvider(value: unknown): OAuthProvider {
  if (value === 'google' || value === 'github' || value === 'slack' || value === 'huggingface') return value;
  throw new TypeError('unknown account provider');
}

export function registerAccountsIpc(): void {
  ipcMain.handle('accounts:list', () => listAccounts());
  ipcMain.handle('accounts:connect', (_e, provider: unknown) => connectAccount(asProvider(provider)));
  ipcMain.handle('accounts:cancel', (_e, provider: unknown) => { cancelAccount(asProvider(provider)); });
  ipcMain.handle('accounts:disconnect', (_e, provider: unknown) => disconnectAccount(asProvider(provider)));
  // Links the account cards may open — a fixed list, never a URL from the page.
  const LINKS: Record<string, string> = {
    'huggingface-pro': 'https://huggingface.co/subscribe/pro',
    'huggingface-billing': 'https://huggingface.co/settings/billing',
    'huggingface-zerogpu': 'https://huggingface.co/docs/hub/spaces-zerogpu',
  };
  ipcMain.handle('accounts:open-link', async (_e, key: unknown) => {
    const url = typeof key === 'string' ? LINKS[key] : undefined;
    if (url) await shell.openExternal(url);
  });
  // Hugging Face also takes a pasted access token (hf_…), for people who'd rather.
  ipcMain.handle('accounts:huggingface-token', async (_e, token: unknown) => {
    try {
      if (typeof token !== 'string') throw new TypeError('token must be a string');
      const account = await connectHuggingFaceToken(token);
      const profile = { identity: account.username, name: account.name, picture: account.picture, connectedAt: Date.now() };
      writeProfile('huggingface', profile);
      broadcast({ provider: 'huggingface', phase: 'done', profile });
      accountEvents.emit('changed', 'huggingface');
      return { ok: true, profile };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
