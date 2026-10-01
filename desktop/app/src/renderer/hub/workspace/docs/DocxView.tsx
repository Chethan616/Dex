/**
 * Word pages (docx-preview): laid out as pages, with tracked changes shown as
 * redlines when `redlines` is on — what an agent's edits look like to a
 * reviewer. Images and embedded fonts come in as data: URLs, so nothing is
 * fetched. Links are cut down to web, mail and in-document anchors; the
 * DocumentView decides what a click does.
 */
import React, { useEffect, useRef } from 'react';
import { renderAsync } from 'docx-preview';
import { safeHref, type OutlineItem, type ViewerProps } from './kinds';

export default function DocxView({ bytes, zoom, redlines = true, onReady, onOutline, onError }: ViewerProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const styles = styleRef.current;
    if (!host || !styles) return;
    let cancelled = false;
    host.replaceChildren();
    styles.replaceChildren();
    renderAsync(bytes.slice(), host, styles, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderChanges: redlines,
      renderComments: false,
      useBase64URL: true,
      experimental: false,
    })
      .then(() => {
        if (cancelled) return;
        for (const a of Array.from(host.querySelectorAll('a'))) {
          if (!safeHref(a.getAttribute('href'))) a.removeAttribute('href');
          a.removeAttribute('target');
        }
        onReady?.();
        // Headings, by Word's built-in styles (docx_heading1…3) or real <h1>–<h3>.
        const items: OutlineItem[] = [];
        for (const el of Array.from(host.querySelectorAll<HTMLElement>('[class*="docx_heading"], h1, h2, h3'))) {
          const m = /docx_heading(\d)/.exec(el.className) ?? /^H(\d)$/.exec(el.tagName);
          const level = m ? Number(m[1]) : 1;
          const label = el.textContent?.trim();
          if (label && level <= 3) items.push({ label: label.slice(0, 120), level, el });
        }
        onOutline?.(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) onError?.(`Couldn’t read this Word document: ${(err as Error)?.message ?? err}`);
      });
    return () => { cancelled = true; };
  }, [bytes, redlines, onReady, onOutline, onError]);

  return (
    <div className="dv-docx">
      <div ref={styleRef} hidden />
      <div ref={hostRef} style={{ zoom }} />
    </div>
  );
}
