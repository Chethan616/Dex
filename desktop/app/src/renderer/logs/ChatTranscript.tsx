/**
 * ChatTranscript — the logs window as a chat (Claude / ChatGPT / Gemini
 * layout) built from the session's structured events rather than its
 * terminal rendering.
 *
 *  - The user's prompt and follow-ups are right-aligned bubbles.
 *  - The agent's prose is plain, full-width markdown — no bubble.
 *  - Every tool call is a card: what it did in words, the one-line argument
 *    summary, duration and outcome; expand for the full arguments and result.
 *    Nothing the terminal showed is lost, and the Raw view is one toggle away.
 *  - A call that's still running shows a thinking orb whose motion says what
 *    kind of work it is (searching, browsing, MCP, reading, editing, running,
 *    desktop…). Finished calls drop to a static glyph, so a long session is a
 *    page of cheap SVGs, not hundreds of animating canvases.
 *
 * Streaming: engines emit prose token by token. Incoming events are buffered
 * and folded in once per animation frame, and the reducer shares every
 * untouched block, so only the block being written re-renders.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '../hub/Markdown';
import { AgentAvatar, CopyButton, Orb, type OrbState } from '../components/lib';
import { FileRow } from './FileRow';
import {
  appendEvent,
  buildTranscript,
  EMPTY_TRANSCRIPT,
  type Block,
  type ToolKind,
  type Transcript,
  type Usage,
} from './transcript';

type RawEvent = { type?: string } & Record<string, unknown>;

const ENGINE_NAME: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  browsercode: 'BrowserCode',
  opencode: 'OpenCode',
};

function formatMs(ms: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ── Glyphs for finished tool calls, one per kind ─────────────────────── */

const KIND_PATH: Record<ToolKind, string> = {
  search: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.5 10.5L14 14',
  browse: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM1.8 8h12.4M8 1.8c1.7 1.9 2.5 4 2.5 6.2s-.8 4.3-2.5 6.2M8 1.8C6.3 3.7 5.5 5.8 5.5 8s.8 4.3 2.5 6.2',
  mcp: 'M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5',
  read: 'M3.5 1.8h6l3 3v9.4h-9zM9.5 1.8v3h3M5.5 8h5M5.5 10.5h5',
  write: 'M10.8 2.2l3 3L6 13H3v-3zM9.3 3.7l3 3',
  run: 'M2 3h12v10H2zM4.5 6.5L6.5 8l-2 1.5M8 10h3.5',
  desktop: 'M1.8 2.8h12.4v8H1.8zM6 13.5h4M8 10.8v2.7',
  agent: 'M8 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4',
  other: 'M8 2l1.6 3.9L13.5 6l-3 2.7.9 4.1L8 10.7l-3.4 2.1.9-4.1-3-2.7 3.9-.1z',
};

function KindGlyph({ kind }: { kind: ToolKind }): React.ReactElement {
  return (
    <svg className="chat-tool__glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={KIND_PATH[kind]} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg className={`chat-chevron${open ? ' chat-chevron--open' : ''}`} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function prettyArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    const { preview: _preview, ...rest } = args as Record<string, unknown>;
    const obj = Object.keys(rest).length > 0 ? rest : args;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(args);
  }
}

/* ── Blocks ───────────────────────────────────────────────────────────── */

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  return (
    <div className="chat-row chat-row--user">
      <div className="chat-user">{text}</div>
    </div>
  );
});

const AssistantText = memo(function AssistantText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className={`chat-text${streaming ? ' chat-text--streaming' : ''}`}>
      <Markdown source={text} variant="compact" />
      {/* Actions sit under the reply (never over it), shown on hover. */}
      {!streaming && (
        <div className="chat-actions">
          <CopyButton text={text} />
        </div>
      )}
    </div>
  );
});

const ToolCard = memo(function ToolCard({ block, running }: {
  block: Extract<Block, { kind: 'tool' }>;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { meta, result } = block;
  const verb = running ? meta.active : meta.done;
  const target = meta.display ?? block.summary;
  const failed = result ? !result.ok : false;
  return (
    <div className={`chat-tool chat-tool--${meta.kind}${failed ? ' chat-tool--failed' : ''}${running ? ' chat-tool--running' : ''}`}>
      <button type="button" className="chat-tool__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="chat-tool__icon">
          {running ? <Orb size={20} state={meta.orb} /> : <KindGlyph kind={meta.kind} />}
        </span>
        <span className="chat-tool__verb">{verb}</span>
        {target && <span className="chat-tool__target" title={target}>{target}</span>}
        <span className="chat-tool__meta">
          {result?.ms ? <span className="chat-tool__ms">{formatMs(result.ms)}</span> : null}
          {failed && <span className="chat-tool__fail">Failed</span>}
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <div className="chat-tool__body">
          <div className="chat-tool__section">
            <div className="chat-tool__label">
              <span>{block.name}</span>
              {block.iteration > 0 && <span className="chat-tool__iter">step {block.iteration}</span>}
              <CopyButton text={prettyArgs(block.args)} label="Copy arguments" />
            </div>
            <pre className="chat-code">{prettyArgs(block.args) || '—'}</pre>
          </div>
          <div className="chat-tool__section">
            <div className="chat-tool__label">
              <span>{result ? (result.ok ? 'Result' : 'Error') : 'Waiting for result…'}</span>
              {result?.preview && <CopyButton text={result.preview} label="Copy result" />}
            </div>
            {result && <pre className={`chat-code${result.ok ? '' : ' chat-code--error'}`}>{result.preview || '(no output)'}</pre>}
          </div>
        </div>
      )}
    </div>
  );
});

