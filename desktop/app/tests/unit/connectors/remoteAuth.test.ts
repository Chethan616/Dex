import { describe, expect, it, vi } from 'vitest';
import { authorizeUrl, discover, exchangeCode, refreshTokens, register } from '../../../src/main/connectors/remoteAuth';
import { HOSTED_CONNECTORS, remoteConnectionId } from '../../../src/shared/connectorCatalog';

type Route = (init?: RequestInit) => { status?: number; json?: unknown; headers?: Record<string, string> };

/** A fetch that answers from a table of URLs. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    const r = route(init);
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('signing in to a hosted MCP server', () => {
  it('finds the authorization server from the server’s own 401 and its metadata', async () => {
    const { f } = fakeFetch({
      'https://mcp.example.com/mcp': () => ({ status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } }),
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': () => ({ json: { resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example.com'], scopes_supported: ['read', 'write'] } }),
      'https://auth.example.com/.well-known/oauth-authorization-server': () => ({ json: { authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', registration_endpoint: 'https://auth.example.com/register', code_challenge_methods_supported: ['S256'] } }),
    });
    expect(await discover('https://mcp.example.com/mcp', f)).toEqual({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: 'https://auth.example.com/register',
      resource: 'https://mcp.example.com/mcp',
      scopes: ['read', 'write'],
    });
  });

  it('falls back to the well-known paths and the server’s own origin', async () => {
    const { f } = fakeFetch({
      'https://mcp.example.com/.well-known/oauth-authorization-server': () => ({ json: { authorization_endpoint: 'https://mcp.example.com/a', token_endpoint: 'https://mcp.example.com/t' } }),
    });
    const meta = await discover('https://mcp.example.com/sse', f);
    expect(meta.authorizationEndpoint).toBe('https://mcp.example.com/a');
    expect(meta.registrationEndpoint).toBeUndefined();
    expect(meta.resource).toBe('https://mcp.example.com/sse');
    await expect(register(meta, 'http://127.0.0.1:5000/callback', f)).rejects.toThrow(/registered by hand/);
  });

  it('refuses a server that can’t do PKCE', async () => {
    const { f } = fakeFetch({
      'https://mcp.example.com/.well-known/oauth-authorization-server': () => ({ json: { authorization_endpoint: 'a', token_endpoint: 't', code_challenge_methods_supported: ['plain'] } }),
    });
    await expect(discover('https://mcp.example.com/mcp', f)).rejects.toThrow(/PKCE/);
  });

  it('registers DEX as a public client, then signs in with PKCE for this server only', async () => {
    const meta = { authorizationEndpoint: 'https://auth.example.com/authorize', tokenEndpoint: 'https://auth.example.com/token', registrationEndpoint: 'https://auth.example.com/register', resource: 'https://mcp.example.com/mcp' };
    const { f, calls } = fakeFetch({
      'https://auth.example.com/register': () => ({ status: 201, json: { client_id: 'abc' } }),
      'https://auth.example.com/token': (init) => {
        const body = new URLSearchParams(String(init?.body));
        return body.get('grant_type') === 'authorization_code'
          ? { json: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 } }
          : { json: { access_token: 'AT2', expires_in: 3600 } };
      },
    });
    const client = await register(meta, 'http://127.0.0.1:5000/callback', f);
    expect(client).toEqual({ clientId: 'abc', clientSecret: undefined });
    const reg = JSON.parse(String(calls[0].init?.body));
    expect(reg).toMatchObject({ client_name: 'DEX', redirect_uris: ['http://127.0.0.1:5000/callback'], token_endpoint_auth_method: 'none' });

    const url = new URL(authorizeUrl(meta, client, 'http://127.0.0.1:5000/callback', 'CHALLENGE', 'STATE'));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'abc', code_challenge: 'CHALLENGE', code_challenge_method: 'S256', state: 'STATE', resource: 'https://mcp.example.com/mcp' });

    const tokens = await exchangeCode(meta, client, 'CODE', 'VERIFIER', 'http://127.0.0.1:5000/callback', f);
    expect(tokens.accessToken).toBe('AT1');
    expect(tokens.refreshToken).toBe('RT1');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    const sent = new URLSearchParams(String(calls[1].init?.body));
    expect(sent.get('code_verifier')).toBe('VERIFIER');
    expect(sent.get('resource')).toBe('https://mcp.example.com/mcp');

    // A server that doesn't rotate refresh tokens: the old one is kept.
    const renewed = await refreshTokens(meta.tokenEndpoint, client, 'RT1', meta.resource, f);
    expect(renewed).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT1' });
  });
});

describe('the hosted connector list', () => {
  it('has one entry per id, https endpoints, and engine-safe connection ids', () => {
    const ids = HOSTED_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of HOSTED_CONNECTORS) {
      expect(new URL(c.url).protocol, c.id).toBe('https:');
      expect(remoteConnectionId(c.id)).toMatch(/^remote_[A-Za-z0-9_]+$/);
      expect(c.audiences.length, c.id).toBeGreaterThan(0);
    }
    expect(new Set(HOSTED_CONNECTORS.map((c) => remoteConnectionId(c.id))).size).toBe(ids.length);
  });
});
