/**
 * "Continue with Hugging Face" — for free AI 3D models (dex-3d: Hunyuan3D,
 * TRELLIS on Hugging Face Spaces) and text-to-image.
 *
 * Needs no registered app and no secret. Hugging Face supports Client ID
 * Metadata Documents: DEX's client ID is the URL of a small public JSON file
 * (firebase/hosting/.well-known/oauth-cimd, on the project's free Firebase
 * Hosting), used with PKCE and a loopback redirect on any port. So every
 * install signs in with nothing to set up — unlike Google.
 *
 * Scopes: openid + profile (who you are) and inference-api (text-to-image
 * through Inference Providers). ZeroGPU Spaces only need to know who you
 * are: your free daily GPU quota is what they spend.
 *
 * The token lives in the OS credential store (keytar), not with the MCP
 * connections — there is no Hugging Face MCP server behind it.
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { oauthClient } from './oauthClients';
import { pkcePair, randomToken, startLoopback, type Loopback } from './loopback';

export const HF_CIMD_CLIENT_ID = 'https://dexv3-chethan616.web.app/.well-known/oauth-cimd';
export const HF_SCOPES = ['openid', 'profile', 'inference-api'];

const SERVICE = 'DEX';
const ACCOUNT = 'huggingface';

export interface HuggingFaceAccount {
  accessToken: string;
  refreshToken?: string;
  /** ms epoch; absent for a personal access token (no expiry). */
  expiresAt?: number;
  username: string;
  name?: string;
  picture?: string;
  /** How it was connected: the OAuth sign-in, or a pasted access token. */
  kind: 'oauth' | 'token';
}

type KeytarLike = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

function keytar(): KeytarLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike;
  } catch {
    return null;
  }
}

export async function loadHuggingFace(): Promise<HuggingFaceAccount | null> {
  const raw = await keytar()?.getPassword(SERVICE, ACCOUNT).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HuggingFaceAccount;
  } catch {
    return null;
  }
}

async function saveHuggingFace(account: HuggingFaceAccount): Promise<void> {
  const k = keytar();
  if (!k) throw new Error('No credential store on this system to keep the Hugging Face sign-in in.');
  await k.setPassword(SERVICE, ACCOUNT, JSON.stringify(account));
}

export async function forgetHuggingFace(): Promise<void> {
  await keytar()?.deletePassword(SERVICE, ACCOUNT).catch(() => false);
}

function clientId(): string {
  return oauthClient('huggingface')?.clientId || HF_CIMD_CLIENT_ID;
}

async function whoami(token: string): Promise<{ username: string; name?: string; picture?: string }> {
  const res = await fetch('https://huggingface.co/api/whoami-v2', { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as { name?: string; fullname?: string; avatarUrl?: string; error?: string };
  if (!res.ok || !json.name) throw new Error(json.error || `Hugging Face didn’t accept that token (HTTP ${res.status}).`);
  const picture = json.avatarUrl ? (json.avatarUrl.startsWith('http') ? json.avatarUrl : `https://huggingface.co${json.avatarUrl}`) : undefined;
  return { username: json.name, name: json.fullname, picture };
}

let active: Loopback | null = null;

export function cancelHuggingFace(): void {
  active?.close();
  active = null;
}

export async function connectHuggingFace(): Promise<HuggingFaceAccount> {
  cancelHuggingFace();
  const loopback = await startLoopback({ providerName: 'Hugging Face', path: '/callback' });
  active = loopback;
  const { verifier, challenge } = pkcePair();
  const state = randomToken(16);

  const auth = new URL('https://huggingface.co/oauth/authorize');
  auth.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: loopback.redirectUri,
    response_type: 'code',
    scope: HF_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  mainLogger.info('accounts.huggingface.start', { redirectUri: loopback.redirectUri });
  await shell.openExternal(auth.toString());

  try {
    const { params } = await loopback.wait;
    if (params.get('state') !== state) throw new Error('The sign-in response didn’t match this request. Try again.');
    const error = params.get('error');
    if (error) throw new Error(error === 'access_denied' ? 'You cancelled the Hugging Face sign-in.' : `Hugging Face said: ${params.get('error_description') || error}`);
    const code = params.get('code');
    if (!code) throw new Error('Hugging Face didn’t return a sign-in code.');

    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: loopback.redirectUri,
      code_verifier: verifier,
    });
    const who = await whoami(tokens.access_token);
    const account: HuggingFaceAccount = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      ...who,
      kind: 'oauth',
    };
    await saveHuggingFace(account);
    mainLogger.info('accounts.huggingface.connected', { username: account.username, refresh: Boolean(account.refreshToken) });
    return account;
  } finally {
    loopback.close();
    if (active === loopback) active = null;
  }
}

/** Connect with a pasted access token (hf_…) instead of signing in. */
export async function connectHuggingFaceToken(token: string): Promise<HuggingFaceAccount> {
  const trimmed = token.trim();
  if (!/^hf_[A-Za-z0-9]{20,}$/.test(trimmed)) throw new Error('That doesn’t look like a Hugging Face token (hf_…).');
  const who = await whoami(trimmed);
  const account: HuggingFaceAccount = { accessToken: trimmed, ...who, kind: 'token' };
  await saveHuggingFace(account);
  return account;
}

async function tokenRequest(fields: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch('https://huggingface.co/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...fields }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Hugging Face sign-in failed: ${json.error_description || json.error || `HTTP ${res.status}`}`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in };
}

/**
 * A usable token right now, refreshing an expiring OAuth token first.
 * Null when not connected (or the sign-in has lapsed and can't be renewed).
 */
let planCache: { at: number; plan: 'pro' | 'free' } | null = null;

/**
 * Free or PRO. PRO buys much more daily ZeroGPU time and first place in
 * the queue — the same sign-in simply goes further, nothing to configure.
 * Asked of Hugging Face at most every 10 minutes; null when it can't say.
 */
export async function huggingFacePlan(): Promise<'pro' | 'free' | null> {
  if (planCache && Date.now() - planCache.at < 10 * 60_000) return planCache.plan;
  const token = await huggingFaceToken();
  if (!token) return null;
  try {
    const res = await fetch('https://huggingface.co/api/whoami-v2', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return planCache?.plan ?? null;
    const who = (await res.json()) as { isPro?: boolean };
    planCache = { at: Date.now(), plan: who.isPro ? 'pro' : 'free' };
    return planCache.plan;
  } catch {
    return planCache?.plan ?? null;
  }
}

export async function huggingFaceToken(): Promise<string | null> {
  const account = await loadHuggingFace();
  if (!account) return null;
  if (!account.expiresAt || account.expiresAt - Date.now() > 5 * 60_000) return account.accessToken;
  if (!account.refreshToken) return account.accessToken;
  try {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
    const next: HuggingFaceAccount = {
      ...account,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    };
    await saveHuggingFace(next);
    return next.accessToken;
  } catch (err) {
    mainLogger.warn('accounts.huggingface.refreshFailed', { error: (err as Error).message });
    return null;
  }
}
