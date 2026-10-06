/**
 * Adapts DEX's Reddit installed-app refresh token to reddit-mcp-server's
 * existing token request. The upstream package still owns the MCP tools and
 * all Reddit API calls; this only changes its one OAuth token exchange.
 */
const tokenUrl = 'https://www.reddit.com/api/v1/access_token';

export function installRedditOAuthBridge({
  fetchImpl = globalThis.fetch.bind(globalThis),
  refreshToken = process.env.DEX_REDDIT_REFRESH_TOKEN,
  clientId = process.env.DEX_REDDIT_CLIENT_ID,
} = {}) {
  if (!refreshToken || !clientId) return;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url !== tokenUrl || method.toUpperCase() !== 'POST') {
      return fetchImpl(input, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('authorization', `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`);
    headers.set('content-type', 'application/x-www-form-urlencoded');
    headers.set('user-agent', 'DEX desktop app');

    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return fetchImpl(input, { ...init, headers, body });
  };
}

installRedditOAuthBridge();
