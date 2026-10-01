/**
 * Text, code and Markdown. Text is shown as it is, with line numbers (JSON
 * on one long line is pretty-printed); Markdown is rendered the way the chat
 * renders it, with its headings as the outline. Very long files show their
 * first part.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Markdown } from '../../Markdown';
import { extOf, type OutlineItem, type ViewerProps } from './kinds';

/** More than this many characters is "open it in an editor". */
export const MAX_TEXT_CHARS = 2_000_000;

export function decodeText(bytes: Uint8Array, name: string): { text: string; clipped: boolean } {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (extOf(name) === 'json' && text.length < 5_000_000 && !text.trimEnd().includes('\n')) {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* shown as it is */ }
  }
  const clipped = text.length > MAX_TEXT_CHARS;
  return { text: clipped ? text.slice(0, MAX_TEXT_CHARS) : text, clipped };
}

export default function TextView({ bytes, name, zoom, onReady }: ViewerProps): React.ReactElement {
  const { text, clipped } = useMemo(() => decodeText(bytes, name), [bytes, name]);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  useEffect(() => { onReady?.(); }, [text, onReady]);
  return (
    <div className="dv-text" style={{ zoom }}>
      {clipped && <div className="dv-sheet__note">This file is long; showing its first {(MAX_TEXT_CHARS / 1_000_000).toFixed(0)} million characters.</div>}
      <div className="dv-text__body">
        <pre className="dv-text__gutter" aria-hidden="true">{lines.map((_, i) => i + 1).join('\n')}</pre>
        <pre className="dv-text__code">{text}</pre>
      </div>
    </div>
  );
}

export function MarkdownView({ bytes, name, zoom, onReady, onOutline }: ViewerProps): React.ReactElement {
  const { text } = useMemo(() => decodeText(bytes, name), [bytes, name]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    onReady?.();
    const items: OutlineItem[] = [];
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('h1, h2, h3'))) {
      const label = el.textContent?.trim();
      if (label) items.push({ label: label.slice(0, 120), level: Number(el.tagName[1]), el });
    }
    onOutline?.(items);
  }, [text, onReady, onOutline]);
  return (
    <div className="dv-md" ref={ref} style={{ zoom }}>
      <Markdown source={text} />
    </div>
  );
}
