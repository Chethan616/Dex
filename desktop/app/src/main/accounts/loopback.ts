/**
 * The browser half of a desktop OAuth sign-in: a one-shot HTTP server on
 * 127.0.0.1 that the provider redirects back to with `?code=…&state=…`.
 *
 * This is the flow Google recommends for installed apps (RFC 8252): the
 * system browser does the sign-in — where the user is already logged in and
 * sees the real Google page — and nothing ever asks for a password inside DEX.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface LoopbackResult {
  params: URLSearchParams;
}

export interface Loopback {
  redirectUri: string;
  /** Resolves with the callback's query once the browser comes back. */
  wait: Promise<LoopbackResult>;
  close: () => void;
}

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The callback's query is attacker-controllable: never into HTML raw. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, detail: string, ok: boolean): string {
  const accent = ok ? '#22a45d' : '#d14343';
  const mark = ok
    ? '<path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>DEX — ${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#f4f4f6;--card:#fff;--fg:#1b1b1b;--muted:#6b6b72;--ring:rgba(0,0,0,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#131318;--card:#1d1d21;--fg:#f4f4f5;--muted:#9a9aa3;--ring:rgba(255,255,255,.08)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:min(420px,calc(100vw - 32px));padding:36px 32px;border-radius:24px;background:var(--card);text-align:center;
box-shadow:0 0 0 1px var(--ring),0 4px 42px rgba(0,0,0,.08);animation:in .5s cubic-bezier(.22,1,.36,1) both}
.badge{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;background:${accent};display:grid;place-items:center;
animation:pop .6s .15s cubic-bezier(.34,1.56,.64,1) both}
h1{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.01em}p{margin:0;color:var(--muted)}
@keyframes in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
</style></head><body><div class="card"><div class="badge"><svg width="24" height="24" viewBox="0 0 24 24">${mark}</svg></div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div>
<script>setTimeout(function(){try{window.close()}catch(e){}},2500)</script></body></html>`;
}

/**
 * Start listening. `port` 0 picks a free one (Google allows any loopback port);
 * providers that pin the redirect URL exactly (Slack) pass their fixed port.
 */
export async function startLoopback(opts: { port?: number; path?: string; providerName: string }): Promise<Loopback> {
  const callbackPath = opts.path ?? '/callback';
  let settle: ((r: LoopbackResult) => void) | null = null;
  let reject: ((e: Error) => void) | null = null;
  const wait = new Promise<LoopbackResult>((res, rej) => { settle = res; reject = rej; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== callbackPath) {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const ok = !error && Boolean(url.searchParams.get('code'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(ok
      ? page(`${opts.providerName} connected`, 'You can close this tab and go back to DEX.', true)
      : page('Not connected', error === 'access_denied' ? 'You cancelled the sign-in. Nothing was changed.' : `The sign-in didn’t finish (${error ?? 'no code'}). Try again from DEX.`, false));
    settle?.({ params: url.searchParams });
    settle = null;
    setTimeout(() => server.close(), 500);
  });

  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      rejectListen(err.code === 'EADDRINUSE'
        ? new Error(`${opts.providerName} sign-in needs port ${opts.port} on this PC, and another program is using it. Close it (or restart the PC) and try again.`)
        : err);
    });
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  const timer = setTimeout(() => {
    reject?.(new Error('The sign-in timed out. Start it again from DEX.'));
    server.close();
  }, SIGN_IN_TIMEOUT_MS);
  void wait.finally(() => clearTimeout(timer)).catch(() => {});

  return {
    redirectUri: `http://127.0.0.1:${port}${callbackPath}`,
    wait,
    close: () => {
      clearTimeout(timer);
      reject?.(new Error('Sign-in cancelled.'));
      server.close();
    },
  };
}
