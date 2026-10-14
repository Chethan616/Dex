import { describe, it, expect } from 'vitest';
import { afterMeasure, afterResize, effectiveZoom, freshFit, MIN_FIT, withUserZoom } from '../../../src/main/workspace/fitWidth';

describe('fitting a too-wide page into the pane', () => {
  it('leaves a page that fits alone', () => {
    const s = afterMeasure(freshFit(), 1023, { scrollWidth: 1008, clientWidth: 1008 });
    expect(effectiveZoom(s)).toBe(1);
  });

  it('zooms a page that overflows just enough to fit (the Web Store at 1023 px)', () => {
    const s = afterMeasure(freshFit(), 1023, { scrollWidth: 1249, clientWidth: 1008 });
    expect(s.contentWidth).toBe(1249);
    expect(effectiveZoom(s)).toBeCloseTo(0.8, 2);
    // Its content fits beside the page's own scrollbar (~15 px).
    expect(1023 / effectiveZoom(s) - 15).toBeGreaterThanOrEqual(1249);
  });

  it('ignores a few pixels of slop', () => {
    expect(effectiveZoom(afterMeasure(freshFit(), 1000, { scrollWidth: 1010, clientWidth: 1000 }))).toBe(1);
  });

  it('leaves pages meant to scroll sideways (a board) alone', () => {
    expect(effectiveZoom(afterMeasure(freshFit(), 1000, { scrollWidth: 4000, clientWidth: 1000 }))).toBe(1);
  });

  it(`never goes below ${MIN_FIT * 100}%`, () => {
    const fitted = afterMeasure(freshFit(), 1000, { scrollWidth: 1250, clientWidth: 1000 });
    expect(effectiveZoom(afterResize(fitted, 400))).toBe(MIN_FIT);
  });

  it('follows the pane as it widens, and lets go once the page fits', () => {
    let s = afterMeasure(freshFit(), 1000, { scrollWidth: 1250, clientWidth: 1000 });
    s = afterResize(s, 1150);
    expect(effectiveZoom(s)).toBeCloseTo(0.9, 2);
    s = afterResize(s, 1400);
    expect(effectiveZoom(s)).toBe(1);
    expect(s.contentWidth).toBeNull();
  });

  it('keeps your zoom separate and multiplies the fit on top', () => {
    let s = afterMeasure(freshFit(), 1000, { scrollWidth: 1250, clientWidth: 1000 });
    s = withUserZoom(s, 1.25, 1000);
    expect(s.userZoom).toBe(1.25);
    // The content still has to fit: 1000 / (1250 × zoom) ≥ 1.
    expect(1000 / effectiveZoom(s)).toBeGreaterThanOrEqual(1250);
    s = withUserZoom(freshFit(), 1.5, 1000);
    expect(effectiveZoom(s)).toBe(1.5);
  });
});