const DoneCard = memo(function DoneCard({ block, usage }: { block: Extract<Block, { kind: 'done' }>; usage: Usage }) {
  return (
    <div className="chat-done">
      <div className="chat-done__head">
        <span className="chat-done__check" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="chat-done__title">Done</span>
        <span className="chat-done__stats">
          {block.iterations > 0 && <span>{block.iterations} steps</span>}
          {usage.turns > 0 && <span>{formatTokens(usage.inputTokens + usage.outputTokens)} tokens</span>}
          {usage.costUsd > 0 && <span>${usage.costUsd.toFixed(usage.costUsd < 0.1 ? 3 : 2)}</span>}
        </span>
      </div>
      {!block.echo && <div className="chat-done__body"><Markdown source={block.summary} variant="compact" /></div>}
      <div className="chat-actions chat-actions--done">
        <CopyButton text={block.summary} />
      </div>
    </div>
  );
});

const NOTICE_ICON: Record<string, string> = {
  info: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 7.2v4M8 5h.01',
  blocking: 'M8 2l6.3 11H1.7zM8 6.5v3M8 11.5h.01',
  skill: 'M8 1.8l1.7 3.6 3.9.5-2.9 2.7.7 3.9L8 10.6l-3.4 1.9.7-3.9-2.9-2.7 3.9-.5z',
  harness: 'M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 01-7 0zM8 11.5v2',
  confirm: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z',
};

const Notice = memo(function Notice({ block }: { block: Extract<Block, { kind: 'notice' }> }) {
  return (
    <div className={`chat-notice chat-notice--${block.level}`} title={block.detail}>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d={NOTICE_ICON[block.level]} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="chat-notice__title">{block.title}</span>
      {block.detail && <span className="chat-notice__detail">{block.detail}</span>}
    </div>
  );
});

