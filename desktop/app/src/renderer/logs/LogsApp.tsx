import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalPane } from '../hub/TerminalPane';
import { FileRow, type FileOutputEntry } from './FileRow';
import { ChatTranscript, type SessionHistory } from './ChatTranscript';
import { AgentAvatar, Orb, Segmented } from '../components/lib';

type LogsView = 'chat' | 'raw';
const VIEW_KEY = 'dex:logs-view';

function readView(): LogsView {
  try { return window.localStorage.getItem(VIEW_KEY) === 'raw' ? 'raw' : 'chat'; } catch { return 'chat'; }
}

const ENGINE_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  browsercode: 'BrowserCode',
  opencode: 'OpenCode',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'Working',
  stuck: 'Stuck',
  idle: 'Waiting for you',
  paused: 'Paused',
  stopped: 'Finished',
  draft: 'Draft',
};
import { expandSlashCommand, matchingCommands, SLASH_COMMANDS, type SlashCommand } from '../hub/slashCommands';
import { matchingMentions, type MentionDef } from '../hub/mentions';
import { CommandChip, CommandHints, MentionHints } from '../hub/CommandChip';
import { MentionTextField, type MentionTextFieldHandle } from '../hub/MentionTextField';

declare global {
  interface Window {
    logsAPI: {
      close: () => void;
      setMode: (mode: 'dot' | 'normal' | 'full') => void;
      onModeChanged: (cb: (mode: 'dot' | 'normal' | 'full') => void) => () => void;
      onActiveSessionChanged: (cb: (id: string | null) => void) => () => void;
      onFocusFollowUp: (cb: () => void) => () => void;
      followUp: (sessionId: string, prompt: string) => Promise<{ resumed?: boolean; queued?: boolean; error?: string }>;
    };
  }
}

// Matches the RAW HlEvent shape emitted by the main process (see
// src/renderer/hub/types.ts). This is what session.output stores, BEFORE
// it's adapted into OutputEntry on the hub side.

interface DoneInfo {
  summary: string;
  iterations: number;
}

interface SessionShape {
  id: string;
  status?: string;
  engine?: string;
  prompt?: string;
  error?: string;
  output?: Array<{ type: string } & Partial<Record<string, unknown>>>;
}

