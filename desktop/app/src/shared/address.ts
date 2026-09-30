/**
 * What the address bar makes of what you typed: a URL to open, or a search.
 *
 * Mirrors a browser's omnibox well enough for DEX's workspace:
 *   "github.com"            → https://github.com/
 *   "localhost:5173/x"      → http://localhost:5173/x
 *   "192.168.1.4"           → http://192.168.1.4/
 *   "https://a.b/c?d"       → as typed
 *   "about:blank"           → as typed
 *   "vit library proxy"    → a web search
 * Never `javascript:` or `data:` — typed into an address bar those are an
 * attack, not a destination — and never `file:`, which reaches the disk.
 */

const SEARCH = 'https://www.google.com/search?q=';
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'about:']);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOST_LIKE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/i;

export function searchUrl(query: string): string {
  return SEARCH + encodeURIComponent(query.trim());
}

export function normalizeAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // An explicit scheme: keep it if it's one a tab may open, otherwise search.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme && !/^[a-z0-9.-]+:\d+/i.test(text)) {
    if (!ALLOWED_SCHEMES.has(`${scheme}:`)) return searchUrl(text);
    try {
      return new URL(text).toString();
    } catch {
      return searchUrl(text);
    }
  }

  // Spaces mean words, not an address.
  if (/\s/.test(text)) return searchUrl(text);

  const hostPart = text.split(/[/?#]/)[0];
  const [host, port] = hostPart.split(':');
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return searchUrl(text);
  const local = host.toLowerCase() === 'localhost' || IPV4.test(host);
  if (!local && !HOST_LIKE.test(host)) return searchUrl(text);

  try {
    return new URL(`${local ? 'http' : 'https'}://${text}`).toString();
  } catch {
    return searchUrl(text);
  }
}

/** What the address bar shows for a page: no scheme noise for the web. */
export function displayAddress(url: string): string {
  if (!url || url === 'about:blank') return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
      return `${u.host}${rest}`;
    }
  } catch {
    /* not a URL */
  }
  return url;
}
