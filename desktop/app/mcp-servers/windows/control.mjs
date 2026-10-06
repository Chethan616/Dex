/**
 * DEX's loopback control server, as dex-lib.sh reaches it: the control file
 * (DEX_CONTROL_FILE) holds the url and a bearer token. Approvals, the pause
 * gate, screenshots for the chat and desktop events all go through here.
 */
import fs from 'node:fs';

export function controlClient(env = process.env) {
  const file = env.DEX_CONTROL_FILE;
  const sessionId = env.DEX_SESSION_ID || env.BU_SESSION_ID || '';

  function endpoint() {
    if (!file) return null;
    try {
      const { url, token } = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return url && token ? { url, token } : null;
    } catch {
      return null;
    }
  }

  async function post(path, body, timeoutMs = 15_000) {
    const ep = endpoint();
    if (!ep) throw new Error("DEX isn't reachable from here (no control file).");
    const res = await fetch(`${ep.url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ep.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(json?.error ?? json?.message ?? `DEX answered ${res.status}`);
    return json ?? {};
  }

  return {
    sessionId,
    reachable: () => endpoint() !== null && Boolean(sessionId),
    /** Blocks until the user answers (or the policy answers for them). */
    async confirm({ title, detail, category, subject, tier }) {
      const r = await post('/dex/confirm', { sessionId, title, detail, category, subject, tier }, 11 * 60_000);
      return r.approved === true;
    },
    /** {hold, reason}: the user paused DEX, so desktop actions wait. */
    async gate() {
      try { return await post('/dex/desktop-gate', { sessionId }); } catch { return { hold: false }; }
    },
    async event(kind, data = {}) {
      try { await post('/dex/desktop-event', { sessionId, kind, ...data }); } catch { /* best effort */ }
    },
    async screenshot(path, caption, mode = 'raw') {
      try { await post('/dex/screenshot', { sessionId, path, caption, mode }); } catch { /* best effort */ }
    },
  };
}