export function LogsApp(): React.ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setModeState] = useState<'dot' | 'normal' | 'full'>('normal');
  const [files, setFiles] = useState<FileOutputEntry[]>([]);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionEngine, setSessionEngine] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [command, setCommand] = useState<SlashCommand | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<MentionTextFieldHandle>(null);
  // Caret position, tracked separately from `input` — an @mention can start
  // anywhere in the text, unlike a slash command which only ever opens it.
  const [caret, setCaret] = useState(0);
  const [history, setHistory] = useState<SessionHistory | null>(null);
  const [view, setViewState] = useState<LogsView>(readView);
  // The terminal is mounted lazily, the first time Raw is shown, then kept.
  const [rawOpened, setRawOpened] = useState(() => readView() === 'raw');
  useEffect(() => { if (view === 'raw') setRawOpened(true); }, [view]);
  const setView = useCallback((next: LogsView) => {
    setViewState(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* per-viewer convenience only */ }
  }, []);

  useEffect(() => {
    const unsub = window.logsAPI.onActiveSessionChanged((id) => {
      setSessionId(id);
    });
    return unsub;
  }, []);

  // Pressing 'f' on a hub card tells the logs window to focus its follow-up
  // input. rAF so the mode-change → re-render settles before focus(), else
  // the textarea may not be in the DOM yet when coming from dot mode.
  useEffect(() => {
    return window.logsAPI.onFocusFollowUp(() => {
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  }, []);

  useEffect(() => {
    const unsub = window.logsAPI.onModeChanged((m) => {
      setModeState(m);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.on.sessionUpdated?.((raw) => {
      const session = raw as SessionShape;
      if (!session || session.id !== sessionId) return;
      const out = session.output ?? [];
      const fileEntries: FileOutputEntry[] = out
        .filter((e) => (e as { type?: string }).type === 'file_output')
        .map((e) => {
          const f = e as unknown as { name: string; path: string; size: number; mime: string };
          return { type: 'file_output' as const, name: f.name, path: f.path, size: f.size, mime: f.mime };
        });
      setFiles(fileEntries);
      const doneEv = [...out].reverse().find((e) => (e as { type?: string }).type === 'done') as
        | { type: 'done'; summary?: string; iterations?: number }
        | undefined;
      setDone(doneEv ? { summary: String(doneEv.summary ?? 'Task completed'), iterations: Number(doneEv.iterations ?? 0) } : null);
      setErrorMsg(session.error ?? null);
      setSessionStatus(session.status ?? null);
      setSessionEngine(session.engine ?? null);
    });
    return unsub;
  }, [sessionId]);

  // SessionManager.appendOutput emits `session-output` but NOT `session-updated`,
  // so without this subscription file rows only appear after the next status
  // transition (or a session switch). Listen to the per-event stream and
  // append file_output events as they arrive; dedupe by path in case an event
  // is delivered twice.
  useEffect(() => {
    if (!sessionId) return;
    const unsub = window.electronAPI?.on.sessionOutput?.((id, event) => {
      if (id !== sessionId) return;
      if ((event as { type?: string }).type !== 'file_output') return;
      const ev = event as unknown as FileOutputEntry;
      setFiles((prev) => {
        if (prev.some((f) => f.path === ev.path)) return prev;
        return [...prev, { type: 'file_output', name: ev.name, path: ev.path, size: ev.size, mime: ev.mime }];
      });
    });
    return unsub;
  }, [sessionId]);

  // Reset + initial-fetch file list on session switch so:
  //  (a) stale rows from the previous session don't leak across, and
  //  (b) if the session already produced files BEFORE the logs window
  //      subscribed (or if session-updated isn't firing mid-stream), we
  //      still show what's there.
  useEffect(() => {
    setFiles([]);
    setDone(null);
    setErrorMsg(null);
    setSessionStatus(null);
    setSessionEngine(null);
    setHistory(null);
    if (!sessionId) return;
    let cancelled = false;
    void window.electronAPI?.sessions.get(sessionId).then((raw) => {
      if (cancelled) return;
      const session = raw as SessionShape | null;
      const out = session?.output ?? [];
      setHistory({ sessionId, prompt: session?.prompt, output: out });
      const fileEntries: FileOutputEntry[] = out
        .filter((e) => (e as { type?: string }).type === 'file_output')
        .map((e) => {
          const f = e as unknown as { name: string; path: string; size: number; mime: string };
          return { type: 'file_output' as const, name: f.name, path: f.path, size: f.size, mime: f.mime };
        });
      setFiles(fileEntries);
      const doneEv = [...out].reverse().find((e) => (e as { type?: string }).type === 'done') as
        | { type: 'done'; summary?: string; iterations?: number }
        | undefined;
      setDone(doneEv ? { summary: String(doneEv.summary ?? 'Task completed'), iterations: Number(doneEv.iterations ?? 0) } : null);
      setErrorMsg(session?.error ?? null);
      setSessionStatus(session?.status ?? null);
      setSessionEngine(session?.engine ?? null);
    }).catch((err) => console.error('[LogsApp] sessions.get failed', err));
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sessionIsRunning = sessionStatus === 'running' || sessionStatus === 'stuck';
      const sessionIsPaused = sessionStatus === 'paused';
      if (e.key.toLowerCase() === 'c' && e.ctrlKey && !e.metaKey && !e.altKey && sessionId && (sessionIsRunning || sessionIsPaused)) {
        e.preventDefault();
        const action = sessionIsPaused
          ? window.electronAPI?.sessions.cancel(sessionId)
          : window.electronAPI?.sessions.pause(sessionId);
        void action?.catch((err) => {
          console.error(`[LogsApp] ${sessionIsPaused ? 'cancel' : 'pause'} failed`, err);
        });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'dot') return;
        // Step down one size per Esc press: full → normal → dot. Jumping
        // full → dot in one keystroke skips the card view the user most
        // often wants when exiting a deep-dive read.
        window.logsAPI.setMode(mode === 'full' ? 'normal' : 'dot');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, sessionId, sessionStatus]);

  const onExpandFromDot = useCallback(() => { window.logsAPI.setMode('normal'); }, []);
  const preventButtonFocus = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);
  // Minus steps down one size: full → normal (card), normal → dot. Going
  // full → dot in one click skips the card view the user most often wants.
  const onMinimize = useCallback(() => {
    window.logsAPI.setMode(mode === 'full' ? 'normal' : 'dot');
  }, [mode]);
  const onToggleFull = useCallback(() => {
    window.logsAPI.setMode(mode === 'full' ? 'normal' : 'full');
  }, [mode]);

  const sendFollowUp = useCallback(async () => {
    if (!sessionId) return;
    const trimmed = input.trim();
    if ((!trimmed && !(command && !command.requiresArg)) || sending) return;
    // Same command rule as everywhere else: a committed chip expands through
    // its command, otherwise a leading slash is expanded here.
    const prompt = command ? command.expand(trimmed) : expandSlashCommand(trimmed).prompt;
    setSending(true);
    try {
      await window.logsAPI.followUp(sessionId, prompt);
      setInput('');
      setCommand(null);
      setCaret(0);
      inputRef.current?.clear();
    } catch (err) {
      console.error('[LogsApp] follow-up failed', err);
    } finally {
      setSending(false);
    }
  }, [sessionId, input, command, sending]);

  const slashHints = command ? [] : matchingCommands(input);
  const mentionHints = matchingMentions(input, caret);

  const commitCommand = useCallback((next: SlashCommand) => {
    setCommand(next);
    setInput('');
    inputRef.current?.clear();
    inputRef.current?.focus();
  }, []);

  const pickMention = useCallback((mention: MentionDef) => {
    inputRef.current?.insertMentionChip(mention);
  }, []);

  const handleInputChange = useCallback((next: string) => {
    if (!command) {
      const m = /^\/([a-zA-Z][\w-]*)[ \n]([\s\S]*)$/.exec(next);
      if (m) {
        const found = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
        if (found) { setCommand(found); setInput(m[2]); inputRef.current?.setPlainText(m[2]); return; }
      }
    }
    setInput(next);
  }, [command]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const caretAtStart = caret === 0;
      if (e.key === 'Backspace' && command && caretAtStart) {
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendFollowUp();
      }
    },
    [sendFollowUp, command, caret, slashHints, commitCommand, mentionHints, pickMention],
  );

  const hasFiles = files.length > 0;
  const cappedFiles = useMemo(() => files.slice(-5), [files]);

  if (mode === 'dot') {
    return (
      <button
        type="button"
        className="logs-dot"
        onClick={onExpandFromDot}
        onMouseDown={preventButtonFocus}
        tabIndex={-1}
        aria-label="Expand logs"
        title="Expand logs"
      >
        <span className="logs-dot__pulse" />
      </button>
    );
  }

  return (
    <div className={`logs-root${mode === 'full' ? ' logs-root--full' : ''}`}>
      <header className="logs-header">
        <div className="logs-header__who">
          {sessionId ? (
            <AgentAvatar engineId={sessionEngine} sessionId={sessionId} status={sessionStatus} size={22} />
          ) : (
            <Orb size={20} state="breathing" />
          )}
          <span className="logs-header__title">{sessionEngine ? ENGINE_LABEL[sessionEngine] ?? sessionEngine : 'Logs'}</span>
          {sessionStatus && (
            <span className={`logs-header__status logs-header__status--${sessionStatus}`}>
              {STATUS_LABEL[sessionStatus] ?? sessionStatus}
            </span>
          )}
        </div>
        <Segmented<LogsView>
          className="logs-header__view"
          size="sm"
          label="Logs view"
          value={view}
          onChange={setView}
          options={[
            { value: 'chat', label: 'Chat', hint: 'Conversation with tool cards' },
            { value: 'raw', label: 'Raw', hint: 'The full terminal stream' },
          ]}
        />
        <div className="logs-header__actions">
          <button
            type="button"
            className="logs-header__btn"
            onClick={onMinimize}
            onMouseDown={preventButtonFocus}
            tabIndex={-1}
            aria-label="Minimize to dot"
            title="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 7h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="logs-header__btn"
            onClick={onToggleFull}
            onMouseDown={preventButtonFocus}
            tabIndex={-1}
            aria-label={mode === 'full' ? 'Restore size' : 'Expand to full pane'}
            title={mode === 'full' ? 'Restore' : 'Expand'}
          >
            {mode === 'full' ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect x="2.5" y="2.5" width="5" height="5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="logs-header__btn"
            onClick={() => window.logsAPI.close()}
            onMouseDown={preventButtonFocus}
            tabIndex={-1}
            aria-label="Close"
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>
      {/* Both views stay mounted and the toggle only hides one: remounting
          the chat rebuilt it from a stale snapshot, which is what "erased" it
          on the way back from Raw. The terminal mounts the first time Raw is
          opened and then keeps its scrollback too. */}
      {sessionId ? (
        <>
          <div className="logs-view" hidden={view !== 'chat'}>
            <ChatTranscript key={sessionId} sessionId={sessionId} status={sessionStatus} engine={sessionEngine} history={history} />
          </div>
          {rawOpened && (
            <div className="logs-term" hidden={view !== 'raw'}>
              <TerminalPane
                key={sessionId}
                sessionId={sessionId}
                engine={sessionEngine}
                isActive={sessionStatus === 'running'}
              />
            </div>
          )}
        </>
      ) : (
        <div className="logs-term">
          <div className="logs-empty"><Orb size={32} state="breathing" /> Waiting for a session…</div>
        </div>
      )}
      {/* The chat shows produced files inline where they happened. */}
      {hasFiles && view === 'raw' && (
        <div className="logs-files" aria-label="Produced files">
          {cappedFiles.map((f, i) => <FileRow key={`${f.path}-${i}`} entry={f} />)}
        </div>
      )}
      {sessionStatus === 'stopped' ? (
        <div className="logs-followup logs-followup--ended" aria-live="polite">
          <span className="logs-followup__ended-label">Session ended</span>
        </div>
      ) : (
        <form
          className="logs-followup"
          onSubmit={(e) => { e.preventDefault(); void sendFollowUp(); }}
        >
          {command && <CommandChip command={command} onRemove={() => setCommand(null)} />}
          <CommandHints hints={slashHints} onPick={commitCommand} />
          <MentionHints hints={mentionHints} onPick={pickMention} />
          <div className="logs-followup__row">
            <span className="logs-followup__chevron">&rsaquo;</span>
            <MentionTextField
              ref={inputRef}
              className="logs-followup__input"
              // Cap at window-height minus the header so the field never
              // pushes the output area offscreen; beyond that it scrolls
              // internally. Recomputed on every render, which — since a
              // render already follows every keystroke — is at least as
              // responsive as the effect this replaced.
              maxHeightPx={Math.max(72, window.innerHeight - 80)}
              placeholder={command ? command.summary : (sessionId && (sessionStatus === 'running' || sessionStatus === 'stuck') ? 'Queue follow-up…' : sessionId ? 'Follow up…' : 'No session')}
              onChange={(next, nextCaret) => { handleInputChange(next); setCaret(nextCaret); }}
              onKeyDown={onInputKeyDown}
              disabled={!sessionId || sending}
              ariaLabel="Follow up"
            />
            <button
              type="submit"
              className="logs-followup__send"
              disabled={!sessionId || sending || (!input.trim() && !(command && !command.requiresArg))}
              aria-label="Send follow-up"
              onMouseDown={preventButtonFocus}
            >
              {sending ? (
                <Orb size={20} state="working" />
              ) : (
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
                </svg>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default LogsApp;
