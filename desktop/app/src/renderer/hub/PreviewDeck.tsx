/**
 * PreviewDeck — what the browser pane shows when there is no page to show.
 *
 * The pane is normally covered by a native WebContentsView composited over the
 * renderer, so React cannot draw into it while a page is live. But a great deal
 * of DEX's work never touches the browser: searching the filesystem, driving a
 * desktop app through the accessibility tree, falling back to screenshots when
 * that tree comes up empty. During all of that the pane is a blank rectangle
 * reading "No browser started yet".
 *
 * So when the view is detached — not yet opened, never navigated, or paused —
 * this fills the space with the work that *is* happening: the plan and how far
 * it has got, the files that were found, the screenshots being taken. The
 * moment a page loads, the native view goes back on top and this disappears.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Markdown } from './Markdown';
import type { AgentSession, ArtifactItem, HlEvent, TaskState, TaskStep } from './types';

type ArtifactEvent = Extract<HlEvent, { type: 'artifact' }>;
type ScreenshotEvent = Extract<HlEvent, { type: 'screenshot' }>;
type ConfirmationEvent = Extract<HlEvent, { type: 'confirmation' }>;
type CanvasEvent = Extract<HlEvent, { type: 'canvas' }>;

const MAX_SCREENSHOTS = 12;
const MAX_ARTIFACT_CARDS = 4;

function formatBytes(bytes?: number): string | null {
  if (bytes == null || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function folderOf(detail?: string): string | null {
  if (!detail) return null;
  const cut = Math.max(detail.lastIndexOf('/'), detail.lastIndexOf('\\'));
  return cut > 0 ? detail.slice(0, cut) : null;
}

function reveal(path?: string): void {
  if (!path) return;
  window.electronAPI?.sessions?.revealOutput?.(path);
}

function extOf(label: string): string {
  const dot = label.lastIndexOf('.');
  return dot >= 0 ? label.slice(dot + 1).toLowerCase() : '';
}

/**
 * The file's kind, from its extension — icon only, no color coding. This
 * shell already has a second visual language for "why this matched"
 * (the reason tags below); giving every file type its own color on top of
 * that would be a third one competing for attention in a list whose whole
 * point is to be scanned quickly. Mirrors the Flutter app's `_iconFor`.
 */
function FileTypeIcon({ label }: { label: string }): React.ReactElement {
  const ext = extOf(label);
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' as const };
  const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="2" width="11" height="10" rx="1" {...stroke} />
        <path d="M1.5 5.3h11M5.3 2v10M8.7 2v10" {...stroke} />
      </svg>
    );
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="2.5" width="11" height="7.5" rx="1" {...stroke} />
        <path d="M5 12.5h4" {...stroke} />
        <path d="M4 8.2l2-2.2 1.5 1.5L10 5" {...stroke} />
      </svg>
    );
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="2" width="11" height="10" rx="1" {...stroke} />
        <circle cx="4.6" cy="5" r="1" fill="currentColor" stroke="none" />
        <path d="M2 10.5l3-3 2.2 2.2L10.5 6l1.5 1.8" {...stroke} />
      </svg>
    );
  }
  if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="2.5" width="11" height="9" rx="1" {...stroke} />
        <path d="M5.7 5.2v3.6l3-1.8-3-1.8z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M5.2 9.8V2.8L11 1.7v7" {...stroke} />
        <circle cx="4" cy="9.8" r="1.7" {...stroke} />
        <circle cx="9.8" cy="8.7" r="1.7" {...stroke} />
      </svg>
    );
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3 1.8h8l1.6 2.4v7a1 1 0 01-1 1H2.4a1 1 0 01-1-1v-7L3 1.8z" {...stroke} />
        <path d="M6 1.8v1.4M8 3.2v1.4M6 4.6v1.4M8 6v1.4" {...stroke} />
      </svg>
    );
  }
  if (['exe', 'msi'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="2.5" width="11" height="9" rx="1" {...stroke} />
        <path d="M1.5 5h11" {...stroke} />
        <circle cx="3.3" cy="3.7" r="0.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3.2 1.5h5l2.6 2.6v8.4a1 1 0 01-1 1H3.2a1 1 0 01-1-1v-10a1 1 0 011-1z" {...stroke} />
        <path d="M8.2 1.5v2.6h2.6" {...stroke} />
        <path d="M4.3 7.2h5.4M4.3 9.3h5.4M4.3 11h3.2" {...stroke} />
      </svg>
    );
  }
  // Generic file — same page-with-folded-corner shape, no interior lines.
  return (
    <svg {...common} aria-hidden="true">
      <path d="M3.2 1.5h5l2.6 2.6v8.4a1 1 0 01-1 1H3.2a1 1 0 01-1-1v-10a1 1 0 011-1z" {...stroke} />
      <path d="M8.2 1.5v2.6h2.6" {...stroke} />
    </svg>
  );
}

