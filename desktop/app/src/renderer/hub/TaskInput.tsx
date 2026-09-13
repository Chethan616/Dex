import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { INPUT_PLACEHOLDER } from './constants';
import { EnginePicker } from './EnginePicker';
import { DEFAULT_MODEL_ID, ModelPicker } from './ModelPicker';
import { expandSlashCommand, matchingCommands, SLASH_COMMANDS, type SlashCommand } from './slashCommands';

// A small glyph per command, shown in the committed chip. Lives here rather
// than in slashCommands.ts so that module stays plain, testable logic with no
// JSX.
function CommandIcon({ name }: { name: string }): React.ReactElement {
  if (name === 'scrape') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14C6.2 12.4 5.2 10.2 5.2 8S6.2 3.6 8 2z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (name === 'bugbounty') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.5l5 2v4c0 3-2.1 5.3-5 7-2.9-1.7-5-4-5-7v-4l5-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.6 8.2l1.7 1.7 3.1-3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l4 4-4 4M9 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "scrape" -> "Scrape". */
function commandLabel(command: SlashCommand): string {
  return command.name.charAt(0).toUpperCase() + command.name.slice(1);
}
import {
  classifyAttachmentMime,
  maxBytesForAttachmentMime,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatBytes,
} from '../../shared/attachments';

export interface TaskInputAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface TaskInputSubmission {
  prompt: string;
  attachments: TaskInputAttachment[];
  engine: string;
  /** '' means "use the engine's own default" — no model flag is sent. */
  model: string;
}

interface TaskInputProps {
  onSubmit: (input: TaskInputSubmission) => void;
}

const ENGINE_STORAGE_KEY = 'hub.selectedEngine';
const DEFAULT_ENGINE = 'claude-code';
// Keyed per engine: "Opus" means nothing to Codex, so switching engines must
// not carry a model id across to one that cannot honour it.
const MODEL_STORAGE_PREFIX = 'hub.selectedModel.';

function loadStoredEngine(): string {
  try {
    const v = localStorage.getItem(ENGINE_STORAGE_KEY);
    return v && v.length > 0 ? v : DEFAULT_ENGINE;
  } catch {
    return DEFAULT_ENGINE;
  }
}

function loadStoredModel(engineId: string): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_PREFIX + engineId) ?? DEFAULT_MODEL_ID;
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

export interface TaskInputHandle {
  addFiles: (files: FileList | File[]) => Promise<void>;
  focus: () => void;
}

function ArrowUpIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 12V3M3 6.5L7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 3.5L4.5 8.5a2 2 0 1 0 2.83 2.83L11.5 7.5a3 3 0 0 0-4.24-4.24L2.5 8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export const TaskInput = forwardRef<TaskInputHandle, TaskInputProps>(function TaskInput({ onSubmit }, ref) {
  const [value, setValue] = useState('');
  // The command committed into a chip. When set, the textarea holds only its
  // argument, and the chip renders the command's icon and name.
  const [command, setCommand] = useState<SlashCommand | null>(null);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<TaskInputAttachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [engine, setEngine] = useState<string>(() => loadStoredEngine());
  const [model, setModel] = useState<string>(() => loadStoredModel(loadStoredEngine()));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const maxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const nextHeight = Number.isFinite(maxHeight) && maxHeight > 0
      ? Math.min(textarea.scrollHeight, maxHeight)
      : textarea.scrollHeight;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setErrorMsg(null);
    const list = Array.from(files);
    const next = [...attachments];
    let total = next.reduce((s, a) => s + a.bytes.byteLength, 0);
    for (const f of list) {
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setErrorMsg(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        break;
      }
      const mime = f.type || 'application/octet-stream';
      const kind = classifyAttachmentMime(mime);
      const max = maxBytesForAttachmentMime(mime);
      if (f.size > max) {
        setErrorMsg(`${f.name} is ${formatBytes(f.size)} — exceeds ${formatBytes(max)} ${kind} limit`);
        continue;
      }
      if (f.size === 0) {
        setErrorMsg(`${f.name} is empty`);
        continue;
      }
      if (total + f.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        setErrorMsg(`Total size would exceed ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}`);
        break;
      }
      const bytes = await readFileBytes(f);
      next.push({ name: f.name, mime, bytes });
      total += f.size;
      console.log('[TaskInput] attach', { name: f.name, mime, size: f.size });
    }
    setAttachments(next);
  }, [attachments]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Command suggestions while the user is still typing the command word — and
  // only before one has been committed to a chip.
  const slashHints = command ? [] : matchingCommands(value);

  const handleChange = useCallback((next: string) => {
    // Promote a completed command word into a chip: `/scrape ` (or a newline
    // after it) becomes the Scrape chip, and the field keeps only what follows.
    if (!command) {
      const m = /^\/([a-zA-Z][\w-]*)[ \n]([\s\S]*)$/.exec(next);
      if (m) {
        const found = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
        if (found) {
          setCommand(found);
          setValue(m[2]);
          return;
        }
      }
    }
    setValue(next);
  }, [command]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;

    // A committed chip expands through its own command; otherwise a leading
    // slash is expanded here, before anything leaves the renderer. Either way
    // a command missing its required argument stops rather than sending a
    // half-formed instruction.
    let prompt: string;
    let commandName: string | undefined;
    if (command) {
      if (command.requiresArg && trimmed.length === 0) {
        setErrorMsg(command.usage + ' — needs a target.');
        return;
      }
      prompt = command.expand(trimmed);
      commandName = command.name;
    } else {
      const expanded = expandSlashCommand(trimmed);
      if (expanded.error) {
        setErrorMsg(expanded.error);
        return;
      }
      prompt = expanded.prompt;
      commandName = expanded.command?.name;
    }
    console.log('[TaskInput] submit', {
      promptLength: prompt.length,
      command: commandName,
      attachmentCount: attachments.length,
    });
    onSubmit({ prompt, attachments, engine, model });
    setValue('');
    setCommand(null);
    setAttachments([]);
    setErrorMsg(null);
    textareaRef.current?.focus();
  }, [value, command, attachments, engine, model, onSubmit]);

  const onEngineChange = useCallback((id: string) => {
    setEngine(id);
    // Restore whatever model was last chosen *for that engine*, rather than
    // keeping the outgoing engine's pick.
    setModel(loadStoredModel(id));
    try { localStorage.setItem(ENGINE_STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  const onModelChange = useCallback((id: string) => {
    setModel(id);
    try { localStorage.setItem(MODEL_STORAGE_PREFIX + engine, id); } catch { /* ignore */ }
  }, [engine]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const caretAtStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
      if (e.key === 'Backspace' && command && caretAtStart) {
        // Restore the raw command text so it can be edited or removed, rather
        // than deleting into the argument from nowhere.
        e.preventDefault();
        setValue(`/${command.name} ${value}`);
        setCommand(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        textareaRef.current?.blur();
      }
    },
    [submit],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => setDragActive(false), []);

  const canSubmit = value.trim().length > 0 || attachments.length > 0 || (command != null && !command.requiresArg);

  useImperativeHandle(ref, () => ({
    addFiles: (files) => addFiles(files),
    focus: () => textareaRef.current?.focus(),
  }), [addFiles]);

  const focusTextareaOnBoxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      textareaRef.current?.focus();
    }
  }, []);

  return (
    <div className="task-input">
      <div
        className={`task-input__box${focused ? ' task-input__box--focused' : ''}${dragActive ? ' task-input__box--drag' : ''}`}
        onClick={focusTextareaOnBoxClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {attachments.length > 0 && (
          <div className="task-input__chips">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="task-input__chip" title={`${a.mime} · ${formatBytes(a.bytes.byteLength)}`}>
                <span className="task-input__chip-name">{a.name}</span>
                <span className="task-input__chip-size">{formatBytes(a.bytes.byteLength)}</span>
                <button
                  type="button"
                  className="task-input__chip-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
          </div>
        )}
        {errorMsg && <div className="task-input__error">{errorMsg}</div>}
        {command && (
          <div className="task-input__command">
            <span className="task-input__command-chip">
              <CommandIcon name={command.name} />
              <span className="task-input__command-name">{commandLabel(command)}</span>
              <button
                type="button"
                className="task-input__command-remove"
                aria-label={`Remove ${commandLabel(command)} command`}
                onMouseDown={(e) => {
                  // mousedown, not click: keep focus in the textarea.
                  e.preventDefault();
                  setValue(`/${command.name} ${value}`.trimEnd() + (value ? '' : ' '));
                  setCommand(null);
                  textareaRef.current?.focus();
                }}
              >
                <CloseIcon />
              </button>
            </span>
          </div>
        )}
        {slashHints.length > 0 && (
          <div className="task-input__slash">
            {slashHints.map((command) => (
              <button
                type="button"
                key={command.name}
                className="task-input__slash-item"
                onMouseDown={(e) => { e.preventDefault(); setValue(`/${command.name} `); textareaRef.current?.focus(); }}
              >
                <span className="task-input__slash-usage">{command.usage}</span>
                <span className="task-input__slash-summary">{command.summary}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="task-input__textarea"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={command ? `${command.summary}` : INPUT_PLACEHOLDER}
          rows={1}
          aria-label="New agent task"
        />
        <div className="task-input__actions" onClick={focusTextareaOnBoxClick}>
          <button
            type="button"
            className="task-input__attach has-tooltip"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            data-tooltip="Attach files"
          >
            <PaperclipIcon />
          </button>
          <EnginePicker value={engine} onChange={onEngineChange} />
          <ModelPicker engineId={engine} value={model} onChange={onModelChange} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            className="task-input__send"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Start agent"
            title="Start agent (Enter)"
          >
            <ArrowUpIcon />
          </button>
        </div>
      </div>
    </div>
  );
});

export default TaskInput;
