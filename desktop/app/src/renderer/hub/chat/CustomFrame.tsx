/**
 * An agent-written view (shared/genui.ts `custom`): the agent's HTML in a
 * sandboxed frame — scripts may run, but the frame has no same-origin access,
 * no forms, no popups, no navigation and (by its CSP) no network except a CDN
 * for libraries. DEX's colours go in as `--dex-*` variables read from the
 * hub's live theme, so the view matches light and dark. It talks back only
 * through `dex.reply(text)` (a message, like a card's reply button),
 * `dex.open(url)` and its own height.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { customDocument, type CustomWidget, type DexTokens } from '../../../shared/genui';
import './chart.css';

/** The hub's tokens, as the values the frame can't read for itself. */
function readTokens(el: Element): DexTokens {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--color-bg-base', '#0b0d12'),
    surface: v('--cx-card', v('--color-bg-elevated', '#14161d')),
    'surface-2': v('--cx-tile', '#1b1e27'),
    line: v('--cx-card-line', 'rgba(255,255,255,.12)'),
    fg: v('--color-fg-primary', '#f2f4fa'),
    muted: v('--color-fg-secondary', '#a3a9bd'),
    accent: v('--color-accent-primary', '#7aa2ff'),
    'accent-fg': '#ffffff',
    good: v('--color-status-success', '#3ecf8e'),
    warn: v('--color-status-warning', '#f5b544'),
    bad: v('--color-status-danger', '#ff6b6b'),
    'series-1': v('--cx-series-1', v('--color-accent-primary', '#7aa2ff')),
    'series-2': v('--cx-series-2', '#3ecf8e'),
    'series-3': v('--cx-series-3', '#f5b544'),
    'series-4': v('--cx-series-4', '#ff6b6b'),
  };
}

let seq = 0;

export function CustomFrame({ widget, onReply, onOpenUrl }: {
  widget: CustomWidget;
  onReply?: (text: string) => void;
  onOpenUrl?: (url: string) => void;
}): React.ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const id = useMemo(() => `cxf${(seq += 1)}${Date.now().toString(36)}`, []);
  const [tokens, setTokens] = useState<DexTokens | null>(null);
  const [height, setHeight] = useState(widget.height ?? 240);

  // The theme's colours, read again whenever the theme changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = (): void => setTokens((t) => {
      const next = readTokens(el);
      return t && JSON.stringify(t) === JSON.stringify(next) ? t : next;
    });
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-theme', 'style'] });
    return () => mo.disconnect();
  }, []);

  // Messages only from this frame, and only the three kinds it may send.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { dexFrame?: unknown; kind?: unknown; text?: unknown; url?: unknown; height?: unknown };
      if (!m || m.dexFrame !== id) return;
      if (m.kind === 'height' && typeof m.height === 'number') setHeight(Math.max(60, Math.min(1600, Math.ceil(m.height))));
      else if (m.kind === 'reply' && typeof m.text === 'string' && m.text.trim()) onReply?.(m.text.trim().slice(0, 2000));
      else if (m.kind === 'open' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) onOpenUrl?.(m.url);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, onReply, onOpenUrl]);

  const doc = useMemo(() => (tokens ? customDocument(widget.html, tokens, id) : ''), [widget.html, tokens, id]);

  return (
    <div className="cx-custom" ref={box}>
      {widget.title && <div className="cx-custom__head"><span>{widget.title}</span><span className="cx-custom__badge">made by DEX</span></div>}
      {tokens && (
        <iframe
          ref={frame}
          className="cx-custom__frame"
          title={widget.title ?? 'A view DEX made'}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          style={{ height }}
        />
      )}
    </div>
  );
}
