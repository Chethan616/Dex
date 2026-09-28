/*
 * Segmented — a sliding-pill segmented control, ported from Libraries.dev's
 * detail tabs (`st-panel-tabs` / transitions.dev tabs-sliding): the bar
 * recedes, one pill lifts and glides to the selected option.
 *
 * The pill is positioned from the selected button's offsetLeft/offsetWidth,
 * re-measured on resize, so labels of any width work.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Tooltip explaining the option. */
  hint?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
  /** Extra class on every option button (and `${it}--active` on the chosen one). */
  optionClassName?: string;
}

export function Segmented<T extends string>({
  options, value, onChange, label, size = 'md', fullWidth, className, optionClassName,
}: SegmentedProps<T>): React.ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const active = bar.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!active) { setPill(null); return; }
    setPill((prev) => {
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      return prev && prev.left === next.left && prev.width === next.width ? prev : next;
    });
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, value, options]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [measure]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      ref={barRef}
      className={`lib-seg lib-seg--${size}${fullWidth ? ' lib-seg--full' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {pill && (
        <span
          className="lib-seg__pill"
          aria-hidden="true"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active ? 'true' : undefined}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            title={o.hint}
            className={`lib-seg__opt${optionClassName ? ` ${optionClassName}${active ? ` ${optionClassName}--active` : ''}` : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <span className="lib-seg__icon">{o.icon}</span>}
            <span className="lib-seg__label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
