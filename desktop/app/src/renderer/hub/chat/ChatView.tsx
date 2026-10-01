/**
 * ChatView — the task's conversation inside the pane, laid out like Codex's
 * (docs/unify/PLAN.md §3.12; the screenshots in UI/):
 *
 *  - your messages: right-aligned blue bubbles;
 *  - DEX's work: folded under "Worked for 3m 45s ›" — open while it's working;
 *  - the reply: full-width prose, GitHub links with the GitHub mark, file
 *    links as file chips;
 *  - the files it made: one card list with "Open in ▾";
 *  - the minibar at the top right, and the composer at the bottom.
 *
 * It reads the same structured events as the Logs window (logs/transcript.ts)
 * and folds new ones in as they arrive; finished turns keep their identity,
 * so only the turn being written re-renders while a reply streams.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AgentAvatar, CopyButton, Orb, useBotMood, type BotMood } from '../../components/lib';
import { Markdown } from '../Markdown';
import { KindGlyph, prettyArgs } from '../../logs/ChatTranscript';
import { appendEvent, buildTranscript, EMPTY_TRANSCRIPT, type Block, type Transcript } from '../../logs/transcript';
import type { AgentSession, TaskStep } from '../types';
import { Composer, type ComposerAttachment } from './Composer';
import { FileCards, showFile } from './FileCards';
import { useTaskFileUrl } from '../workspace/useTaskFileUrl';
import { FileBadge } from './fileKinds';
import { Minibar } from './Minibar';
import { allOutputs, collectSources, formatDuration, toTurns, type FileItem, type Turn } from './turns';
import './chat.css';

type RawEvent = { type?: string } & Record<string, unknown>;

export interface ChatViewProps {
  session: AgentSession;
  /** The task's open web tabs, for Sources. */
  tabUrls?: string[];
  engineName: string;
  engineIcon?: string;
  onFollowUp?: (sessionId: string, prompt: string, attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>) => void;
  onPause?: (sessionId: string) => void;
  /** Open a site in a new tab of this task. */
  onOpenUrl?: (url: string) => void;
  focused?: boolean;
  /** Bumped to put the cursor in the composer (the follow-up shortcut). */
  focusSignal?: number;
}

/* ── Transcript, folded incrementally ─────────────────────────────────── */

function useTranscript(session: AgentSession): Transcript {
  const cache = useRef<{ id: string; prompt: string; count: number; last: unknown; t: Transcript } | null>(null);
  return useMemo(() => {
    const events = session.output as unknown as RawEvent[];
    const first = session.prompt?.trim();
    const c = cache.current;
    let t: Transcript;
    let from: number;
    if (c && c.id === session.id && c.prompt === session.prompt && events.length >= c.count && (c.count === 0 || events[c.count - 1] === c.last)) {
      t = c.t;
      from = c.count;
    } else {
      t = first ? buildTranscript(session.prompt, []) : EMPTY_TRANSCRIPT;
      from = 0;
    }
    for (let i = from; i < events.length; i += 1) {
      const ev = events[i];
      // Some engines echo the opening prompt as a user_input; it's already shown.
      if (first && t.blocks.length === 1 && ev.type === 'user_input' && String(ev.text ?? '').trim() === first) continue;
      t = appendEvent(t, ev);
    }
    cache.current = { id: session.id, prompt: session.prompt, count: events.length, last: events[events.length - 1], t };
    return t;
  }, [session.id, session.prompt, session.output]);
}

function sameTurn(a: Turn, b: Turn): boolean {
  return a.live === b.live && a.reply === b.reply && a.replyStreaming === b.replyStreaming
    && a.startAt === b.startAt && a.endAt === b.endAt && a.user === b.user
    && a.work.length === b.work.length && a.work.every((w, i) => w === b.work[i])
    && a.files.length === b.files.length && a.docs.length === b.docs.length
    && a.finds.length === b.finds.length && a.alerts.length === b.alerts.length;
}

/** A clock that ticks only while something on screen is counting. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function latestSteps(session: AgentSession): TaskStep[] {
  for (let i = session.output.length - 1; i >= 0; i -= 1) {
    const e = session.output[i];
    if (e.type === 'task_state') return e.state.steps;
  }
  return [];
}

function timeOfDay(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* ── Links: GitHub marks and file chips ───────────────────────────────── */

