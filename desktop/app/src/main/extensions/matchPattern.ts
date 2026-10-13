/**
 * Chrome's match patterns ("<all_urls>", "*://*.example.com/*"), which say
 * where an extension may run and what it may see.
 * https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */

interface Parsed { schemes: Set<string> | 'any'; host: string; subdomains: boolean; port: string | null; path: RegExp }

const cache = new Map<string, Parsed | null>();

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

export function parseMatchPattern(pattern: string): Parsed | null {
  if (cache.has(pattern)) return cache.get(pattern) ?? null;
  let parsed: Parsed | null = null;
  if (pattern === '<all_urls>') {
    parsed = { schemes: new Set(['http', 'https', 'ws', 'wss', 'ftp', 'file', 'urn']), host: '*', subdomains: false, port: null, path: /^.*$/ };
  } else {
    const m = /^(\*|https?|wss?|ftp|file|urn|chrome-extension):\/\/([^/]*)(\/.*)?$/.exec(pattern);
    if (m) {
      const [, scheme, rawHost, rawPath] = m;
      let host = rawHost.toLowerCase();
      let port: string | null = null;
      const portMatch = /^(.*):(\d+|\*)$/.exec(host);
      if (portMatch && !host.startsWith('[')) { host = portMatch[1]; port = portMatch[2] === '*' ? null : portMatch[2]; }
      let subdomains = false;
      if (host.startsWith('*.')) { subdomains = true; host = host.slice(2); }
      const validHost = host === '*' || (host !== '' && !host.includes('*')) || scheme === 'file';
      if (validHost) {
        parsed = {
          schemes: scheme === '*' ? new Set(['http', 'https', 'ws', 'wss']) : new Set([scheme]),
          host,
          subdomains,
          port,
          path: globToRegExp(rawPath ?? '/*'),
        };
      }
    }
  }
  cache.set(pattern, parsed);
  return parsed;
}

/** Whether `url` is covered by `pattern`. */
export function matchesPattern(pattern: string, url: string): boolean {
  const p = parseMatchPattern(pattern);
  if (!p) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const scheme = u.protocol.replace(/:$/, '');
  if (p.schemes !== 'any' && !p.schemes.has(scheme)) return false;
  if (scheme !== 'file') {
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (p.host !== '*') {
      const want = p.host.replace(/^\[|\]$/g, '');
      if (!(host === want || (p.subdomains && host.endsWith(`.${want}`)))) return false;
    }
    if (p.port && u.port !== p.port) return false;
  }
  return p.path.test(`${u.pathname}${u.search}`);
}

export function matchesAny(patterns: readonly string[], url: string): boolean {
  return patterns.some((p) => matchesPattern(p, url));
}
