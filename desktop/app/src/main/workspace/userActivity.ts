/**
 * Who is touching a page: you, or DEX.
 *
 * You and DEX share the same live tab (docs/unify/PLAN.md §3.4). Nothing
 * blocks your input any more; instead DEX is polite: while you're clicking,
 * scrolling or typing in a tab, its next input to that tab waits until
 * you've paused (or a few seconds pass).
 *
 * Every input to a WebContents fires `input-event`, including what DEX sends
 * through CDP, so the broker marks a short window around each of its own
 * inputs and events inside it aren't counted as yours.
 */

/** What counts as you using the page. Hovering doesn't. */
const USER_INPUT = new Set(['mouseDown', 'mouseUp', 'mouseWheel', 'keyDown', 'rawKeyDown', 'char', 'touchStart', 'gestureScrollBegin']);

const lastUserInput = new WeakMap<object, number>();
const agentInputUntil = new WeakMap<object, number>();

/** Call just before (and after) DEX sends input to `wc`. */
export function noteAgentInput(wc: object, windowMs = 250): void {
  agentInputUntil.set(wc, Date.now() + windowMs);
}

/** Feed every `input-event` of a tab through this. */
export function noteInputEvent(wc: object, type: string): void {
  if (!USER_INPUT.has(type)) return;
  if ((agentInputUntil.get(wc) ?? 0) > Date.now()) return;
  lastUserInput.set(wc, Date.now());
}

export function userActiveWithin(wc: object, ms: number): boolean {
  const at = lastUserInput.get(wc);
  return at !== undefined && Date.now() - at < ms;
}

/**
 * Wait until you've left `wc` alone for `idleMs`, but never longer than
 * `maxWaitMs` — DEX can't be stalled forever by a page you're idling on.
 * Returns how long it waited.
 */
export async function waitForUserIdle(
  wc: object,
  opts: { idleMs?: number; maxWaitMs?: number; stepMs?: number } = {},
): Promise<number> {
  const idleMs = opts.idleMs ?? 1500;
  const maxWaitMs = opts.maxWaitMs ?? 8000;
  const stepMs = opts.stepMs ?? 100;
  const started = Date.now();
  while (userActiveWithin(wc, idleMs) && Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return Date.now() - started;
}
