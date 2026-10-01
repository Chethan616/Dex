/**
 * The bar every onboarding step ends with: Back on the left, the way forward
 * on the right. It sticks to the bottom of the window, so on a short screen
 * the step scrolls under it and "Continue" never drops out of sight.
 */
import React from 'react';

export function ArrowRight(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8h9m0 0L8.5 4m4 4l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StepFooter({ onBack, backDisabled, hint, children }: {
  onBack?: () => void;
  backDisabled?: boolean;
  /** A short line next to the buttons — why Continue is waiting, say. */
  hint?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="ob-footer">
      {onBack && (
        <button type="button" className="ob-btn ob-btn--text" onClick={onBack} disabled={backDisabled}>
          Back
        </button>
      )}
      <span className="ob-footer__hint">{hint}</span>
      <div className="ob-footer__actions">{children}</div>
    </div>
  );
}
