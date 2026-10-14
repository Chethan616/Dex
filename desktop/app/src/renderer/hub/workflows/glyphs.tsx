/**
 * The workflow graph's glyphs, in the widget kit's line style (hub/chat/
 * Widgets.tsx): a 16-unit box, rounded 1.35 strokes, currentColor. One per
 * step kind, the trigger's clock and play, and the canvas controls.
 */
import React from 'react';
import type { StepKind } from '../../../shared/workflows';

const PATHS = {
  task: <><path d="M7.4 2.2l1.3 3.5 3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5L2.6 7l3.5-1.3z" /><path d="M12.4 10.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" /></>,
  app: <><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2.2" /><path d="M1.8 5.8h12.4" /><path d="M4.2 4.2h.01M6 4.2h.01" /></>,
  web: <><circle cx="8" cy="8" r="6.2" /><path d="M1.8 8h12.4M8 1.8c1.7 1.8 2.6 3.9 2.6 6.2S9.7 12.4 8 14.2C6.3 12.4 5.4 10.3 5.4 8S6.3 3.6 8 1.8z" /></>,
  pc: <><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.8" /><path d="M5.6 14h4.8M8 11v3" /></>,
  notify: <path d="M4 11.2V7.4a4 4 0 018 0v3.8l1.2 1.4H2.8zM6.6 13.6a1.5 1.5 0 002.8 0" />,
  wait: <path d="M4.2 1.8h7.6M4.2 14.2h7.6M5 1.8v2.4c0 1.5 3 2.4 3 3.8 0-1.4 3-2.3 3-3.8V1.8M5 14.2v-2.4c0-1.5 3-2.4 3-3.8 0 1.4 3 2.3 3 3.8v2.4" />,
  ask: <><path d="M2.4 7.4a5.6 5 0 115.6 5c-.9 0-1.8-.2-2.6-.5L2.4 13l.8-2.6a4.7 4.7 0 01-.8-3z" /><path d="M6.5 6.1a1.5 1.5 0 112.9.6c-.4.6-1.4.8-1.4 1.7M8 10.4h.01" /></>,
  clock: <><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.3 1.5" /></>,
  play: <path d="M5.2 3.3v9.4L12.4 8z" />,
  flow: <><rect x="1.6" y="2" width="5.2" height="4" rx="1.3" /><rect x="9.2" y="10" width="5.2" height="4" rx="1.3" /><path d="M6.8 4h2.1a1.6 1.6 0 011.6 1.6V10" /></>,
  close: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  plus: <path d="M8 3.6v8.8M3.6 8h8.8" />,
  minus: <path d="M3.6 8h8.8" />,
  fit: <path d="M2.5 6V3.5a1 1 0 011-1H6M10 2.5h2.5a1 1 0 011 1V6M13.5 10v2.5a1 1 0 01-1 1H10M6 13.5H3.5a1 1 0 01-1-1V10" />,
  check: <path d="M3.2 8.4l3.1 3 6.5-6.6" />,
} satisfies Record<StepKind | string, React.ReactNode>;

export type WfGlyphName = keyof typeof PATHS;

export function WfGlyph({ name, size = 16 }: { name: WfGlyphName; size?: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** What each kind is called on its node: "Web", "App"… */
export const KIND_LABEL: Record<StepKind, string> = {
  task: 'Task', app: 'App', web: 'Web', pc: 'PC', notify: 'Tell you', wait: 'Wait', ask: 'Ask you',
};
