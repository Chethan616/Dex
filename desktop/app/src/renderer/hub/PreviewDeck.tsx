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
import type { AgentSession, ArtifactItem, HlEvent, TaskState, TaskStep } from './types';

type ArtifactEvent = Extract<HlEvent, { type: 'artifact' }>;
type ScreenshotEvent = Extract<HlEvent, { type: 'screenshot' }>;

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

/**
 * One search hit. Quiet until hovered — a list of twelve results should read
 * as a list of results, not a list of buttons.
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
            <button className="deck-card__file" onClick={() => reveal(event.file)}>{event.file}</button>
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
              {file.name}
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
    if (event.type === 'artifact' || event.type === 'screenshot') return true;
    if (event.type === 'task_state' && event.state.steps.length > 0) return true;
    // Any real activity is enough. Until the browser navigates, this rect
    // would otherwise read "No browser started yet" through an entire
    // filesystem or desktop task — indistinguishable from nothing happening.
    if (event.type === 'tool_call' || event.type === 'file_output') return true;
  }
  return false;
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
              {file.name}
            </button>
          ))}
        </div>
      ) : null}
    </section>
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
  const { taskState, artifacts, shots } = useMemo(() => {
    let latestState: TaskState | null = null;
    const cards: ArtifactEvent[] = [];
    const captures: ScreenshotEvent[] = [];

    for (const event of session.output) {
      // task_state carries the entire ledger every time, so the last one wins
      // outright — nothing to replay, and a dropped frame cannot desynchronise
      // the plan view.
      if (event.type === 'task_state') latestState = event.state;
      else if (event.type === 'artifact') cards.push(event);
      else if (event.type === 'screenshot') captures.push(event);
    }

    return {
      taskState: latestState,
      artifacts: cards.slice(-MAX_ARTIFACT_CARDS),
      shots: captures.slice(-MAX_SCREENSHOTS),
    };
  }, [session.output]);

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
