/**
 * The chat's composer, in Codex's shape: one rounded box, the text on top,
 * and a row under it with + (attach), the engine, and a round send button —
 * which turns into Pause while DEX works and the box is empty.
 *
 * The behaviour is the pane's old follow-up input, unchanged: slash commands
 * become a chip, @mentions insert chips, pasted or dropped files attach as
 * `[Image #N]` tokens (delete the token to drop the file), Enter sends and
 * Shift+Enter breaks the line. A message sent while DEX is working is queued.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expandSlashCommand, matchingCommands, SLASH_COMMANDS, type SlashCommand } from '../slashCommands';
import { matchingMentions, type MentionDef } from '../mentions';
import { CommandChip, CommandHints, MentionHints } from '../CommandChip';
import { MentionTextField, type MentionTextFieldHandle } from '../MentionTextField';

const MAX_HEIGHT_PX = 200;

export interface ComposerAttachment { idx: number; name: string; mime: string; bytes: Uint8Array }

async function fileToAttachment(file: File, idx: number): Promise<ComposerAttachment> {
  const buf = await file.arrayBuffer();
  return {
    idx,
    name: file.name || `image-${idx}`,
    mime: file.type || 'application/octet-stream',
    bytes: new Uint8Array(buf),
  };
}

interface ComposerProps {
  sessionId: string;
  onSend: (text: string, attachments?: ComposerAttachment[]) => void;
  /** DEX is working: an empty box offers Pause instead of Send. */
  working?: boolean;
  onPause?: () => void;
  /** "Claude Code · opus", shown on the right. */
  engineLabel?: string;
  autoFocus?: boolean;
  /** Bumped to put the cursor here. */
  focusSignal?: number;
}

export function Composer({ sessionId, onSend, working, onPause, engineLabel, autoFocus, focusSignal }: ComposerProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [command, setCommand] = useState<SlashCommand | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const idxCounter = useRef(0);
  const fieldRef = useRef<MentionTextFieldHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Caret position, tracked separately from `value` — an @mention can start
  // anywhere in the text, unlike a slash command which only ever opens it.
  const [caret, setCaret] = useState(0);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus, sessionId]);
  useEffect(() => {
    if (focusSignal) fieldRef.current?.focus();
  }, [focusSignal]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    // Only attachments whose `[Image #N]` token is still in the text.
    const presentIdx = new Set<number>();
    const tokenRe = /\[Image #(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(trimmed)) !== null) presentIdx.add(Number(m[1]));
    const filtered = attachments.filter((a) => presentIdx.has(a.idx));
    if (!trimmed && filtered.length === 0 && !(command && !command.requiresArg)) return;
    // A committed chip expands through its command; otherwise a leading slash
    // is expanded here — the same rule as the dashboard and the overlay.
    const prompt = command ? command.expand(trimmed) : expandSlashCommand(trimmed).prompt;
    onSend(prompt, filtered.length > 0 ? filtered : undefined);
    setValue('');
    setCommand(null);
    setAttachments([]);
    setCaret(0);
    fieldRef.current?.clear();
    idxCounter.current = 0;
  }, [value, command, onSend, attachments]);

  const slashHints = useMemo(() => (command ? [] : matchingCommands(value)), [command, value]);
  const mentionHints = useMemo(() => matchingMentions(value, caret), [value, caret]);

  const commitCommand = useCallback((next: SlashCommand) => {
    setCommand(next);
    setValue('');
    fieldRef.current?.clear();
    fieldRef.current?.focus();
  }, []);

  const pickMention = useCallback((mention: MentionDef) => {
    fieldRef.current?.insertMentionChip(mention);
  }, []);

  const handleChange = useCallback((next: string) => {
    if (!command) {
      const found = /^\/([a-zA-Z][\w-]*)[ \n]([\s\S]*)$/.exec(next);
      if (found) {
        const cmd = SLASH_COMMANDS.find((c) => c.name === found[1].toLowerCase());
        if (cmd) { setCommand(cmd); setValue(found[2]); fieldRef.current?.setPlainText(found[2]); return; }
      }
    }
    setValue(next);
  }, [command]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && command && caret === 0) {
      e.preventDefault();
      setCommand(null);
      return;
    }
    if (!command && slashHints.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      commitCommand(slashHints[0]);
      return;
    }
    if (mentionHints.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      pickMention(mentionHints[0]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, command, caret, slashHints, commitCommand, mentionHints, pickMention]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    const startIdx = idxCounter.current + 1;
    idxCounter.current += list.length;
    try {
      const next = await Promise.all(list.map((f, i) => fileToAttachment(f, startIdx + i)));
      setAttachments((prev) => [...prev, ...next]);
      const tokens = next.map((a) => `[Image #${a.idx}]`).join(' ');
      if (fieldRef.current) {
        const before = value.slice(0, caret);
        const after = value.slice(caret);
        const sep = before && !before.endsWith(' ') ? ' ' : '';
        fieldRef.current.insertPlainTextAtCaret(sep + tokens + (after && !after.startsWith(' ') ? ' ' : ''));
      } else {
        setValue((prev) => (prev ? `${prev} ` : '') + tokens);
      }
    } catch (err) {
      console.error('[Composer] attach failed', err);
    }
  }, [value, caret]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  }, [addFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer?.files ?? null);
  }, [addFiles]);

  const hasText = value.trim().length > 0 || attachments.length > 0 || Boolean(command && !command.requiresArg);
  const showPause = Boolean(working && onPause && !hasText);

  return (
    <div
      className={`cx-composer${dragOver ? ' cx-composer--drop' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={(e) => { if (e.target === e.currentTarget) fieldRef.current?.focus(); }}
    >
      <CommandHints hints={slashHints} onPick={commitCommand} />
      <MentionHints hints={mentionHints} onPick={pickMention} />
      {command && <div className="cx-composer__chip"><CommandChip command={command} onRemove={() => setCommand(null)} /></div>}
      <MentionTextField
        ref={fieldRef}
        className="cx-composer__field"
        maxHeightPx={MAX_HEIGHT_PX}
        onChange={(next, nextCaret) => { handleChange(next); setCaret(nextCaret); }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={command ? command.summary : working ? 'Tell DEX something while it works…' : 'Ask DEX to do more…'}
        ariaLabel="Message DEX"
      />
      <div className="cx-composer__bar">
        <button
          type="button"
          className="cx-composer__icon"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          title="Attach files"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
        />
        <span className="cx-composer__grow" />
        {engineLabel && <span className="cx-composer__engine">{engineLabel}</span>}
        {showPause ? (
          <button type="button" className="cx-composer__send cx-composer__send--stop" onClick={onPause} aria-label="Pause" title="Pause (Ctrl+C)">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.8" fill="currentColor" /></svg>
          </button>
        ) : (
          <button type="button" className="cx-composer__send" onClick={handleSubmit} disabled={!hasText} aria-label="Send" title="Send (Enter)">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 13V3m0 0L3.8 7.2M8 3l4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