const GITHUB = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function GitHubMark(): React.ReactElement {
  return <svg className="cx-link__icon" viewBox="0 0 16 16" aria-hidden="true"><path d={GITHUB} fill="currentColor" /></svg>;
}

const norm = (p: string) => p.replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/').replace(/^\/([a-z]:)/i, '$1').toLowerCase();

function findOutput(ref: string, outputs: FileItem[]): FileItem | null {
  let wanted = ref.trim();
  try { wanted = decodeURI(wanted); } catch { /* keep as is */ }
  const n = norm(wanted);
  if (!n) return null;
  for (const f of outputs) {
    const p = norm(f.path);
    if (p === n || (n.includes('/') && p.endsWith(`/${n.replace(/^\.?\//, '')}`)) || f.name.toLowerCase() === n) return f;
  }
  return null;
}

/* ── Pieces of a turn ─────────────────────────────────────────────────── */

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg className={`cx-chev${open ? ' cx-chev--open' : ''}`} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const WorkStep = memo(function WorkStep({ block, running, sessionId }: { block: Block; running: boolean; sessionId: string }) {
  const [open, setOpen] = useState(false);
  if (block.kind === 'tool') {
    const failed = block.result ? !block.result.ok : false;
    const target = block.meta.display ?? block.summary;
    return (
      <div className={`cx-step-row${failed ? ' cx-step-row--failed' : ''}`}>
        <button type="button" className="cx-step-row__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="cx-step-row__icon">{running ? <Orb size={20} state={block.meta.orb} /> : <KindGlyph kind={block.meta.kind} />}</span>
          <span className="cx-step-row__verb">{running ? block.meta.active : block.meta.done}</span>
          {target && <span className="cx-step-row__target" title={target}>{target}</span>}
          {failed && <span className="cx-step-row__fail">Failed</span>}
          {block.result?.ms ? <span className="cx-step-row__ms">{formatDuration(block.result.ms)}</span> : null}
          <Chevron open={open} />
        </button>
        {open && (
          <div className="cx-step-row__body">
            <pre className="cx-code">{prettyArgs(block.args) || '—'}</pre>
            {block.result && <pre className={`cx-code${block.result.ok ? '' : ' cx-code--error'}`}>{block.result.preview || '(no output)'}</pre>}
          </div>
        )}
      </div>
    );
  }
  if (block.kind === 'text') {
    return <div className="cx-note"><Markdown source={block.text} variant="compact" /></div>;
  }
  if (block.kind === 'image') {
    return <Shot sessionId={sessionId} path={block.path} caption={block.caption} />;
  }
  if (block.kind === 'notice') {
    return <div className="cx-quiet" title={block.detail}>{block.title}</div>;
  }
  return null;
});

