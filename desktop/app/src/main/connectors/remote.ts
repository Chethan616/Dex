/**
 * Hosted connectors (shared/connectorCatalog.ts): connecting one, keeping its
 * token fresh, and taking it away.
 *
 * A connection is an ordinary MCP connection (mcp/store.ts, in the OS
 * credential store) whose server is DEX's proxy, mcp-servers/remote — so
 * every engine reaches it the way it reaches the built-in servers.
 */
import { shell } from 'electron';
import { mainLogger } from '../logger';
import { pkcePair, randomToken, startLoopback, type Loopback } from '../accounts/loopback';
import { hostedConnector, remoteConnectionId, type HostedConnector } from '../../shared/connectorCatalog';
import { authorizeUrl, discover, exchangeCode, refreshTokens, register } from './remoteAuth';

/** What a connection's values hold (never logged). */
export const REMOTE_KEYS = {
  url: 'DEX_REMOTE_URL',
  token: 'DEX_REMOTE_TOKEN',
  refresh: 'DEX_REMOTE_REFRESH',
  expires: 'DEX_REMOTE_EXPIRES',
  clientId: 'DEX_REMOTE_CLIENT_ID',
  clientSecret: 'DEX_REMOTE_CLIENT_SECRET',
  tokenEndpoint: 'DEX_REMOTE_TOKEN_ENDPOINT',
  resource: 'DEX_REMOTE_RESOURCE',
} as const;

let active: Loopback | null = null;

export function cancelRemoteSignIn(): void {
  active?.close();
  active = null;
}

async function store() {
  return import('../mcp/store');
}

/**
 * Connect a hosted connector: sign in through the browser when it needs it,
 * then prove the connection by listing its tools.
 */
export async function connectRemote(id: string): Promise<{ ok: true; toolNames: string[] } | { ok: false; error: string }> {
  const c = hostedConnector(id);
  if (!c) return { ok: false, error: 'Unknown connector.' };
  const connectionId = remoteConnectionId(c.id);
  const { setConnection } = await store();
  try {
    const values: Record<string, string> = { [REMOTE_KEYS.url]: c.url };
    if (c.auth === 'oauth') Object.assign(values, await signIn(c));
    await setConnection(connectionId, { enabled: true, values });
    const verified = await verify(connectionId);
    if (!verified.ok) return { ok: false, error: verified.error ?? `${c.name} didn’t answer.` };
    await setConnection(connectionId, { toolNames: verified.toolNames });
    mainLogger.info('connectors.remote.connected', { id: c.id, tools: verified.toolNames?.length ?? 0 });
    return { ok: true, toolNames: verified.toolNames ?? [] };
  } catch (err) {
    mainLogger.warn('connectors.remote.failed', { id: c.id, error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  } finally {
    active = null;
  }
}

async function signIn(c: HostedConnector): Promise<Record<string, string>> {
  cancelRemoteSignIn();
  const meta = await discover(c.url);
  const state = randomToken(16);
  const loopback = await startLoopback({ providerName: c.name, expectedState: state });
  active = loopback;
  const client = await register(meta, loopback.redirectUri);
  const { verifier, challenge } = pkcePair();
  await shell.openExternal(authorizeUrl(meta, client, loopback.redirectUri, challenge, state));
  const { params } = await loopback.wait;
  const error = params.get('error');
  if (error) throw new Error(error === 'access_denied' ? `You cancelled the ${c.name} sign-in.` : `${c.name} said: ${params.get('error_description') ?? error}`);
  const code = params.get('code');
  if (!code) throw new Error(`${c.name} didn’t return a sign-in code.`);
  const tokens = await exchangeCode(meta, client, code, verifier, loopback.redirectUri);
  return {
    [REMOTE_KEYS.token]: tokens.accessToken,
    [REMOTE_KEYS.refresh]: tokens.refreshToken ?? '',
    [REMOTE_KEYS.expires]: tokens.expiresAt ? String(tokens.expiresAt) : '',
    [REMOTE_KEYS.clientId]: client.clientId,
    [REMOTE_KEYS.clientSecret]: client.clientSecret ?? '',
    [REMOTE_KEYS.tokenEndpoint]: meta.tokenEndpoint,
    [REMOTE_KEYS.resource]: meta.resource,
  };
}

async function verify(connectionId: string): Promise<{ ok: boolean; error?: string; toolNames?: string[] }> {
  const { findServerDefinition } = await import('../mcp/catalog');
  const { listConnections } = await store();
  const { verifyServer } = await import('../mcp/client');
  const definition = findServerDefinition(connectionId);
  const connection = (await listConnections()).find((x) => x.id === connectionId);
  if (!definition || !connection) return { ok: false, error: 'Not saved.' };
  return verifyServer(definition, connection.values);
}

export async function disconnectRemote(id: string): Promise<void> {
  const { removeConnection } = await store();
  await removeConnection(remoteConnectionId(id));
  mainLogger.info('connectors.remote.disconnected', { id });
}

/**
 * A fresh token for a connection: the saved one while it has more than
 * `marginMs` left, otherwise a refreshed one (saved for next time). Null
 * when it can't be refreshed — the user signs in again from the Marketplace.
 */
export async function freshRemoteToken(connectionId: string, marginMs = 10 * 60_000): Promise<string | null> {
  const { listConnections, setConnection } = await store();
  const connection = (await listConnections()).find((x) => x.id === connectionId);
  const v = connection?.values;
  if (!v?.[REMOTE_KEYS.token]) return null;
  const expires = Number(v[REMOTE_KEYS.expires] || 0);
  if (!expires || expires - Date.now() > marginMs) return v[REMOTE_KEYS.token];
  if (!v[REMOTE_KEYS.refresh] || !v[REMOTE_KEYS.tokenEndpoint] || !v[REMOTE_KEYS.clientId]) return null;
  try {
    const t = await refreshTokens(
      v[REMOTE_KEYS.tokenEndpoint],
      { clientId: v[REMOTE_KEYS.clientId], clientSecret: v[REMOTE_KEYS.clientSecret] || undefined },
      v[REMOTE_KEYS.refresh],
      v[REMOTE_KEYS.resource] || v[REMOTE_KEYS.url],
    );
    await setConnection(connectionId, {
      values: {
        [REMOTE_KEYS.token]: t.accessToken,
        [REMOTE_KEYS.refresh]: t.refreshToken ?? '',
        [REMOTE_KEYS.expires]: t.expiresAt ? String(t.expiresAt) : '',
      },
    });
    mainLogger.info('connectors.remote.refreshed', { id: connectionId });
    return t.accessToken;
  } catch (err) {
    mainLogger.warn('connectors.remote.refreshFailed', { id: connectionId, error: (err as Error).message });
    return null;
  }
}

/** Before a run: every enabled hosted connection's token is good for a while. */
export async function refreshRemoteConnections(): Promise<void> {
  const { listConnections } = await store();
  const remote = (await listConnections()).filter((c) => c.enabled && c.id.startsWith('remote_') && c.values?.[REMOTE_KEYS.token]);
  await Promise.all(remote.map((c) => freshRemoteToken(c.id)));
}
