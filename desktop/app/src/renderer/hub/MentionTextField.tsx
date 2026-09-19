/**
 * A plain-text input that can render `@mention` picks as real inline chips —
 * a colored, bold, non-editable pill sitting mid-sentence — which a native
 * `<textarea>` cannot do at all (it has no concept of inline styled nodes).
 * This is the one contentEditable surface in the app; everywhere else stays
 * on plain form controls deliberately, because contentEditable in React is
 * only tractable if you resist the urge to make it fully "controlled".
 *
 * The design that makes this safe: the DOM is the source of truth while the
 * user is actively typing. A native `input` event is read back into a plain
 * string (chips canonicalise to their `@name` text) and reported through
 * `onChange` — nothing here writes back into the DOM in response to that
 * report. The only DOM writes are the imperative ones a caller asks for
 * explicitly through the ref: clearing the field, replacing all of it,
 * inserting plain text at the caret (image-attachment tokens), or turning an
 * in-progress `@partial` into a chip. Every ordinary keystroke, IME
 * composition, and native "delete this atomic chip in one Backspace" is left
 * entirely to the browser's own contentEditable engine, which is what a
 * hand-rolled reimplementation would get wrong first.
 *
 * Caret tracking uses `document.addEventListener('selectionchange', ...)`
 * rather than per-element key/click handlers — it is the one event that
 * fires for every way a caret can move (typing, arrows, a mouse click), so
 * callers get one `onChange(value, caret)` stream instead of stitching
 * several event types together themselves.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { MENTIONS, type MentionDef } from './mentions';

export interface MentionTextFieldHandle {
  focus(): void;
  /** Empty the field. */
  clear(): void;
  /** Replace the whole field with plain text, re-detecting known mention labels as chips. */
  setPlainText(text: string): void;
  /** Insert plain text at the live caret — always literal text, never a chip. */
  insertPlainTextAtCaret(text: string): void;
  /**
   * Turn the in-progress `@partial` ending at the live caret into a rendered
   * chip for `mention`. A no-op if the live selection isn't a collapsed
   * caret inside a text node ending in `@partial` — callers only invoke this
   * right after `matchingMentions` confirmed that shape, so this is a
   * defensive guard, not the primary correctness check.
   */
  insertMentionChip(mention: MentionDef): void;
}

export interface MentionTextFieldProps {
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Grows with content up to this height, then scrolls internally. */
  maxHeightPx?: number;
  /**
   * Reports the pixel height the field just resized itself to. Only Pill.tsx
   * needs this today — its overlay is a real OS window whose size must track
   * the field's own auto-grow, something an owning component cannot read off
   * a plain HTMLElement ref because a mention pick can change content height
   * without a key event to hang a recalculation off of.
   */
  onHeightChange?: (heightPx: number) => void;
  onChange: (value: string, caret: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const MENTION_ATTR = 'data-mention';

function isChipElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute(MENTION_ATTR);
}

/** Walks `root`'s (flat, single-level) children into the plain-text value and the caret offset within it. */
function extractPlainTextAndCaret(root: HTMLElement): { text: string; caret: number } {
  let text = '';
  let caret: number | null = null;
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const hasLiveSelection = !!sel && sel.rangeCount > 0 && root.contains(sel.anchorNode);

  let index = 0;
  for (const child of Array.from(root.childNodes)) {
    if (hasLiveSelection && sel!.anchorNode === root && sel!.anchorOffset === index) {
      caret = text.length;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      if (hasLiveSelection && sel!.anchorNode === child) {
        caret = text.length + sel!.anchorOffset;
      }
      text += (child as Text).data;
    } else if (child.nodeName === 'BR') {
      text += '\n';
    } else if (isChipElement(child)) {
      text += `@${child.getAttribute(MENTION_ATTR)}`;
    }
    index += 1;
  }
  if (hasLiveSelection && sel!.anchorNode === root && sel!.anchorOffset === root.childNodes.length) {
    caret = text.length;
  }
  return { text, caret: caret ?? text.length };
}

/** True when the field has nothing a person would consider content — including the stray `<br>` Chromium can leave behind. */
function isEffectivelyEmpty(root: HTMLElement): boolean {
  if (root.childNodes.length === 0) return true;
  return root.childNodes.length === 1 && root.firstChild!.nodeName === 'BR';
}

function createChipElement(mention: MentionDef): HTMLElement {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.className = 'mention-chip';
  span.setAttribute(MENTION_ATTR, mention.name);
  span.textContent = mention.label;
  return span;
}

/** Rebuilds `root`'s children from plain text, wrapping any known mention label as a chip. */
function renderPlainTextInto(root: HTMLElement, text: string): void {
  while (root.firstChild) root.removeChild(root.firstChild);

  const labelPattern = new RegExp(`(^|\\s)(${MENTIONS.map((m) => m.label.replace('@', '@')).join('|')})(?=\\s|$)`, 'g');
  const lines = text.split('\n');
  lines.forEach((line, lineIndex) => {
    let lastEnd = 0;
    labelPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = labelPattern.exec(line))) {
      const label = match[2];
      const mention = MENTIONS.find((m) => m.label === label);
      const matchStart = match.index + match[1].length;
      if (matchStart > lastEnd) root.appendChild(document.createTextNode(line.slice(lastEnd, matchStart)));
      if (mention) root.appendChild(createChipElement(mention));
      else root.appendChild(document.createTextNode(label));
      lastEnd = matchStart + label.length;
    }
    if (lastEnd < line.length) root.appendChild(document.createTextNode(line.slice(lastEnd)));
    if (lineIndex < lines.length - 1) root.appendChild(document.createElement('br'));
  });
}

