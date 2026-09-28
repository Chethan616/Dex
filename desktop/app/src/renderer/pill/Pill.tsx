import React, { useEffect, useRef } from 'react';
import { TaskInput, type TaskInputSubmission, type TaskInputHandle } from '../hub/TaskInput';

declare global {
  interface Window {
    pillAPI: {
      submit: (
        prompt: string,
        attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>,
        engine?: string,
        model?: string,
      ) => Promise<{ task_id: string }>;
      hide: () => void;
      setExpanded: (expanded: boolean | number) => void;
      listSessions: () => Promise<Array<{ id: string; prompt: string; status: string; createdAt: number; primarySite?: string | null; lastUrl?: string | null; lastActivityAt?: number }>>;
      selectSession: (id: string) => void;
      openHub?: () => void;
      openSettings?: () => void;
      setMode?: (mode: 'pill' | 'panel' | 'hidden') => Promise<{ mode: string }>;
      getMode?: () => Promise<'pill' | 'panel' | 'hidden'>;
      onPillModeChanged?: (cb: (mode: 'pill' | 'panel' | 'hidden') => void) => () => void;
      onShown?: (cb: () => void) => () => void;
      setActiveSession?: (id: string | null) => Promise<{ ok: boolean }>;
      getActiveSession?: () => Promise<string | null>;
      onActiveSessionChanged?: (cb: (id: string | null) => void) => () => void;
    };
  }
}

/**
 * The Cmd+K overlay: nothing but the prompt bar. It embeds the hub's own
 * <TaskInput> directly — same component, same props, same CSS — so "make
 * this look like the prompt bar" is structural rather than a styling
 * exercise: there is only one composer implementation, used twice.
 */
export function Pill(): React.ReactElement {
  const taskInputRef = useRef<TaskInputHandle>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // Focus the composer the moment the overlay becomes visible — every time,
  // not just on first mount, since the window is shown/hidden repeatedly
  // rather than recreated.
  useEffect(() => {
    const focusSoon = (): void => { setTimeout(() => taskInputRef.current?.focus(), 50); };
    focusSoon();
    const unsub = window.pillAPI.onShown?.(focusSoon);
    return () => { unsub?.(); };
  }, []);

  // The window is a real OS window sized to its content — measure it
  // directly rather than hand-summing row-height constants, so the two can
  // never drift apart into dead space or clipping.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = (): void => {
      window.pillAPI.setExpanded(Math.ceil(el.getBoundingClientRect().height));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const submitHomePrompt = (input: TaskInputSubmission): void => {
    window.pillAPI.submit(input.prompt, input.attachments, input.engine, input.model);
    window.pillAPI.hide();
  };

  // Class names are deliberately NOT `.cmdbar*`: hub.css (imported for
  // <TaskInput>'s styles) has its own `.cmdbar` / `.cmdbar__scrim` rules for
  // the hub's in-window command bar — max-width 90vw, padding-top 20vh, a
  // modal scrim background, overflow hidden — and they were leaking in.
  return (
    <div className="pill-shell" ref={shellRef}>
      <div className="pill-shell__drag" />
      <TaskInput ref={taskInputRef} onSubmit={submitHomePrompt} onEscape={() => window.pillAPI.hide()} />
    </div>
  );
}

export default Pill;