function BlockView({ block, running, usage }: { block: Block; running: boolean; usage: Usage }): React.ReactElement | null {
  switch (block.kind) {
    case 'user':
      return <UserBubble text={block.text} />;
    case 'text':
      return <AssistantText text={block.text} streaming={running} />;
    case 'tool':
      return <ToolCard block={block} running={running} />;
    case 'done':
      return <DoneCard block={block} usage={usage} />;
    case 'error':
      return (
        <div className="chat-error" role="alert">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2l6.3 11H1.7zM8 6.5v3M8 11.5h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{block.message}</span>
        </div>
      );
    case 'notice':
      return <Notice block={block} />;
    case 'file':
      return (
        <div className="chat-file">
          <FileRow entry={{ type: 'file_output', name: block.name, path: block.path, size: block.size, mime: block.mime }} />
        </div>
      );
    case 'image':
      return (
        <figure className="chat-image">
          <img src={`file://${block.path}`} alt={block.caption ?? 'Screenshot'} loading="lazy" onClick={() => { void window.electronAPI?.sessions?.revealOutput?.(block.path); }} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case 'canvas':
      return (
        <div className="chat-card">
          <div className="chat-card__title">{block.title}</div>
          <Markdown source={block.markdown} variant="compact" />
        </div>
      );
    case 'artifact':
      return (
        <div className="chat-card">
          <div className="chat-card__title">
            {block.title}
            <span className="chat-card__count">{block.count}</span>
          </div>
          {block.note && <div className="chat-card__note">{block.note}</div>}
          <ul className="chat-card__list">
            {block.items.map((it, i) => (
              <li key={i} title={it.detail}><span>{it.label}</span>{it.detail && <em>{it.detail}</em>}</li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}

/* ── Live state line at the bottom ────────────────────────────────────── */

/** What the agent is doing between visible output. Null while a tool card is
 *  already showing its own orb — one moving orb per state, never two. */
function liveState(blocks: Block[]): { orb: OrbState; label: string } | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.kind === 'tool' && !b.result) return null;
    if (b.kind === 'tool' || b.kind === 'text' || b.kind === 'user') break;
  }
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'text') return { orb: 'composing', label: 'Writing…' };
  return { orb: 'solving', label: 'Thinking…' };
}

/* ── Transcript ───────────────────────────────────────────────────────── */

export interface SessionHistory {
  /** Which session this is the history of — see the guard in ChatTranscript. */
  sessionId: string;
  prompt?: string;
  output?: RawEvent[];
}

interface ChatTranscriptProps {
  sessionId: string;
  status: string | null;
  engine: string | null;
  /** The session as fetched by the parent (one `sessions.get` per switch);
   *  null until it arrives. Live events that land first are held until then. */
  history: SessionHistory | null;
}

export function ChatTranscript({ sessionId, status, engine, history }: ChatTranscriptProps): React.ReactElement {
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT);
  const [loaded, setLoaded] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const running = status === 'running' || status === 'stuck';

  // Live events, folded in once per animation frame. Anything that arrives
  // before the history is held and applied right after it.
  const historyAppliedRef = useRef(false);
  const queueRef = useRef<RawEvent[]>([]);
  const rafRef = useRef(0);

  const flush = useCallback(() => {
    rafRef.current = 0;
    if (!historyAppliedRef.current || queueRef.current.length === 0) return;
    const batch = queueRef.current;
    queueRef.current = [];
    setTranscript((prev) => batch.reduce(appendEvent, prev));
  }, []);

  useEffect(() => {
    historyAppliedRef.current = false;
    queueRef.current = [];
    setTranscript(EMPTY_TRANSCRIPT);
    setLoaded(false);
    stickRef.current = true;
    const off = window.electronAPI?.on?.sessionOutput?.((id: string, event: unknown) => {
      if (id !== sessionId) return;
      queueRef.current.push(event as RawEvent);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    });
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      try { off?.(); } catch { /* noop */ }
    };
  }, [sessionId, flush]);

  useEffect(() => {
    // On a session switch the parent renders once with the new id but the
    // previous session's history still in state. Applying it here marked the
    // history "loaded", so the right one was ignored when it arrived — Chat
    // showed the last task while Raw showed this one.
    if (!history || history.sessionId !== sessionId || historyAppliedRef.current) return;
    setTranscript(buildTranscript(history.prompt, history.output ?? []));
    historyAppliedRef.current = true;
    setLoaded(true);
    if (queueRef.current.length > 0 && !rafRef.current) rafRef.current = requestAnimationFrame(flush);
  }, [history, sessionId, flush]);

  // Stick to the bottom while the user is there; otherwise leave them be and
  // offer a jump button.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = atBottom;
    setShowJump((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, running]);

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  const { blocks, usage } = transcript;
  const lastId = blocks[blocks.length - 1]?.id;
  const live = useMemo(() => (running ? liveState(blocks) : null), [running, blocks]);
  const engineName = engine ? ENGINE_NAME[engine] ?? engine : 'Agent';
  // Only the newest turn's avatar reflects the live status (and animates).
  const lastTurnStart = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i].kind !== 'user' && (i === 0 || blocks[i - 1].kind === 'user')) return i;
    }
    return -1;
  }, [blocks]);

  return (
    <div className="chat">
      <div className="chat__scroller" ref={scrollerRef} onScroll={onScroll}>
        <div className="chat__inner">
          {!loaded && (
            <div className="chat__loading"><Orb size={32} state="breathing" /></div>
          )}
          {loaded && blocks.length === 0 && (
            <div className="chat__empty">
              <AgentAvatar engineId={engine} sessionId={sessionId} status={status} size={48} />
              <span>Nothing here yet.</span>
            </div>
          )}
          {blocks.map((block, i) => {
            const prev = blocks[i - 1];
            // Claude-style turn header: the agent's face and name once, where
            // its reply begins, not on every block.
            const startsTurn = block.kind !== 'user' && (!prev || prev.kind === 'user');
            const isLast = block.id === lastId;
            // A tool is "running" only while it has no result and the session
            // is live; a text block streams only while it's the tail.
            const blockRunning = running && (
              block.kind === 'tool' ? !block.result : block.kind === 'text' && isLast
            );
            return (
              <React.Fragment key={block.id}>
                {startsTurn && (
                  <div className="chat-turn">
                    <AgentAvatar engineId={engine} sessionId={sessionId} status={i === lastTurnStart ? status : 'stopped'} size={22} />
                    <span className="chat-turn__name">{engineName}</span>
                  </div>
                )}
                <div className="chat-block">
                  <BlockView block={block} running={blockRunning} usage={usage} />
                </div>
              </React.Fragment>
            );
          })}
          {live && (
            <div className="chat-live" role="status" aria-live="polite">
              <Orb size={20} state={live.orb} />
              <span className="chat-live__label">{live.label}</span>
            </div>
          )}
        </div>
      </div>
      {showJump && (
        <button type="button" className="chat__jump" onClick={jumpToLatest}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Latest
        </button>
      )}
    </div>
  );
}

export default ChatTranscript;