/** A screenshot the task took: its bytes via readFile (the hub can't load file://). */
function Shot({ sessionId, path, caption }: { sessionId: string; path: string; caption?: string }): React.ReactElement {
  const url = useTaskFileUrl(sessionId, path);
  return (
    <figure className="cx-shot">
      {url && <img src={url} alt={caption ?? 'Screenshot'} onClick={() => void showFile(sessionId, path)} />}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function DocCard({ block, openSignal }: { block: Extract<Block, { kind: 'canvas' }>; openSignal: number }): React.ReactElement {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  return (
    <div className={`cx-doc${open ? ' cx-doc--open' : ''}`} id={`cx-doc-${block.id}`}>
      <button type="button" className="cx-doc__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <FileBadge name="document.md" />
        <span className="cx-file__text">
          <span className="cx-file__name">{block.title || 'Document'}</span>
          <span className="cx-file__kind">Document</span>
        </span>
        <span className="cx-doc__toggle">{open ? 'Close' : 'Open'}</span>
      </button>
      <div className="cx-doc__body"><Markdown source={block.markdown} variant="chat" /></div>
    </div>
  );
}

function FindCard({ block }: { block: Extract<Block, { kind: 'artifact' }> }): React.ReactElement {
  return (
    <div className="cx-find">
      <div className="cx-find__head"><span>{block.title}</span><span className="cx-find__count">{block.count}</span></div>
      {block.note && <div className="cx-find__note">{block.note}</div>}
      <ul className="cx-find__list">
        {block.items.map((it, i) => <li key={i} title={it.detail}><span>{it.label}</span>{it.detail && <em>{it.detail}</em>}</li>)}
      </ul>
    </div>
  );
}

interface TurnViewProps {
  turn: Turn;
  sessionId: string;
  engineId?: string;
  /** The newest turn's bot wears the task's mood; older ones hold still. */
  avatarMood?: BotMood;
  open: boolean;
  onToggle: (key: number) => void;
  now: number;
  docSignals: Map<number, number>;
  renderLink: (href: string, children: React.ReactNode) => React.ReactNode | undefined;
  renderInlineCode: (text: string) => React.ReactNode | undefined;
}

function activityOf(turn: Turn): { label: string; orb: React.ComponentProps<typeof Orb>['state'] } {
  for (let i = turn.work.length - 1; i >= 0; i -= 1) {
    const b = turn.work[i];
    if (b.kind === 'tool' && !b.result) {
      const target = b.meta.display ?? b.summary;
      return { label: target ? `${b.meta.active} · ${target}` : b.meta.active, orb: b.meta.orb };
    }
    if (b.kind === 'tool') break;
  }
  if (turn.replyStreaming) return { label: 'Writing', orb: 'composing' };
  return { label: 'Thinking', orb: 'solving' };
}

/**
 * The task's own face at the head of each of DEX's turns. The newest wears
 * the task's mood (thinking, working, needs you, happy, sad, asleep — see
 * components/lib/botMood.ts); older turns hold a still, awake pose.
 */
function TurnAvatar({ sessionId, engineId, mood }: { sessionId: string; engineId?: string; mood?: BotMood }): React.ReactElement {
  return (
    <AgentAvatar
      sessionId={sessionId}
      engineId={engineId}
      status="idle"
      mood={mood}
      size={24}
      animate={Boolean(mood)}
      className="cx-head__avatar"
    />
  );
}

const TurnView = memo(function TurnView({ turn, sessionId, engineId, avatarMood, open, onToggle, now, docSignals, renderLink, renderInlineCode }: TurnViewProps) {
  const hasWork = turn.work.length > 0 || turn.live;
  // Sessions recorded before events carried times just say "Worked".
  const end = turn.live ? now : turn.endAt;
  const duration = turn.startAt !== undefined && end !== undefined ? formatDuration(end - turn.startAt) : null;
  const activity = turn.live ? activityOf(turn) : null;
  const runningToolId = turn.live ? [...turn.work].reverse().find((b) => b.kind === 'tool' && !b.result)?.id : undefined;

  return (
    <section className={`cx-turn${turn.live ? ' cx-turn--live' : ''}`}>
      {turn.user && (turn.user.text || turn.user.attachments?.length) ? (
        <div className="cx-user">
          {turn.user.attachments && turn.user.attachments.length > 0 && (
            <div className="cx-user__files">
              {turn.user.attachments.map((a, i) => (
                <span key={`${a.name}-${i}`} className="cx-user__file" title={a.name}>
                  <FileBadge name={a.name} mime={a.mime} size="sm" />
                  <span>{a.name}</span>
                </span>
              ))}
            </div>
          )}
          {turn.user.text && <div className="cx-user__bubble">{turn.user.text}</div>}
        </div>
      ) : null}

      <div className={`cx-head${hasWork ? '' : ' cx-head--bare'}`}>
        <TurnAvatar sessionId={sessionId} engineId={engineId} mood={avatarMood} />
        {hasWork && (
          <button type="button" className="cx-worked" onClick={() => onToggle(turn.key)} aria-expanded={open}>
            <span className="cx-worked__label">
              {turn.live ? 'Working' : 'Worked'}{duration ? ` for ${duration}` : ''}
            </span>
            {activity && <span className="cx-worked__now">{activity.label}</span>}
            {turn.work.length > 0 && <Chevron open={open} />}
          </button>
        )}
      </div>
      {open && turn.work.length > 0 && (
        <div className="cx-work">
          {turn.work.map((b) => <WorkStep key={b.id} block={b} running={b.id === runningToolId} sessionId={sessionId} />)}
        </div>
      )}

      {turn.alerts.map((b) => (
        <div key={b.id} className={`cx-alert cx-alert--${b.kind === 'error' ? 'error' : 'blocking'}`} role={b.kind === 'error' ? 'alert' : 'status'}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2l6.3 11H1.7zM8 6.5v3M8 11.5h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{b.kind === 'error' ? b.message : b.title}</span>
        </div>
      ))}

      {turn.reply && (
        <div className={`cx-reply${turn.replyStreaming ? ' cx-reply--streaming' : ''}`}>
          <Markdown source={turn.reply} variant="chat" renderLink={renderLink} renderInlineCode={renderInlineCode} />
        </div>
      )}

      {turn.docs.map((d) => <DocCard key={d.id} block={d} openSignal={docSignals.get(d.id) ?? 0} />)}
      {turn.finds.map((f) => <FindCard key={f.id} block={f} />)}
      {turn.files.length > 0 && <FileCards sessionId={sessionId} files={turn.files} />}

      {!turn.live && turn.reply && (
        <div className="cx-foot">
          <CopyButton text={turn.reply} />
          {turn.endAt ? <span className="cx-foot__time">{timeOfDay(turn.endAt)}</span> : null}
        </div>
      )}
    </section>
  );
});

/* ── The view ─────────────────────────────────────────────────────────── */

const MINIBAR_KEY = 'dex.chat.minibar';
function readMinibarPref(): 'open' | 'closed' | null {
  try {
    const v = window.localStorage.getItem(MINIBAR_KEY);
    return v === 'open' || v === 'closed' ? v : null;
  } catch {
    return null;
  }
}

export function ChatView({ session, tabUrls = [], engineName, engineIcon, onFollowUp, onPause, onOpenUrl, focused, focusSignal }: ChatViewProps): React.ReactElement {
  const running = session.status === 'running' || session.status === 'stuck';
  const mood = useBotMood(session);
  const transcript = useTranscript(session);
  const blocks = transcript.blocks;

  // Turns keep their identity while nothing in them changed.
  const prevTurns = useRef<Map<number, Turn>>(new Map());
  const turns = useMemo(() => {
    const fresh = toTurns(blocks, running, session.createdAt);
    const next = fresh.map((t) => {
      const old = prevTurns.current.get(t.key);
      return old && sameTurn(old, t) ? old : t;
    });
    prevTurns.current = new Map(next.map((t) => [t.key, t]));
    return next;
  }, [blocks, running, session.createdAt]);

  // A running turn starts open and folds when it's done, unless you chose.
  const [choices, setChoices] = useState<Map<number, boolean>>(new Map());
  useEffect(() => setChoices(new Map()), [session.id]);
  const onToggle = useCallback((key: number) => {
    setChoices((prev) => {
      const next = new Map(prev);
      const turn = prevTurns.current.get(key);
      next.set(key, !(prev.get(key) ?? Boolean(turn?.live)));
      return next;
    });
  }, []);

  const live = turns.length > 0 && turns[turns.length - 1].live;
  const now = useNow(live);

  const outputs = useMemo(() => allOutputs(turns), [turns]);
  const outputsRef = useRef(outputs);
  outputsRef.current = outputs;
  const sessionId = session.id;

  const renderLink = useCallback((href: string, children: React.ReactNode): React.ReactNode | undefined => {
    if (/^https?:\/\/(www\.)?github\.com\//i.test(href)) {
      return <a className="cx-link" href={href} target="_blank" rel="noreferrer"><GitHubMark />{children}</a>;
    }
    if (/^https?:/i.test(href)) return undefined;
    const file = findOutput(href, outputsRef.current);
    if (!file) return undefined;
    return (
      <a className="cx-link" href="#" title={file.path} onClick={(e) => { e.preventDefault(); void showFile(sessionId, file.path); }}>
        <FileBadge name={file.name} mime={file.mime} size="sm" />{children}
      </a>
    );
  }, [sessionId]);

  const renderInlineCode = useCallback((text: string): React.ReactNode | undefined => {
    if (!/[\\/]|\.[a-z0-9]{1,5}$/i.test(text)) return undefined;
    const file = findOutput(text, outputsRef.current);
    if (!file) return undefined;
    return (
      <a className="cx-link cx-link--file" href="#" title={file.path} onClick={(e) => { e.preventDefault(); void showFile(sessionId, file.path); }}>
        <FileBadge name={file.name} mime={file.mime} size="sm" />{file.name}
      </a>
    );
  }, [sessionId]);

  // Opening a document from the minibar: scroll to it and open it.
  const [docSignals, setDocSignals] = useState<Map<number, number>>(new Map());
  const openDoc = useCallback((id: number) => {
    setDocSignals((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
    requestAnimationFrame(() => document.getElementById(`cx-doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  const steps = useMemo(() => latestSteps(session), [session]);
  const docs = useMemo(() => turns.flatMap((t) => t.docs).map((d) => ({ title: d.title || 'Document', onOpen: () => openDoc(d.id) })), [turns, openDoc]);
  const sources = useMemo(() => collectSources(blocks, tabUrls), [blocks, tabUrls]);

  // Layout: the minibar floats beside a wide column, pushes a middling one
  // over, and waits behind its button on a narrow pane.
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = width >= 1180 ? 'wide' : width >= 860 ? 'mid' : 'narrow';
  const [miniPref, setMiniPref] = useState<'open' | 'closed' | null>(readMinibarPref);
  const miniOpen = miniPref ? miniPref === 'open' : size !== 'narrow';
  const setMini = useCallback((open: boolean) => {
    const v = open ? 'open' : 'closed';
    setMiniPref(v);
    try { window.localStorage.setItem(MINIBAR_KEY, v); } catch { /* private mode */ }
  }, []);

  // Stick to the bottom while you're there; otherwise leave you be.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    stickRef.current = atBottom;
    setShowJump((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);
  useEffect(() => { stickRef.current = true; }, [session.id]);
  const jump = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  const send = useCallback((text: string, attachments?: ComposerAttachment[]) => {
    stickRef.current = true;
    onFollowUp?.(sessionId, text, attachments?.map(({ name, mime, bytes }) => ({ name, mime, bytes })));
  }, [onFollowUp, sessionId]);

  const statusLabel = running ? (live && turns[turns.length - 1].startAt ? `working · ${formatDuration(now - (turns[turns.length - 1].startAt ?? now))}` : 'working')
    : session.status === 'paused' ? 'paused' : session.status === 'stopped' && session.error ? 'failed' : 'done';

  return (
    <div ref={rootRef} className={`cx cx--${size}${miniOpen ? ' cx--mini' : ''}`}>
      <div className="cx__scroller" ref={scrollerRef} onScroll={onScroll}>
        <div className="cx__col">
          {turns.map((turn, i) => (
            <TurnView
              key={turn.key}
              turn={turn}
              sessionId={sessionId}
              engineId={session.engine}
              avatarMood={i === turns.length - 1 ? mood : undefined}
              open={choices.get(turn.key) ?? turn.live}
              onToggle={onToggle}
              now={turn.live ? now : 0}
              docSignals={docSignals}
              renderLink={renderLink}
              renderInlineCode={renderInlineCode}
            />
          ))}
          {turns.length === 0 && (
            <div className="cx__empty">
              <AgentAvatar sessionId={sessionId} engineId={session.engine} status={session.status} mood={mood} size={64} />
            </div>
          )}
        </div>
      </div>

      {miniOpen ? (
        <Minibar
          avatar={<AgentAvatar sessionId={sessionId} engineId={session.engine} status={session.status} mood={mood} size={28} />}
          sessionId={sessionId}
          title={session.prompt}
          engineName={engineName}
          engineIcon={engineIcon}
          model={session.model ? (session.model.includes('/') ? session.model.split('/').pop() : session.model) : undefined}
          status={statusLabel}
          steps={steps}
          outputs={outputs}
          docs={docs}
          sources={sources}
          onOpenUrl={(url) => onOpenUrl?.(url)}
          onClose={() => setMini(false)}
        />
      ) : (
        <button type="button" className="cx-mini-toggle" onClick={() => setMini(true)} aria-label="Show task panel" title="Show task panel">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><path d="M2.5 4h11M2.5 8h7M2.5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          {outputs.length + docs.length > 0 && <span className="cx-mini-toggle__count">{outputs.length + docs.length}</span>}
        </button>
      )}

      {showJump && (
        <button type="button" className="cx__jump" onClick={jump} aria-label="Jump to the latest" title="Jump to the latest">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><path d="M8 3v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}

      {onFollowUp && (
        <div className="cx__composer">
          <Composer
            sessionId={sessionId}
            onSend={send}
            working={running}
            onPause={onPause ? () => onPause(sessionId) : undefined}
            engineLabel={engineName + (session.model ? ` · ${session.model.includes('/') ? session.model.split('/').pop() : session.model}` : '')}
            autoFocus={focused}
            focusSignal={focusSignal}
          />
        </div>
      )}
    </div>
  );
}