/**
 * One search hit, one row. Matches the Flutter app's file-result rows
 * deliberately: name and size on the first line, the folder underneath in a
 * quieter tone, the matched excerpt below that when the hit came from a
 * file's content rather than its name, and the reasons as small quiet tags
 * — never a colored badge grid. A list of twelve results should read as a
 * list of results, not a grid of tiles competing for attention.
 */
function ArtifactRow({ item }: { item: ArtifactItem }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const size = formatBytes(item.bytes);
  const folder = folderOf(item.detail);

  return (
    <div
      className={hovered ? 'deck-item deck-item--hover' : 'deck-item'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => reveal(item.detail)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reveal(item.detail);
        }
      }}
      title={item.detail ?? item.label}
      role="button"
      tabIndex={0}
    >
      <span className="deck-item__icon"><FileTypeIcon label={item.label} /></span>
      <div className="deck-item__body">
        <div className="deck-item__line">
          <span className="deck-item__label">{item.label}</span>
          {size ? <span className="deck-item__size">{size}</span> : null}
        </div>
        {folder ? <div className="deck-item__folder">{folder}</div> : null}
        {item.excerpt ? <div className="deck-item__excerpt">{item.excerpt}</div> : null}
        {item.reasons.length > 0 ? (
          <div className="deck-item__reasons">
            {item.reasons.map((reason) => (
              <span className="deck-tag" key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}
      </div>
      {/* Only on hover, so a list of results reads as results, not buttons. */}
      {hovered && item.detail ? (
        <button
          className="deck-item__copy"
          title="Copy path"
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard?.writeText(item.detail as string);
          }}
        >
          Copy
        </button>
      ) : null}
    </div>
  );
}

