/*
 * Orb — the one busy/thinking indicator for the whole app (thinking-orbs).
 *
 * Replaces every spinner. Theme follows DEX's Light/Dark/System setting rather
 * than the library's own `auto` (which reads prefers-color-scheme only).
 * Sizes are the library's hand-tuned designs: 20 inline, 32 compact, 64 hero.
 */

import React from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { useLibTheme } from '../../design/useLibTheme';

export type { OrbState };

export interface OrbProps {
  state?: OrbState;
  size?: 20 | 32 | 64;
  paused?: boolean;
  speed?: number;
  className?: string;
  /** Accessible label; the orb is decorative unless given one. */
  label?: string;
}

export function Orb({ state = 'working', size = 20, paused, speed, className, label }: OrbProps): React.ReactElement {
  const theme = useLibTheme();
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme={theme}
      paused={paused}
      speed={speed}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** An orb beside a line of text — "Searching…", "Loading models…". */
export function OrbLabel({ state = 'working', children, className }: {
  state?: OrbState;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <span className={`lib-orb-label${className ? ` ${className}` : ''}`} role="status">
      <Orb state={state} size={20} />
      <span className="lib-orb-label__text">{children}</span>
    </span>
  );
}
