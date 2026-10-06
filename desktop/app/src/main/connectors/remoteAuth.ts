/**
 * Signing in to a hosted MCP server, the way the MCP authorization spec
 * lays out (OAuth 2.1):
 *
 *   1. discovery — the server's protected-resource metadata (RFC 9728) names
 *      its authorization server, whose metadata (RFC 8414) names the
 *      endpoints;
 *   2. dynamic client registration (RFC 7591) — DEX registers itself for
 *      this sign-in, so no app has to be set up with each service;
 *   3. authorization code + PKCE in the user's own browser, with a loopback
 *      redirect (RFC 8252) and the server as the token's audience (RFC 8707);
 *   4. refresh before the token runs out.
 *
 * `fetch` is a parameter so the whole flow is testable without a network.
 */

type Fetch = typeof fetch;

export interface AuthServerMeta {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  /** The MCP server, as the token's audience. */
  resource: string;
  scopes?: string[];
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch, when known. */
  expiresAt?: number;
}

async function json(f: Fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await f(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The well-known URL for `base`, keeping its path (RFC 8414 §3, RFC 9728 §3). */
function wellKnown(base: URL, name: string): string[] {
  const p = base.pathname.replace(/\/$/, '');
  return p ? [`${base.origin}/.well-known/${name}${p}`, `${base.origin}/.well-known/${name}`] : [`${base.origin}/.well-known/${name}`];
}

export async function discover(serverUrl: string, f: Fetch = fetch): Promise<AuthServerMeta> {
  const server = new URL(serverUrl);
  // The server's own 401 may point at its metadata.
  let hinted: string | undefined;
  try {
    const res = await f(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'DEX', version: '1' } } }),
      signal: AbortSignal.timeout(10_000),
    });
    hinted = res.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
  } catch { /* fall back to the well-known paths */ }

  let prm: Record<string, unknown> | null = null;
  for (const url of [...(hinted ? [hinted] : []), ...wellKnown(server, 'oauth-protected-resource')]) {
    prm = await json(f, url);
    if (prm) break;
  }
  const authServers = Array.isArray(prm?.authorization_servers) ? (prm!.authorization_servers as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  const as = new URL(authServers[0] ?? server.origin);

  let meta: Record<string, unknown> | null = null;
  for (const url of [...wellKnown(as, 'oauth-authorization-server'), ...wellKnown(as, 'openid-configuration')]) {
    meta = await json(f, url);
    if (meta?.authorization_endpoint && meta?.token_endpoint) break;
    meta = null;
  }
  if (!meta) throw new Error(`${server.host} doesn’t say how to sign in (no OAuth metadata).`);
  const methods = Array.isArray(meta.code_challenge_methods_supported) ? meta.code_challenge_methods_supported : null;
  if (methods && !methods.includes('S256')) throw new Error(`${server.host} doesn’t support a secure sign-in (PKCE S256).`);

  const scopes = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string') : undefined;
  return {
    authorizationEndpoint: String(meta.authorization_endpoint),
    tokenEndpoint: String(meta.token_endpoint),
    registrationEndpoint: typeof meta.registration_endpoint === 'string' ? meta.registration_endpoint : undefined,
    resource: typeof prm?.resource === 'string' ? prm.resource : serverUrl,
    scopes: scopes?.length ? scopes : undefined,
  };
}

export async function register(meta: AuthServerMeta, redirectUri: string, f: Fetch = fetch): Promise<RegisteredClient> {
  if (!meta.registrationEndpoint) throw new Error('This service needs an app registered by hand; DEX can’t sign in to it on its own yet.');
  const res = await f(meta.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'DEX',
      client_uri: 'https://github.com/Chethan616/Dex',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(meta.scopes ? { scope: meta.scopes.join(' ') } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error_description?: string; error?: string };
  if (!res.ok || !body.client_id) throw new Error(`Couldn’t register DEX with this service: ${body.error_description ?? body.error ?? res.status}`);
  return { clientId: body.client_id, clientSecret: body.client_secret || undefined };
}

export function authorizeUrl(meta: AuthServerMeta, client: RegisteredClient, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(meta.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('resource', meta.resource);
  if (meta.scopes) url.searchParams.set('scope', meta.scopes.join(' '));
  return url.toString();
}

async function tokenRequest(tokenEndpoint: string, client: RegisteredClient, params: Record<string, string>, f: Fetch): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: client.clientId });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const res = await f(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !t.access_token) throw new Error(`Sign-in failed: ${t.error_description ?? t.error ?? res.status}`);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || undefined,
    expiresAt: typeof t.expires_in === 'number' ? Date.now() + t.expires_in * 1000 : undefined,
  };
}

export function exchangeCode(meta: AuthServerMeta, client: RegisteredClient, code: string, verifier: string, redirectUri: string, f: Fetch = fetch): Promise<Tokens> {
  return tokenRequest(meta.tokenEndpoint, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, resource: meta.resource }, f);
}

export async function refreshTokens(tokenEndpoint: string, client: RegisteredClient, refreshToken: string, resource: string, f: Fetch = fetch): Promise<Tokens> {
  const t = await tokenRequest(tokenEndpoint, client, { grant_type: 'refresh_token', refresh_token: refreshToken, resource }, f);
  // Not every server rotates refresh tokens: keep the old one when it doesn't.
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}