function ArtifactCard({ event }: { event: ArtifactEvent }): React.ReactElement {
  const total = event.total != null && event.total > event.items.length ? event.total : null;

  return (
    <section className="deck-card">
      <header className="deck-card__header">
        <span className="deck-card__title">{event.title}</span>
        {total != null ? (
          <span className="deck-card__count">showing {event.items.length} of {total}</span>
        ) : null}
      </header>
      {event.note ? <p className="deck-card__note">{event.note}</p> : null}
      {event.kind === 'reading' ? (
        <div className="deck-card__reading">
          {event.file ? (
            <button className="deck-card__file" onClick={() => reveal(event.file)}>
              <FileTypeIcon label={event.file} />
              <span>{event.file}</span>
            </button>
          ) : null}
          {event.body ? <p className="deck-card__body">{event.body}</p> : null}
        </div>
      ) : (
        <div className="deck-card__items">
          {event.items.map((item, index) => (
            <ArtifactRow item={item} key={`${item.detail ?? item.label}-${index}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function stepGlyph(step: TaskStep): string {
  if (step.status === 'done') return '✓';
  if (step.status === 'failed') return '✕';
  if (step.status === 'skipped') return '–';
  if (step.status === 'active') return '▸';
  return '○';
}

/**
 * A step that failed and then recovered keeps both facts. Surfacing the
 * recovery is the whole point of the ledger: it is the difference between
 * "this broke" and "this broke and DEX carried on through another interface".
 */
function recoveryLabel(step: TaskStep): string | null {
  const last = step.failures[step.failures.length - 1];
  if (!last) return null;
  if (last.fallback) return `${last.tool ?? 'failed'} → ${last.fallback}`;
  return last.reason;
}

function PlanCard({ state }: { state: TaskState }): React.ReactElement {
  const done = state.steps.filter((step) => step.status === 'done').length;

  return (
    <section className="deck-card">
      <header className="deck-card__header">
        <span className="deck-card__title">{state.objective || 'Plan'}</span>
        <span className="deck-card__count">{done}/{state.steps.length}</span>
      </header>
      <ol className="deck-plan">
        {state.steps.map((step) => {
          const recovery = recoveryLabel(step);
          return (
            <li className={`deck-plan__step deck-plan__step--${step.status}`} key={step.id}>
              <span className="deck-plan__glyph">{stepGlyph(step)}</span>
              <span className="deck-plan__title">{step.title}</span>
              {recovery ? <span className="deck-plan__recovery">{recovery}</span> : null}
            </li>
          );
        })}
      </ol>
      {state.files.length > 0 ? (
        <div className="deck-plan__files">
          {state.files.map((file) => (
            <button
              className="deck-plan__file"
              key={file.path}
              onClick={() => reveal(file.path)}
              title={file.path}
            >
              <FileTypeIcon label={file.name} />
              <span>{file.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ScreenshotCard({ shots }: { shots: ScreenshotEvent[] }): React.ReactElement {
  const [selected, setSelected] = useState<number | null>(null);
  const activeIndex = selected ?? shots.length - 1;
  const active = shots[activeIndex];

  return (
    <section className="deck-card deck-card--shots">
      <header className="deck-card__header">
        <span className="deck-card__title">{active.mode === 'uia' ? 'Screen (annotated)' : 'Screen'}</span>
        {active.caption ? <span className="deck-card__count">{active.caption}</span> : null}
      </header>
      <img className="deck-shot" src={`file://${active.path}`} alt={active.caption ?? 'screen capture'} />
      {shots.length > 1 ? (
        <div className="deck-shot__strip">
          {shots.map((shot, index) => (
            <button
              key={`${shot.path}-${shot.at}`}
              className={index === activeIndex ? 'deck-shot__thumb deck-shot__thumb--active' : 'deck-shot__thumb'}
              onClick={() => setSelected(index)}
            >
              <img src={`file://${shot.path}`} alt="" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Whether the deck has anything to draw. The pane needs to know this before
 * rendering, because showing the deck means detaching the native browser view
 * — and detaching it for an empty deck would replace a live page with nothing.
 */
export function deckHasContent(session: AgentSession): boolean {
  // A draft has produced nothing and is usually one navigation away from
  // showing a real page. Claiming the rect there would mean detaching a
  // browser view that is about to be needed.
  if (session.status === 'draft') return false;

  for (const event of session.output) {
    if (event.type === 'artifact' || event.type === 'screenshot' || event.type === 'canvas') return true;
    if (event.type === 'task_state' && event.state.steps.length > 0) return true;
    // Any real activity is enough. Until the browser navigates, this rect
    // would otherwise read "No browser started yet" through an entire
    // filesystem or desktop task — indistinguishable from nothing happening.
    if (event.type === 'tool_call' || event.type === 'file_output') return true;
  }
  return false;
}

/**
 * The most recent canvas document, if any. Unlike artifacts/screenshots
 * (which accumulate — the deck shows the last few), a canvas is a
 * singleton: the latest `dex-canvas show` call is the whole story, so this
 * returns one event or none, not a list.
 */
export function getLatestCanvas(session: AgentSession): CanvasEvent | null {
  let latest: CanvasEvent | null = null;
  for (const event of session.output) {
    if (event.type === 'canvas') latest = event;
  }
  return latest;
}

/**
 * Whether the session has a confirmation still waiting on a human answer.
 */
export function hasPendingConfirmation(session: AgentSession): boolean {
  return getPendingConfirmations(session).length > 0;
}

/**
 * The actual pending confirmation events (usually zero or one), for
 * rendering. Split out from hasPendingConfirmation because the card needs
 * to be rendered somewhere the human can always reach it, not just gated
 * behind a boolean — see the comment on ConfirmationCard below for why that
 * turned out to matter.
 */
export function getPendingConfirmations(session: AgentSession): ConfirmationEvent[] {
  const latestById = new Map<string, ConfirmationEvent>();
  for (const event of session.output) {
    if (event.type === 'confirmation') latestById.set(event.id, event);
  }
  return [...latestById.values()].filter((e) => e.status === 'pending');
}

/**
 * What the agent is doing right now, read off the event stream it already
 * produces.
 *
 * Every number here is derived from events that were being emitted anyway, so
 * this costs nothing: no extra model calls, no extra tool calls, no work asked
 * of the agent. It exists because a long non-browser task otherwise shows an
 * empty rectangle, and "nothing on screen" and "nothing happening" look
 * identical from the outside.
 */
function ActivityCard({ session }: { session: AgentSession }): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());

  const running = session.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const stats = useMemo(() => {
    let tools = 0;
    let lastTool: string | null = null;
    let lastThought: string | null = null;
    const files: Array<{ name: string; path: string; size?: number }> = [];

    for (const event of session.output) {
      if (event.type === 'tool_call') {
        tools += 1;
        lastTool = event.name;
      } else if (event.type === 'file_output') {
        files.push({ name: event.name, path: event.path, size: event.size });
      } else if (event.type === 'thinking') {
        const text = event.text.trim();
        if (text) lastThought = text;
      }
    }
    return { tools, lastTool, lastThought, files: files.slice(-6) };
  }, [session.output]);

  const elapsed = Math.max(0, Math.floor((now - session.createdAt) / 1000));
  const elapsedLabel = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s`;

  return (
    <section className="deck-card deck-card--activity">
      <header className="deck-card__header">
        <span className="deck-card__title">
          {running ? (stats.lastTool ?? 'Working') : 'Nothing running'}
        </span>
        {running ? <span className="deck-pulse" aria-hidden="true" /> : null}
      </header>

      {stats.lastThought ? (
        <p className="deck-activity__thought">{stats.lastThought.slice(0, 240)}</p>
      ) : null}

      <div className="deck-activity__stats">
        <div className="deck-stat">
          <span className="deck-stat__value">{elapsedLabel}</span>
          <span className="deck-stat__label">elapsed</span>
        </div>
        <div className="deck-stat">
          <span className="deck-stat__value">{stats.tools}</span>
          <span className="deck-stat__label">{stats.tools === 1 ? 'action' : 'actions'}</span>
        </div>
        <div className="deck-stat">
          <span className="deck-stat__value">{stats.files.length}</span>
          <span className="deck-stat__label">{stats.files.length === 1 ? 'file' : 'files'}</span>
        </div>
      </div>

      {stats.files.length > 0 ? (
        <div className="deck-plan__files">
          {stats.files.map((file) => (
            <button
              className="deck-plan__file"
              key={file.path}
              onClick={() => reveal(file.path)}
              title={file.path}
            >
              <FileTypeIcon label={file.name} />
              <span>{file.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A blocking human decision — dex-registry's set/delete/import, backed up
 * first and waiting here rather than trusting the engine's own judgment on
 * a real registry write. Answering calls straight back into main over IPC;
 * there is no polling on either side, so the click resolves the agent's
 * still-open HTTP request immediately.
 *
 * Deliberately NOT rendered inside PreviewDeck/.pane__output. That rect is
 * contested by two other surfaces that both composite above plain React: the
 * native WebContentsView when a page has loaded, and the floating Logs
 * window when it's open (it anchors to the exact same rect). A card placed
 * there is invisible whenever either happens to be on top — which is
 * genuinely most of the time, since a browser task usually has navigated by
 * the time a registry confirmation fires, and Logs is the panel people
 * actually watch. AgentPane renders this in the pane's header/chrome
 * instead, which neither of those surfaces ever touches, so it's reachable
 * no matter what's currently showing underneath.
 */
export function ConfirmationCard({ sessionId, event }: { sessionId: string; event: ConfirmationEvent }): React.ReactElement {
  const [answering, setAnswering] = useState<'approve' | 'deny' | null>(null);

  const answer = (approved: boolean) => {
    if (answering) return; // one click; a slow IPC round trip shouldn't double-fire
    setAnswering(approved ? 'approve' : 'deny');
    window.electronAPI?.dex?.confirmAnswer(sessionId, event.id, approved).catch(() => {
      setAnswering(null);
    });
  };

  return (
    <section className="deck-card deck-card--confirm">
      <span className="deck-confirm__eyebrow">
        <span className="deck-confirm__eyebrow-dot" aria-hidden="true" />
        Needs your approval
      </span>
      <header className="deck-card__header">
        <span className="deck-card__title">{event.title}</span>
      </header>
      <p className="deck-card__body deck-confirm__detail">{event.detail}</p>
      <div className="deck-confirm__actions">
        <button
          className="deck-confirm__btn deck-confirm__btn--deny"
          onClick={() => answer(false)}
          disabled={answering != null}
        >
          {answering === 'deny' ? 'Denying…' : 'Deny'}
        </button>
        <button
          className="deck-confirm__btn deck-confirm__btn--approve"
          onClick={() => answer(true)}
          disabled={answering != null}
        >
          {answering === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </section>
  );
}

/**
 * The agent's own generative UI: a rendered markdown document filling the
 * whole rect, the way a live page would — not one card competing for space
 * among plans and file results. dex-canvas is for exactly the cases where
 * the *shape* of the answer (a table, real headings, sections) is part of
 * what makes it useful, so it gets the same visual weight a browser page
 * would, not a footnote in a card stack.
 */
function CanvasDocument({ event }: { event: CanvasEvent }): React.ReactElement {
  return (
    <div className="deck-canvas">
      <header className="deck-canvas__header">
        <span className="deck-canvas__title">{event.title}</span>
      </header>
      <div className="deck-canvas__body">
        <Markdown source={event.markdown} />
      </div>
    </div>
  );
}

export function PreviewDeck({
  session,
  actions,
}: {
  session: AgentSession;
  /** Resume / Continue browsing / Rerun, rendered under the cards. */
  actions?: React.ReactNode;
}): React.ReactElement {
  const { taskState, artifacts, shots, canvas } = useMemo(() => {
    let latestState: TaskState | null = null;
    let latestCanvas: CanvasEvent | null = null;
    const cards: ArtifactEvent[] = [];
    const captures: ScreenshotEvent[] = [];

    for (const event of session.output) {
      // task_state and canvas both carry their whole state every time, so
      // the last one wins outright — nothing to replay, and a dropped frame
      // cannot desynchronise the plan view or leave a stale document showing.
      if (event.type === 'task_state') latestState = event.state;
      else if (event.type === 'canvas') latestCanvas = event;
      else if (event.type === 'artifact') cards.push(event);
      else if (event.type === 'screenshot') captures.push(event);
    }

    return {
      taskState: latestState,
      canvas: latestCanvas,
      artifacts: cards.slice(-MAX_ARTIFACT_CARDS),
      shots: captures.slice(-MAX_SCREENSHOTS),
    };
  }, [session.output]);

  // A canvas document takes the whole rect exclusively, the way a live page
  // would — it does not compete for space with the plan/artifact/activity
  // cards below it. If the agent wants those visible too, that information
  // belongs in the document itself.
  if (canvas) {
    return (
      <div className="deck deck--canvas">
        <CanvasDocument event={canvas} />
      </div>
    );
  }

  const hasPlan = taskState != null && taskState.steps.length > 0;
  const hasResults = hasPlan || artifacts.length > 0 || shots.length > 0;

  return (
    <div className="deck">
      <div className="deck__content">
        {shots.length > 0 ? <ScreenshotCard shots={shots} /> : null}
        {artifacts.map((artifact, index) => (
          <ArtifactCard event={artifact} key={`artifact-${index}`} />
        ))}
        {hasPlan && taskState ? <PlanCard state={taskState} /> : null}
        <ActivityCard session={session} />
        {actions ? <div className="deck__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export default PreviewDeck;
