/*
 * Liquid-metal primitives (metal-fx), themed from DEX's own setting.
 *
 *  - NewBadge     — the animated "New" pill (Libraries.dev "Live mode · New").
 *  - MetalButton  — a primary CTA wrapped in the chromatic metal ring.
 *  - MetalWordmark— display text with metal running through the glyphs.
 *
 * metal-fx paints over its host element, so each keeps its own markup and
 * MetalFx wraps it. Keep reflectionTargets arrays stable (useMemo) — a new
 * array per render makes MetalFx tear down and rebuild its reflections.
 */

import React from 'react';
import { MetalBadge, MetalFx, MetalText } from 'metal-fx';
import { useLibTheme } from '../../design/useLibTheme';

export function NewBadge({ label = 'New', scale = 1 }: { label?: string; scale?: number }): React.ReactElement {
  const theme = useLibTheme();
  return (
    <span className="lib-new-badge">
      <MetalBadge key={theme} theme={theme} scale={scale}>{label}</MetalBadge>
    </span>
  );
}

export interface MetalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  preset?: 'chromatic' | 'silver' | 'gold';
  size?: 'md' | 'lg';
}

export const MetalButton = React.forwardRef<HTMLButtonElement, MetalButtonProps>(function MetalButton(
  { preset = 'chromatic', size = 'md', className, disabled, children, type = 'button', ...rest },
  ref,
) {
  const theme = useLibTheme();
  return (
    <MetalFx
      key={theme}
      preset={preset}
      variant="button"
      theme={theme}
      innerShadow
      strength={disabled ? 0.55 : 1}
      className="lib-metal-btn-host"
    >
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={`lib-metal-btn lib-metal-btn--${size}${className ? ` ${className}` : ''}`}
        {...rest}
      >
        {children}
      </button>
    </MetalFx>
  );
});

// A literal font stack, not var(--font-display): MetalText also rasterises the
// glyphs into a canvas mask, and canvas `font` can't resolve CSS variables.
export function MetalWordmark({ children, font = "600 34px/1.1 Geist, 'Söhne', system-ui, sans-serif", className }: {
  children: string;
  font?: string;
  className?: string;
}): React.ReactElement {
  const theme = useLibTheme();
  return (
    <MetalText
      key={theme}
      font={font}
      color={theme === 'light' ? '#2a2c31' : '#e2e2e2'}
      theme={theme}
      className={className}
    >
      {children}
    </MetalText>
  );
}
