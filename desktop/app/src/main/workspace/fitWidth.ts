/**
 * Fitting a page into a narrow pane.
 *
 * Tabs render at the pane's real size (no emulation; it blurred text). Most
 * sites reflow at any width, but some keep a minimum width — the Chrome Web
 * Store's header needs ~1250 px — and in a narrow DEX window the rest of the
 * page hung off the pane's right edge. Now, when a page is wider than its
 * pane, DEX zooms it out just enough to fit, the way DEX used to show every
 * page, and puts it back to 100% when the pane is wide enough again.
 *
 * - Only pages that really overflow are touched; responsive ones keep full-size text.
 * - Your own zoom (Ctrl +/−, Ctrl+wheel) is kept apart and multiplies on top.
 * - Never below 50%; a page that's far wider than its pane (a board meant to
 *   scroll sideways) is left to scroll.
 * - The agent's clicks stay right: page zoom changes the page's
 *   devicePixelRatio along with it, and DOM rects and CDP input are both in
 *   CSS pixels.
 */

export interface FitState {
  /** Your own zoom (1 = 100%). */
  userZoom: number;
  /** The width the page's content needs, in CSS px, once it was seen overflowing. */
  contentWidth: number | null;
  /** The fit factor DEX applies on top of yours (1 = none). */
  fit: number;
}

export const MIN_FIT = 0.5;
/** Overflow smaller than this is a page's own slop, not a layout that doesn't fit. */
const SLACK_PX = 16;
/** A page this much wider than its pane is meant to scroll sideways. */
const MAX_OVERFLOW_RATIO = 2;
/** Room for the page's own vertical scrollbar, which narrows what it can use. */
const SCROLLBAR_DIP = 18;

export function freshFit(userZoom = 1): FitState {
  return { userZoom, contentWidth: null, fit: 1 };
}

export function effectiveZoom(s: FitState): number {
  return Math.round(s.userZoom * s.fit * 1000) / 1000;
}

/** The fit a content width needs in a pane `viewWidth` DIP wide, at your zoom. */
function fitFor(contentWidth: number, viewWidth: number, userZoom: number): number {
  if (contentWidth <= 0 || viewWidth <= 0) return 1;
  const needed = (viewWidth - SCROLLBAR_DIP) / (contentWidth * userZoom);
  if (needed >= 1) return 1;
  return Math.max(MIN_FIT / userZoom, Math.floor(needed * 100) / 100);
}

/**
 * After measuring the page (`scrollWidth`/`clientWidth` of its document, in
 * CSS px at the current zoom), what the fit should be.
 */
export function afterMeasure(s: FitState, viewWidth: number, m: { scrollWidth: number; clientWidth: number }): FitState {
  if (s.contentWidth !== null) return afterResize(s, viewWidth);
  const overflow = m.scrollWidth - m.clientWidth;
  if (overflow <= SLACK_PX || m.scrollWidth > m.clientWidth * MAX_OVERFLOW_RATIO) return s;
  const fit = fitFor(m.scrollWidth, viewWidth, s.userZoom);
  if (fit >= 1) return s;
  return { ...s, contentWidth: m.scrollWidth, fit };
}

/** The pane changed size: refit a page already known to need it. */
export function afterResize(s: FitState, viewWidth: number): FitState {
  if (s.contentWidth === null) return s;
  const fit = fitFor(s.contentWidth, viewWidth, s.userZoom);
  // Wide enough again: forget the width, so the page is measured afresh
  // (it may have changed since).
  if (fit >= 1) return { ...s, contentWidth: null, fit: 1 };
  return { ...s, fit };
}

/** You zoomed: keep the fit for the same content, at your new zoom. */
export function withUserZoom(s: FitState, userZoom: number, viewWidth: number): FitState {
  const next = { ...s, userZoom };
  return next.contentWidth === null ? { ...next, fit: 1 } : afterResize(next, viewWidth);
}
