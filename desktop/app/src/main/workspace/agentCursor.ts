/**
 * DEX's cursor: a small arrow that glides to where DEX is about to click, so
 * you can see what it's doing in the page you share (docs/unify/PLAN.md §3.5).
 *
 * It lives *inside* the page, in an isolated world, as one closed-shadow-root
 * element with `pointer-events:none` — page scripts can't see or style it,
 * CSP doesn't block it, and your clicks pass straight through it. (A native
 * overlay view on top can't do that: it would take every click.)
 *
 * The broker moves it before each click and waits for it to arrive, so the
 * motion never trails behind what happens — the same trick Codex uses.
 * It's hidden while DEX takes a screenshot, so the agent never sees itself.
 */

/** Chrome extension and page worlds are small ids; ours stays out of their way. */
const CURSOR_WORLD = 1_000_417;

const enabled = (): boolean => process.env.DEX_AGENT_CURSOR !== '0';

interface CursorContents {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>, userGesture?: boolean): Promise<unknown>;
}

// Built once per page (the isolated world survives between calls until the
// page navigates). Returns the controller.
const INSTALL = `(() => {
  if (globalThis.__dexCursor && globalThis.__dexCursor.host.isConnected) return globalThis.__dexCursor;
  const host = document.createElement('dex-agent-cursor');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(\`
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
    .c { position: absolute; left: 0; top: 0; width: 26px; height: 26px; opacity: 0;
         transition-property: transform, opacity; transition-timing-function: cubic-bezier(.2,.8,.2,1);
         will-change: transform; filter: drop-shadow(0 2px 6px rgba(0,0,0,.35)) drop-shadow(0 0 10px rgba(53,184,255,.55)); }
    .c.on { opacity: 1; }
    .c svg { display: block; transform-origin: 3px 3px; transition: transform .12s ease; }
    .c.press svg { transform: scale(.82); }
    .tag { position: absolute; left: 20px; top: 20px; padding: 2px 7px; border-radius: 999px;
           background: #1683ff; color: #fff; font: 600 10px/1.5 system-ui, sans-serif; letter-spacing: .02em;
           box-shadow: 0 1px 4px rgba(0,0,0,.3); white-space: nowrap; }
    .ring { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
            border: 2px solid rgba(53,184,255,.9); opacity: .9; animation: ring .5s ease-out forwards; }
    @keyframes ring { to { transform: scale(1.9); opacity: 0; } }
  \`);
  root.adoptedStyleSheets = [sheet];
  const c = document.createElement('div');
  c.className = 'c';
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3.2 2.6 20 10.4c.8.4.7 1.5-.1 1.8l-6.5 2.2-2.9 6.2c-.4.8-1.5.7-1.8-.1L2.1 3.8c-.3-.8.4-1.5 1.1-1.2Z" fill="#fff" stroke="#0b2a4a" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="tag">DEX</span>';
  root.appendChild(c);
  (document.documentElement || document.body).appendChild(host);
  const state = { host, root, c, x: innerWidth / 2, y: innerHeight / 2 };
  c.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px)';
  globalThis.__dexCursor = state;
  return state;
})()`;

function moveScript(x: number, y: number, press: boolean): string {
  return `(async () => {
    const s = ${INSTALL};
    if (!s.host.isConnected) (document.documentElement || document.body).appendChild(s.host);
    s.host.style.visibility = '';
    const dist = Math.hypot(${x} - s.x, ${y} - s.y);
    const ms = s.c.classList.contains('on') ? Math.round(Math.min(360, Math.max(90, dist * 0.55))) : 0;
    s.c.style.transitionDuration = ms + 'ms';
    s.c.classList.add('on');
    s.c.style.transform = 'translate(${x}px,${y}px)';
    s.x = ${x}; s.y = ${y};
    await new Promise((r) => setTimeout(r, ms + 16));
    if (${press ? 'true' : 'false'}) {
      s.c.classList.add('press');
      const ring = document.createElement('div');
      ring.className = 'ring';
      ring.style.left = '${x}px'; ring.style.top = '${y}px';
      s.root.appendChild(ring);
      setTimeout(() => ring.remove(), 520);
      setTimeout(() => s.c.classList.remove('press'), 140);
    }
    return ms;
  })()`;
}

const VISIBILITY = (visible: boolean) => `(() => {
  const s = globalThis.__dexCursor;
  if (s && s.host) s.host.style.visibility = ${visible ? "''" : "'hidden'"};
  return !!s;
})()`;

async function run(wc: CursorContents, code: string): Promise<unknown> {
  if (!enabled() || wc.isDestroyed()) return null;
  try {
    return await wc.executeJavaScriptInIsolatedWorld(CURSOR_WORLD, [{ code }], false);
  } catch {
    return null; // navigating, crashed, or a page that can't take scripts (about:blank on error)
  }
}

/** Glide to (x, y) in page CSS pixels and resolve when it's there. */
export async function moveCursor(wc: CursorContents, x: number, y: number, press = false): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  await run(wc, moveScript(Math.round(x), Math.round(y), press));
}

export async function setCursorVisible(wc: CursorContents, visible: boolean): Promise<void> {
  await run(wc, VISIBILITY(visible));
}
