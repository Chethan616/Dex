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
    .c { position: absolute; left: 0; top: 0; width: 28px; height: 28px; margin: -5px 0 0 -6px; opacity: 0;
         transition-property: transform, opacity; transition-timing-function: cubic-bezier(.2,.8,.2,1);
         will-change: transform; filter: drop-shadow(0 2px 5px rgba(0,0,0,.35)) drop-shadow(0 0 9px rgba(79,140,255,.45)); }
    .c.on { opacity: 1; }
    .c svg { display: block; transform-origin: 6px 5px; transition: transform .12s ease; }
    .c.press svg { transform: scale(.84); }
    .tag { position: absolute; left: 21px; top: 22px; padding: 2px 8px 2px 7px; border-radius: 999px;
           background: linear-gradient(135deg, #3bb4ff, #7b5cff); color: #fff; font: 700 10px/1.5 system-ui, sans-serif;
           letter-spacing: .04em; box-shadow: 0 1px 4px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.35); white-space: nowrap; }
    .ring { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
            border: 2px solid rgba(91,140,255,.9); opacity: .9; animation: ring .5s ease-out forwards; }
    @keyframes ring { to { transform: scale(1.9); opacity: 0; } }
  \`);
  root.adoptedStyleSheets = [sheet];
  const c = document.createElement('div');
  c.className = 'c';
  // A rounded arrowhead with a notched base, in DEX's blue-to-violet, edged in
  // white so it reads on any page; a highlight along its leading edge.
  c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24">'
    + '<defs><linearGradient id="dexg" x1="0.15" y1="0.1" x2="0.85" y2="0.95"><stop offset="0" stop-color="#4cc4ff"/><stop offset="0.55" stop-color="#3d7bff"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs>'
    + '<path d="M5 4.2 L19.4 10.6 L12.9 12.9 L10.6 19.4 Z" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>'
    + '<path d="M5 4.2 L19.4 10.6 L12.9 12.9 L10.6 19.4 Z" fill="url(#dexg)" stroke="url(#dexg)" stroke-width="2.2" stroke-linejoin="round"/>'
    + '<path d="M6.9 6.7 L10.6 8.4" stroke="rgba(255,255,255,.6)" stroke-width="1.2" stroke-linecap="round"/>'
    + '</svg><span class="tag">DEX</span>';
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

// Hiding has to reach the screen before a screenshot is taken, so wait for
// two frames — but not on a hidden tab, where frames never come.
const VISIBILITY = (visible: boolean) => `(async () => {
  const s = globalThis.__dexCursor;
  if (!s || !s.host) return false;
  s.host.style.visibility = ${visible ? "''" : "'hidden'"};
  if (${visible ? 'false' : 'true'}) {
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise((r) => setTimeout(r, 80)),
    ]);
  }
  return true;
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
