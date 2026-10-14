/**
 * The Pages rail beside a PDF or a Word document (docs/unify/PLAN.md §3.9):
 * a thumbnail per page, drawn only when it scrolls into the rail, a click to
 * jump, and the page you're reading lit. The viewer says how to draw each
 * page (PDF: a small pdf.js render; Word: a scaled copy of the page).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { PageThumb } from './kinds';

const THUMB_W = 116;

export function PagesRail({ pages, scroller }: { pages: PageThumb[]; scroller: HTMLElement | null }): React.ReactElement {
  const railRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);

  // Draw each thumbnail once, as it comes into the rail.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const drawn = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slot = entry.target as HTMLElement;
        const i = Number(slot.dataset.index);
        if (drawn.has(i)) continue;
        drawn.add(i);
        Promise.resolve(pages[i]?.draw(slot, THUMB_W)).catch(() => { /* stays blank */ });
      }
    }, { root: rail, rootMargin: '300px 0px' });
    rail.querySelectorAll('.dv-pages__slot').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  // Which page is being read: the last one whose top has passed the top of the view.
  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const top = scroller.getBoundingClientRect().top + 48;
      let at = 0;
      for (let i = 0; i < pages.length; i += 1) {
        if (pages[i].el.getBoundingClientRect().top <= top) at = i; else break;
      }
      setCurrent((prev) => (prev === at ? prev : at));
    };
    const onScroll = (): void => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [pages, scroller]);

  // Keep the lit thumbnail in sight.
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.closest('button')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <nav className="dv-pages" aria-label="Pages" ref={railRef}>
      {pages.map((p, i) => (
        <button
          key={i}
          type="button"
          className={`dv-pages__item${i === current ? ' dv-pages__item--on' : ''}`}
          aria-current={i === current ? 'page' : undefined}
          aria-label={`Page ${i + 1}`}
          onClick={() => p.el.scrollIntoView({ block: 'start' })}
        >
          <span className="dv-pages__slot" data-index={i} style={{ width: THUMB_W, minHeight: Math.round(THUMB_W * p.ratio) }} />
          <span className="dv-pages__num">{i + 1}</span>
        </button>
      ))}
    </nav>
  );
}
