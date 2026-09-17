// @vitest-environment jsdom

/**
 * jsdom does not implement contentEditable's actual editing engine (native
 * typing, IME, atomic-chip Backspace) — nothing can unit-test that; it needs
 * the real Chromium runtime the app ships on. What these tests DO cover, and
 * what is actually this component's own logic rather than the browser's: the
 * DOM surgery behind each imperative ref method, and the plain-text/caret
 * extraction that everything else in the 4 input surfaces depends on.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MentionTextField, type MentionTextFieldHandle } from '../../../src/renderer/hub/MentionTextField';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(onChange = vi.fn()): { container: HTMLDivElement; root: Root; ref: React.RefObject<MentionTextFieldHandle | null>; onChange: typeof onChange } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = React.createRef<MentionTextFieldHandle>();

  act(() => {
    root.render(<MentionTextField ref={ref} onChange={onChange} placeholder="Type here" />);
  });

  return { container, root, ref, onChange };
}

function getField(container: HTMLElement): HTMLDivElement {
  const el = container.querySelector('.mention-field');
  if (!(el instanceof HTMLDivElement)) throw new Error('Missing mention field');
  return el;
}

/** Places a collapsed caret inside `node` at `offset`, as if the user had just typed up to there. */
function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('MentionTextField', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the empty placeholder state on mount', () => {
    const { container } = render();
    const field = getField(container);
    expect(field.classList.contains('mention-field--empty')).toBe(true);
    expect(field.getAttribute('data-placeholder')).toBe('Type here');
  });

  it('setPlainText renders a known mention label as a chip and reports it back canonicalised', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    const field = getField(container);

    act(() => { ref.current!.setPlainText('find my slp da @drive as well as pc'); });

    const chip = field.querySelector('.mention-chip');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-mention')).toBe('drive');
    expect(chip!.textContent).toBe('@drive');
    expect(field.classList.contains('mention-field--empty')).toBe(false);

    const [text] = onChange.mock.calls.at(-1)!;
    expect(text).toBe('find my slp da @drive as well as pc');
  });

  it('clear empties the field and reports an empty value', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    act(() => { ref.current!.setPlainText('something @drive here'); });
    act(() => { ref.current!.clear(); });

    const field = getField(container);
    expect(field.childNodes.length).toBe(0);
    expect(field.classList.contains('mention-field--empty')).toBe(true);
    expect(onChange.mock.calls.at(-1)![0]).toBe('');
  });

  it('insertMentionChip replaces an in-progress "@partial" at the live caret with a chip, keeping surrounding text intact', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    const field = getField(container);

    act(() => { ref.current!.setPlainText('find my slp da @dri as well as pc'); });
    // setPlainText left no chip (no exact "@drive" match) — confirm the plain
    // text node is what we think before doing surgery on it.
    const textNode = Array.from(field.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && (n as Text).data.includes('@dri'),
    ) as Text;
    expect(textNode).toBeDefined();
    const caretOffset = textNode.data.indexOf('@dri') + '@dri'.length;

    act(() => {
      placeCaret(textNode, caretOffset);
      ref.current!.insertMentionChip({ name: 'drive', label: '@drive', summary: 'x' });
    });

    const chip = field.querySelector('.mention-chip');
    expect(chip?.getAttribute('data-mention')).toBe('drive');

    const [text] = onChange.mock.calls.at(-1)!;
    expect(text).toBe('find my slp da @drive  as well as pc');
  });

  it('insertMentionChip is a no-op when the live caret is not actually inside an @partial', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    const field = getField(container);
    act(() => { ref.current!.setPlainText('no mention here'); });
    const textNode = field.firstChild as Text;

    act(() => {
      placeCaret(textNode, textNode.data.length);
      onChange.mockClear();
      ref.current!.insertMentionChip({ name: 'drive', label: '@drive', summary: 'x' });
    });

    expect(field.querySelector('.mention-chip')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('insertPlainTextAtCaret inserts literal text, never a chip, even for a mention-looking string', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    const field = getField(container);
    act(() => { ref.current!.setPlainText('before  after'); });
    const textNode = field.firstChild as Text;

    act(() => {
      placeCaret(textNode, 'before '.length);
      ref.current!.insertPlainTextAtCaret('[Image #1]');
    });

    expect(field.querySelector('.mention-chip')).toBeNull();
    const [text] = onChange.mock.calls.at(-1)!;
    expect(text).toBe('before [Image #1] after');
  });

  it('Shift+Enter inserts a flat <br> and reports a newline, rather than the browser default of a wrapped div', () => {
    const onChange = vi.fn();
    const { container, ref } = render(onChange);
    const field = getField(container);
    act(() => { ref.current!.setPlainText('line one'); });
    const textNode = field.firstChild as Text;

    act(() => {
      placeCaret(textNode, textNode.data.length);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    });

    expect(field.querySelector('br')).not.toBeNull();
    const [text] = onChange.mock.calls.at(-1)!;
    expect(text).toBe('line one\n');
  });

  it('a plain Enter that the caller already handled (preventDefault) inserts nothing', () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const ref = React.createRef<MentionTextFieldHandle>();
    const onKeyDown = vi.fn((e: React.KeyboardEvent) => e.preventDefault());

    act(() => {
      root.render(<MentionTextField ref={ref} onChange={onChange} onKeyDown={onKeyDown} />);
    });
    const field = getField(container);
    act(() => { ref.current!.setPlainText('line one'); });
    const textNode = field.firstChild as Text;

    act(() => {
      placeCaret(textNode, textNode.data.length);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(onKeyDown).toHaveBeenCalled();
    expect(field.querySelector('br')).toBeNull();
    expect(field.textContent).toBe('line one');
  });
});
