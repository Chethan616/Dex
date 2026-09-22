// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskInput } from '../../../src/renderer/hub/TaskInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom doesn't implement matchMedia. border-beam/voice-glow/metal-fx each
// call it unconditionally on mount (to track the OS theme for `theme="auto"`,
// even when a pinned theme is passed) — without this every render throws
// "window.matchMedia is not a function".
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

vi.mock('../../../src/renderer/hub/EnginePicker', () => ({
  EnginePicker: ({ value }: { value: string }): React.ReactElement => (
    <div data-testid="engine-picker">{value}</div>
  ),
}));

function renderTaskInput(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<TaskInput onSubmit={vi.fn()} />);
  });

  return { container, root };
}

function getField(container: HTMLElement): HTMLDivElement {
  const field = container.querySelector('.mention-field');
  if (!(field instanceof HTMLDivElement)) throw new Error('Missing mention field');
  return field;
}

/** Simulates typing plain text — sets the DOM content directly and fires the
 *  same 'input' event a real keystroke would, same technique as the old
 *  textarea helper this replaces. */
function typeInto(field: HTMLDivElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Places a collapsed caret at the end of the field's (single) text node. */
function placeCaretAtEnd(field: HTMLDivElement): void {
  const textNode = field.firstChild;
  if (!textNode) return;
  const range = document.createRange();
  range.setStart(textNode, (textNode as Text).data?.length ?? 0);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('TaskInput', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('expands the field to fit newline content', () => {
    const { container, root } = renderTaskInput();
    const field = getField(container);
    let scrollHeight = 24;
    Object.defineProperty(field, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    act(() => {
      scrollHeight = 96;
      typeInto(field, 'line one\nline two\nline three\nline four');
    });

    expect(field.style.height).toBe('96px');

    act(() => root.unmount());
  });

  it('caps field growth at the configured max height', () => {
    const { container, root } = renderTaskInput();
    const field = getField(container);
    Object.defineProperty(field, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    });

    act(() => {
      typeInto(field, 'one\ntwo\nthree\nfour\nfive\nsix');
    });

    // TASK_INPUT_MAX_HEIGHT_PX in TaskInput.tsx.
    expect(field.style.height).toBe('160px');

    act(() => root.unmount());
  });

  it('offers @drive and splices it in as plain text, not a chip', () => {
    const { container, root } = renderTaskInput();
    const field = getField(container);

    act(() => {
      typeInto(field, 'find my slp da @dri');
      placeCaretAtEnd(field);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const hint = container.querySelector('.task-input__slash-item');
    expect(hint?.textContent).toContain('@drive');

    act(() => {
      hint!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    // Rendered as a real inline chip (see conversation: user asked for a
    // colored pill rather than plain highlighted text) — but still never a
    // removable command-style chip; it lives inline in the sentence.
    const chip = field.querySelector('.mention-chip');
    expect(chip?.getAttribute('data-mention')).toBe('drive');
    expect(field.textContent).toBe('find my slp da @drive ');
    expect(container.querySelector('.task-input__command')).toBeNull();

    act(() => root.unmount());
  });

  it('Tab picks the first mention hint instead of inserting a literal tab', () => {
    const { container, root } = renderTaskInput();
    const field = getField(container);

    act(() => {
      typeInto(field, '@');
      placeCaretAtEnd(field);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.task-input__slash-item')).not.toBeNull();

    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });

    expect(field.querySelector('.mention-chip')?.getAttribute('data-mention')).toBe('drive');
    expect(field.textContent).toBe('@drive ');

    act(() => root.unmount());
  });
});