function placeCaretAtEnd(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export const MentionTextField = forwardRef<MentionTextFieldHandle, MentionTextFieldProps>(function MentionTextField(
  { className, placeholder, disabled, ariaLabel, maxHeightPx, onHeightChange, onChange, onKeyDown, onPaste, onFocus, onBlur },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);

  const report = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    setEmpty(isEffectivelyEmpty(root));
    const { text, caret } = extractPlainTextAndCaret(root);
    onChange(text, caret);
  }, [onChange]);

  // The one listener that catches every way the caret can move — typing,
  // arrow keys, a mouse click — without each caller wiring up its own
  // key/click handlers just to keep a caret offset in sync.
  useEffect(() => {
    const onSelectionChange = (): void => {
      const root = rootRef.current;
      if (!root || document.activeElement !== root) return;
      report();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [report]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || maxHeightPx == null) return;
    root.style.height = 'auto';
    const next = Math.min(root.scrollHeight, maxHeightPx);
    root.style.height = `${next}px`;
    onHeightChange?.(next);
  });

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    clear: () => {
      const root = rootRef.current;
      if (!root) return;
      while (root.firstChild) root.removeChild(root.firstChild);
      report();
    },
    setPlainText: (text: string) => {
      const root = rootRef.current;
      if (!root) return;
      renderPlainTextInto(root, text);
      if (document.activeElement === root) placeCaretAtEnd(root);
      report();
    },
    insertPlainTextAtCaret: (text: string) => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel) return;
      // Read the live selection before touching focus — focusing an element
      // can itself move the caret, which would insert at the wrong spot.
      let range: Range;
      if (sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      root.focus();
      report();
    },
    insertMentionChip: (mention: MentionDef) => {
      const sel = window.getSelection();
      const root = rootRef.current;
      if (!sel || !root || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return;
      const textNode = range.startContainer as Text;
      if (!root.contains(textNode)) return;

      const offset = range.startOffset;
      const before = textNode.data.slice(0, offset);
      const match = /(?:^|\s)@[a-zA-Z]*$/.exec(before);
      if (!match) return;

      const atIndex = before.lastIndexOf('@');
      const keepAfter = textNode.data.slice(offset);
      textNode.data = textNode.data.slice(0, atIndex);

      const chip = createChipElement(mention);
      const spaceNode = document.createTextNode(' ');
      const parent = textNode.parentNode;
      if (!parent) return;
      const refNode = textNode.nextSibling;
      parent.insertBefore(chip, refNode);
      parent.insertBefore(spaceNode, refNode);
      if (keepAfter) parent.insertBefore(document.createTextNode(keepAfter), refNode);

      const newRange = document.createRange();
      newRange.setStart(spaceNode, spaceNode.data.length);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      report();
    },
  }), [report]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    // Left entirely to the caller otherwise — but Enter's native
    // contentEditable behaviour (wrapping a new line in its own <div>) would
    // break the flat text/br/chip structure everything else here assumes,
    // so it is always intercepted, win or lose: a caller that wanted plain
    // Enter to submit already called preventDefault above; what's left here
    // is Shift+Enter, handled as an explicit, flat <br> insertion.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        const root = rootRef.current;
        const sel = window.getSelection();
        if (root && sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          range.setStartAfter(br);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          report();
        }
      }
    }
  }, [onKeyDown, report]);

  return (
    <div
      ref={rootRef}
      className={`mention-field${empty ? ' mention-field--empty' : ''}${className ? ` ${className}` : ''}`}
      data-placeholder={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      style={maxHeightPx != null ? { maxHeight: maxHeightPx, overflowY: 'auto' } : undefined}
      onInput={report}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
});

export default MentionTextField;
