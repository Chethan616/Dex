/*
 * Switch — an on/off toggle with a springy thumb that stretches while it
 * travels (the Libraries.dev liquid-toggle feel, done in CSS so a settings
 * page full of them costs nothing at rest).
 */

import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-on={checked ? 'true' : undefined}
      className={`lib-switch${className ? ` ${className}` : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="lib-switch__thumb" aria-hidden="true" />
    </button>
  );
}
