/**
 * Your secrets stay yours while DEX shares the page (docs/unify/PLAN.md §3.4).
 *
 * A "secret field" is a password box, or one a site marks or names as a
 * password, one-time code or card number. Two guards keep them from DEX:
 *
 * - **Screenshots.** Just before the agent's screenshot, those fields draw
 *   as dots (`-webkit-text-security`) — including a password you've toggled
 *   to "show" and a card number, which would otherwise be plain text — and
 *   go back right after. Same isolated-world trick as the agent cursor.
 * - **Reads.** What the agent reads back from the page (script results, the
 *   DOM snapshot, the accessibility tree) has any current secret value
 *   replaced, so `input.value` on your password box comes back hidden.
 *
 * Main frame only: a card field in a payment iframe is still drawn as dots
 * by most providers, but its value isn't checked here.
 */

const SECRET_WORLD = 1_000_418;

/** Masked to the agent; what its replies say instead. */
export const HIDDEN = '[hidden by DEX]';

interface SecretContents {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>, userGesture?: boolean): Promise<unknown>;
}

// One test for "is this a secret field", shared by both scripts.
const IS_SECRET = `(el) => {
  if (!(el instanceof HTMLInputElement)) return false;
  const type = (el.type || '').toLowerCase();
  if (type === 'password') return true;
  if (['hidden', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'file', 'range', 'color'].includes(type)) return false;
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (/(current|new)-password|one-time-code|cc-number|cc-csc/.test(ac)) return true;
  const named = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
  return /passw|passwd|pwd|\\bpin\\b|cvv|cvc|card.?num|\\botp\\b/.test(named);
}`;

// Dots on, waiting two frames so they're on screen before the screenshot —
// but not on a hidden tab, where frames never come. A password box already
// draws dots; the rest (toggled to text, card numbers) get them.
const MASK = `(async () => {
  const isSecret = ${IS_SECRET};
  const masked = globalThis.__dexMasked || (globalThis.__dexMasked = []);
  for (const el of document.querySelectorAll('input')) {
    if (!isSecret(el) || el.type === 'password' || masked.some((m) => m[0] === el)) continue;
    masked.push([el, el.style.getPropertyValue('-webkit-text-security'), el.style.getPropertyPriority('-webkit-text-security')]);
    el.style.setProperty('-webkit-text-security', 'disc', 'important');
  }
  if (masked.length) {
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise((r) => setTimeout(r, 80)),
    ]);
  }
  return masked.length;
})()`;

const UNMASK = `(() => {
  const masked = globalThis.__dexMasked || [];
  for (const [el, value, priority] of masked) {
    if (value) el.style.setProperty('-webkit-text-security', value, priority);
    else el.style.removeProperty('-webkit-text-security');
  }
  globalThis.__dexMasked = [];
  return masked.length;
})()`;

// Short values (a 3-digit CVC is the shortest worth hiding) would match too
// much of an ordinary reply.
const VALUES = `(() => {
  const isSecret = ${IS_SECRET};
  const out = [];
  for (const el of document.querySelectorAll('input')) {
    if (isSecret(el) && el.value && el.value.length >= 3) out.push(el.value);
    if (out.length >= 20) break;
  }
  return out;
})()`;

async function run(wc: SecretContents, code: string): Promise<unknown> {
  if (wc.isDestroyed()) return null;
  try {
    return await wc.executeJavaScriptInIsolatedWorld(SECRET_WORLD, [{ code }], false);
  } catch {
    return null; // navigating, crashed, or a page that can't take scripts
  }
}

/** Draw secret fields as dots (true), or put them back (false). Resolves when it's on screen. */
export async function maskSecretFields(wc: SecretContents, on: boolean): Promise<void> {
  await run(wc, on ? MASK : UNMASK);
}

/** The current values of the page's secret fields. */
export async function secretValues(wc: SecretContents): Promise<string[]> {
  const values = await run(wc, VALUES);
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

/** What the agent reads back from a page: where a secret value could show up. */
export const READS_PAGE = new Set([
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.getProperties',
  'Runtime.awaitPromise',
  'DOMSnapshot.captureSnapshot',
  'DOMSnapshot.getSnapshot',
  'Accessibility.getFullAXTree',
  'Accessibility.getPartialAXTree',
  'Accessibility.queryAXTree',
  'Accessibility.getChildAXNodes',
]);

/**
 * `value` with every occurrence of any of `secrets` in its strings replaced
 * by HIDDEN; `hits` is how many strings changed. Unchanged parts are the
 * same objects, so a reply with nothing to hide is returned as is.
 */
export function redactSecrets(value: unknown, secrets: readonly string[]): { value: unknown; hits: number } {
  const wanted = secrets.filter((s) => s.length >= 3);
  if (wanted.length === 0) return { value, hits: 0 };
  let hits = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      let out = v;
      for (const s of wanted) if (out.includes(s)) out = out.split(s).join(HIDDEN);
      if (out !== v) hits++;
      return out;
    }
    if (depth > 64 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let changed = false;
      const next = v.map((item) => {
        const r = walk(item, depth + 1);
        if (r !== item) changed = true;
        return r;
      });
      return changed ? next : v;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      const r = walk(item, depth + 1);
      if (r !== item) changed = true;
      next[k] = r;
    }
    return changed ? next : v;
  };
  return { value: walk(value, 0), hits };
}
