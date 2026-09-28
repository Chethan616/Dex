/*
 * CopyButton — Libraries.dev's CodeCopy: the copy icon crossfades to a check
 * and a "Copied" tip confirms it. No hover tooltip: the icon says "copy"
 * already, and a label popping up on every pass was noise.
 */

import React, { useEffect, useRef, useState } from 'react';

export function CopyButton({ text, label = 'Copy', className }: {
  text: string;
  label?: string;
  className?: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — nothing to show */
    }
  };

  return (
    <button
      type="button"
      className={`lib-copy${className ? ` ${className}` : ''}`}
      data-copied={copied ? 'true' : undefined}
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
    >
      <svg className="lib-copy__icon lib-copy__icon--copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <svg className="lib-copy__icon lib-copy__icon--check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 8.47L6.27 11.58L12.5 4.58" />
      </svg>
      <span className="lib-copy__tip" aria-hidden="true">Copied</span>
    </button>
  );
}
