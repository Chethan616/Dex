/**
 * PDF pages (pdf.js): each page is a canvas with a text layer on top, so text
 * can be selected and copied — and later annotated (PLAN.md §3.7). Pages
 * render only as they come near the screen, so a long PDF opens at once.
 */
import React, { useEffect, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OutlineItem, ViewerProps } from './kinds';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** CSS pixels per PDF point at 100%. */
const CSS_PER_PT = 96 / 72;

export default function PdfView({ bytes, zoom, onReady, onOutline, onError }: ViewerProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    // pdf.js takes ownership of the buffer it's given; hand it a copy.
    const task = pdfjs.getDocument({ data: bytes.slice() });

    void (async () => {
      try {
        const doc = await task.promise;
        if (cancelled) return;
        const scale = zoom * CSS_PER_PT;
        const pages: HTMLElement[] = [];
        const drawn = new Set<number>();

        const draw = async (index: number, el: HTMLElement) => {
          if (drawn.has(index)) return;
          drawn.add(index);
          const page = await doc.getPage(index + 1);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const dpr = window.devicePixelRatio || 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.className = 'dv-pdf__canvas';
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          el.appendChild(canvas);
          await page.render({ canvasContext: ctx, canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] }).promise;
          if (cancelled) return;
          const text = document.createElement('div');
          text.className = 'textLayer';
          el.appendChild(text);
          await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
        };

        // Lay every page out at its size first, so the scrollbar is right and
        // pages can be jumped to before they're drawn.
        for (let i = 0; i < doc.numPages; i += 1) {
          const page = await doc.getPage(i + 1);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const el = document.createElement('div');
          el.className = 'dv-pdf__page';
          el.style.width = `${Math.floor(viewport.width)}px`;
          el.style.height = `${Math.floor(viewport.height)}px`;
          el.style.setProperty('--scale-factor', String(scale));
          el.style.setProperty('--total-scale-factor', String(scale));
          el.style.setProperty('--user-unit', '1');
          el.style.setProperty('--scale-round-x', '1px');
          el.style.setProperty('--scale-round-y', '1px');
          el.dataset.page = String(i + 1);
          host.appendChild(el);
          pages.push(el);
        }

        observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const index = Number((entry.target as HTMLElement).dataset.page) - 1;
            void draw(index, entry.target as HTMLElement).catch(() => { /* a page that won't draw stays blank */ });
          }
        }, { rootMargin: '600px 0px' });
        pages.forEach((p) => observer!.observe(p));
        onReady?.();

        // The PDF's own bookmarks, where it has them.
        const outline = await doc.getOutline().catch(() => null);
        if (!outline || cancelled) return;
        const items: OutlineItem[] = [];
        const walk = async (nodes: typeof outline, level: number) => {
          for (const node of nodes) {
            try {
              const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
              const ref = Array.isArray(dest) ? dest[0] : null;
              const index = ref && typeof ref === 'object' ? await doc.getPageIndex(ref as never) : typeof ref === 'number' ? ref : -1;
              if (index >= 0 && pages[index]) items.push({ label: node.title, level, el: pages[index] });
            } catch { /* a broken bookmark is skipped */ }
            if (node.items?.length && level < 3) await walk(node.items, level + 1);
          }
        };
        await walk(outline, 1);
        if (!cancelled) onOutline?.(items);
      } catch (err) {
        if (!cancelled) onError?.(`Couldn't read this PDF: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      void task.destroy();
    };
  }, [bytes, zoom, onReady, onOutline, onError]);

  return <div className="dv-pdf" ref={hostRef} />;
}
