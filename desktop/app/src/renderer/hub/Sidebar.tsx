import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSession, SessionStatus } from './types';
import { orderSessionsForSidebar } from './sessionOrdering';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';
import { AgentAvatar, useBotMood } from '../components/lib';
import { taskTitle } from '../../shared/slashCommands';

/**
 * A row's icon: the site's favicon while the task rests, its bot while it's
 * doing something or just finished — so a glance down the list shows who's
 * thinking, working, waiting on you, or done.
 */
function RowIcon({ session, favicon, size, fallbackClass }: { session: AgentSession; favicon: string | null; size: number; fallbackClass: string }): React.ReactElement {
  const mood = useBotMood(session);
  const resting = mood === 'sleeping' || mood === 'awake';
  if (favicon && resting) return <img src={favicon} alt="" width={size} height={size} />;
  return (
    <span className={fallbackClass} aria-hidden={size < 16 ? true : undefined}>
      <AgentAvatar engineId={session.engine} sessionId={session.id} status={session.status} mood={mood} size={size} />
    </span>
  );
}

interface SidebarSession extends AgentSession {
  primarySite?: string | null;
  lastActivityAt?: number;
}

export type SidebarRowAction = 'rerun' | 'stop' | 'pause' | 'resume' | 'delete' | 'pin' | 'unpin' | 'rename';

export type SidebarMode = 'side' | 'top';

interface SidebarProps {
  sessions?: SidebarSession[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onNewAgent?: () => void;
  onRowAction?: (id: string, action: SidebarRowAction) => void;
  onBulkDelete?: (ids: string[]) => void;
  onRename?: (id: string, title: string) => Promise<void>;
  manualOrderIds?: readonly string[];
  onReorder?: (ids: string[], targetId: string) => void;
  pinnedIds?: ReadonlySet<string>;
  mode?: SidebarMode;
}


const MOCK_SIDEBAR_SESSIONS: SidebarSession[] = [
  {
    id: 'mock-1',
    prompt: 'Reply to unread DMs on LinkedIn',
    status: 'running',
    createdAt: Date.now() - 1000 * 60 * 4,
    output: [],
    primarySite: 'linkedin.com',
    lastActivityAt: Date.now() - 1000 * 5,
  },
  {
    id: 'mock-2',
    prompt: 'Summarize latest X notifications',
    status: 'idle',
    createdAt: Date.now() - 1000 * 60 * 12,
    output: [],
    primarySite: 'x.com',
    lastActivityAt: Date.now() - 1000 * 60 * 2,
  },
  {
    id: 'mock-3',
    prompt: 'Find 10 SaaS founders hiring eng managers',
    status: 'stuck',
    createdAt: Date.now() - 1000 * 60 * 30,
    output: [],
    primarySite: 'google.com',
    lastActivityAt: Date.now() - 1000 * 60 * 8,
  },
  {
    id: 'mock-4',
    prompt: 'Draft a reply to Jessica from Tuesday',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
    output: [],
    primarySite: 'gmail.com',
    lastActivityAt: Date.now() - 1000 * 60 * 55,
  },
  {
    id: 'mock-5',
    prompt: 'Check Reddit for competitor mentions',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    output: [],
    primarySite: 'reddit.com',
    lastActivityAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: 'mock-6',
    prompt: 'Old calendar cleanup run',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    output: [],
    primarySite: 'calendar.google.com',
    lastActivityAt: Date.now() - 1000 * 60 * 60 * 23,
  },
];

const STATUS_DOT: Record<SessionStatus, { color: string; label: string }> = {
  running: { color: 'var(--status-running)', label: 'Running' },
  idle:    { color: 'var(--status-idle)', label: 'Waiting for input' },
  stuck:   { color: 'var(--status-stuck)', label: 'Stuck' },
  paused:  { color: 'var(--status-paused)', label: 'Paused' },
  stopped: { color: 'var(--status-stopped)', label: 'Stopped' },
  draft:   { color: 'var(--status-stopped)', label: 'Draft' },
};

function preventMouseFocus(e: React.MouseEvent<HTMLElement>): void {
  e.preventDefault();
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function faviconUrl(site: string | null | undefined): string | null {
  if (!site) return null;
  const clean = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `https://www.google.com/s2/favicons?domain=${clean}&sz=64`;
}

function PlusIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="3" cy="7" r="1.1" fill="currentColor" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" />
      <circle cx="11" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}

function SearchIcon(): React.ReactElement {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function SelectModeIcon(): React.ReactElement {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.3" /><path d="m4.6 8.1 2.2 2.1 4.6-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SelectAllIcon({ checked }: { checked: boolean }): React.ReactElement {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="2.4" stroke="currentColor" strokeWidth="1.2" /><path d={checked ? 'm4.2 8.1 2.3 2.3 5.2-5.1' : 'M4.5 8h7'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CheckSquareIcon({ checked }: { checked: boolean }): React.ReactElement {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.2" y="2.2" width="13.6" height="13.6" rx="3" stroke="currentColor" strokeWidth="1.25" />{checked && <path d="m5.2 9.1 2.3 2.3 5.3-5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}</svg>;
}

function TrashIcon(): React.ReactElement {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.3h10M6.1 4.3V2.7h3.8v1.6m2.2 0-.5 9H4.4l-.5-9M6.6 6.7v4.6m2.8-4.6v4.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CloseIcon(): React.ReactElement {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function DragHandleIcon(): React.ReactElement {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5" cy="4" r="1" fill="currentColor"/><circle cx="11" cy="4" r="1" fill="currentColor"/><circle cx="5" cy="8" r="1" fill="currentColor"/><circle cx="11" cy="8" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="11" cy="12" r="1" fill="currentColor"/></svg>;
}

function sessionDisplayTitle(session: SidebarSession): string {
  if (session.title) return session.title;
  const named = /\b(?:called|named)\s+(?:“([^”]{1,100})”|‘([^’]{1,100})’|"([^"]{1,100})"|'([^']{1,100})')/i.exec(session.prompt);
  return named?.slice(1).find(Boolean) ?? taskTitle(session.prompt);
}

function SessionRowImpl({
  s,
  selected,
  onSelect,
  onAction,
  onRename,
  pinned = false,
  selectionMode = false,
  multiSelected = false,
  onStartReorder,
  onDropReorder,
  onToggleSelection,
}: {
  s: SidebarSession;
  selected: boolean;
  onSelect?: (id: string) => void;
  onAction?: (id: string, action: SidebarRowAction) => void;
  onRename?: (id: string) => void;
  pinned?: boolean;
  selectionMode?: boolean;
  multiSelected?: boolean;
  onStartReorder?: (id: string) => string[];
  onDropReorder?: (targetId: string) => void;
  onToggleSelection?: (id: string) => void;
}): React.ReactElement {
  const dot = STATUS_DOT[s.status];
  const favicon = faviconUrl(s.primarySite);
  const last = s.lastActivityAt ?? s.createdAt;
  const [popupId, setPopupId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const singleDragArmedRef = useRef(false);

  const isRunning = s.status === 'running' || s.status === 'stuck';
  const isPaused = s.status === 'paused';
  const handleAction = (action: SidebarRowAction): void => {
    if (action === 'rename') {
      onRename?.(s.id);
      return;
    }
    onAction?.(s.id, action);
  };
  const handleRowClick = (): void => {
    if (selectionMode) onToggleSelection?.(s.id);
    else onSelect?.(s.id);
  };
  const toggleMenu = async (): Promise<void> => {
    const button = menuButtonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'menu',
        placement: 'bottom-end',
        width: 148,
        items: [
          { id: 'rerun', label: 'Re-run' },
          { id: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin' : 'Pin' },
          { id: 'rename', label: 'Rename' },
          ...(isPaused ? [{ id: 'resume', label: 'Resume' }] : []),
          ...(isRunning ? [{ id: 'pause', label: 'Pause' }] : []),
          ...((isRunning || isPaused) ? [{ id: 'stop', label: 'Stop', tone: 'danger' as const }] : []),
          { id: 'delete', label: 'Delete', tone: 'danger' as const },
        ],
      },
      {
        onAction: (action) => {
          if (action.kind === 'menu-select') handleAction(action.itemId as SidebarRowAction);
        },
        onClosed: () => setPopupId(null),
      },
    );
    if (nextId) setPopupId(nextId);
  };

  return (
    <div
      className={`sidebar__row-wrapper${popupId ? ' sidebar__row-wrapper--menu-open' : ''}`}
    >
      <button
        type="button"
        className={`sidebar__row has-tooltip${selected ? ' sidebar__row--active' : ''}${selectionMode ? ' sidebar__row--select-mode' : ''}${multiSelected ? ' sidebar__row--multi-selected' : ''}${dragOver ? ' sidebar__row--drag-over' : ''}${dragging ? ' sidebar__row--dragging' : ''}`}
        onClick={handleRowClick}
        onMouseDown={(event) => {
          const startedFromHandle = event.target instanceof Element && Boolean(event.target.closest('.sidebar__drag-handle'));
          singleDragArmedRef.current = !selectionMode && startedFromHandle;
          if (!selectionMode && !startedFromHandle) preventMouseFocus(event);
        }}
        draggable={!selectionMode || multiSelected}
        onDragStart={(event) => {
          if ((selectionMode && !multiSelected) || (!selectionMode && !singleDragArmedRef.current)) {
            event.preventDefault();
            return;
          }
          singleDragArmedRef.current = false;
          const ids = onStartReorder?.(s.id) ?? [s.id];
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', ids.join('\n'));
          setDragging(true);
        }}
        onDragEnd={() => { singleDragArmedRef.current = false; setDragging(false); setDragOver(false); }}
        onDragOver={(event) => {
          if (!onDropReorder) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          singleDragArmedRef.current = false;
          setDragOver(false);
          setDragging(false);
          onDropReorder?.(s.id);
        }}
        tabIndex={-1}
        aria-pressed={selectionMode ? multiSelected : selected}
        data-tooltip={sessionDisplayTitle(s)}
      >
        {selectionMode ? (
          <>
            <span className={`sidebar__select-check${multiSelected ? ' sidebar__select-check--checked' : ''}`}><CheckSquareIcon checked={multiSelected} /></span>
            {multiSelected && <span className="sidebar__drag-handle" aria-label="Drag selected sessions" title="Drag selected sessions"><DragHandleIcon /></span>}
          </>
        ) : (
          <span className="sidebar__row-icon">
            <RowIcon session={s} favicon={favicon} size={18} fallbackClass="sidebar__row-icon-fallback" />
            <span className="sidebar__row-dot" style={{ background: dot.color }} aria-label={dot.label} />
          </span>
        )}
        <span className="sidebar__row-title">{sessionDisplayTitle(s)}</span>
        {!selectionMode && onDropReorder && (
          <span
            className="sidebar__drag-handle sidebar__drag-handle--single"
            aria-label="Drag session to reorder"
            title="Drag to reorder"
            onClick={(event) => event.stopPropagation()}
          >
            <DragHandleIcon />
          </span>
        )}
        {pinned && (
          <span className="sidebar__row-pin" aria-label="Pinned" title="Pinned">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M6.2.9 9.1 3.8 7.9 5 7.4 8 5.6 6.2 2.4 9.4l-.6-.6L5 5.6 3.2 3.8 6.2.9Z" fill="currentColor" />
            </svg>
          </span>
        )}
        <span className="sidebar__row-time">{formatRelative(last)}</span>
      </button>

      {onAction && (
        <button
          ref={menuButtonRef}
          type="button"
          className="sidebar__row-menu-btn"
          onMouseDown={preventMouseFocus}
          onClick={(e) => {
            e.stopPropagation();
            void toggleMenu();
          }}
          tabIndex={-1}
          aria-label="Session actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(popupId)}
        >
          <MoreIcon />
        </button>
      )}
    </div>
  );
}

type TabBucket = 'active' | 'waiting' | 'done';

/**
 * Sidebar rows re-rendered on every session event because HubApp rebuilds
 * the `sessions` array (and these callback props) by reference each time —
 * so a single unrelated session emitting output re-rendered every row.
 * Five rows is cheap, but this list is meant to scale, and the fix is the
 * same one AgentPane uses: compare the session by the fields the row
 * actually shows, and ignore callback identity, since each callback takes
 * the session id as a call-time argument rather than closing over per-row
 * state.
 */
function sameRowSession(a: SidebarSession, b: SidebarSession): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.prompt === b.prompt &&
    a.title === b.title &&
    a.primarySite === b.primarySite &&
    a.lastActivityAt === b.lastActivityAt &&
    a.engine === b.engine &&
    a.error === b.error
  );
}

const SessionRow = React.memo(SessionRowImpl, (prev, next) =>
  prev.selected === next.selected
  && prev.pinned === next.pinned
  && prev.selectionMode === next.selectionMode
  && prev.multiSelected === next.multiSelected
  && sameRowSession(prev.s, next.s),
);

const TabChip = React.memo(TabChipImpl, (prev, next) =>
  prev.selected === next.selected && sameRowSession(prev.s, next.s),
);

function bucketFor(status: SessionStatus): TabBucket {
  if (status === 'running' || status === 'stuck') return 'active';
  if (status === 'idle' || status === 'draft') return 'waiting';
  return 'done';
}

function TabChipImpl({
  s,
  selected,
  onSelect,
}: {
  s: SidebarSession;
  selected: boolean;
  onSelect?: (id: string) => void;
}): React.ReactElement {
  const dot = STATUS_DOT[s.status];
  const favicon = faviconUrl(s.primarySite);
  const isRunning = s.status === 'running';
  const bucket = bucketFor(s.status);
  return (
    <button
      type="button"
      className={`tabstrip__chip has-tooltip${selected ? ' tabstrip__chip--active' : ''}${isRunning ? ' tabstrip__chip--running' : ''}`}
      onClick={() => onSelect?.(s.id)}
      onMouseDown={preventMouseFocus}
      tabIndex={-1}
      data-tooltip={sessionDisplayTitle(s)}
      data-status={s.status}
      data-bucket={bucket}
    >
      {isRunning && <span className="tabstrip__chip-fill" aria-hidden="true" />}
      <span className="tabstrip__chip-icon">
        <RowIcon session={s} favicon={favicon} size={14} fallbackClass="tabstrip__chip-icon-fallback" />
        <span className="tabstrip__chip-dot" style={{ background: dot.color }} aria-label={dot.label} />
      </span>
      <span className="tabstrip__chip-title">{sessionDisplayTitle(s)}</span>
    </button>
  );
}

export function Sidebar({ sessions, selectedId, onSelect, onNewAgent, onRowAction, onBulkDelete, onRename, manualOrderIds = [], onReorder, pinnedIds, mode = 'side' }: SidebarProps): React.ReactElement {
  const data = useMemo(() => {
    const byId = new Map<string, SidebarSession>();
    for (const session of sessions ?? MOCK_SIDEBAR_SESSIONS) byId.set(session.id, session);
    return [...byId.values()];
  }, [sessions]);

  const pinned = useMemo(() => pinnedIds ?? new Set<string>(), [pinnedIds]);
  const orderedSessions = useMemo(() => orderSessionsForSidebar(data, pinned, manualOrderIds), [data, pinned, manualOrderIds]);
  const orderedSessionsRef = useRef(orderedSessions);
  orderedSessionsRef.current = orderedSessions;
  const runningCount = useMemo(
    () => orderedSessions.filter((s) => s.status === 'running').length,
    [orderedSessions],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const pinnedIdsRef = useRef(pinned);
  pinnedIdsRef.current = pinned;
  const draggedIdsRef = useRef<string[]>([]);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const liveIds = new Set(data.map((session) => session.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);
  const filteredSessions = useMemo(() => {
    const needle = searchTerm.trim().toLocaleLowerCase();
    if (!needle) return orderedSessions;
    return orderedSessions.filter((session) => [
      sessionDisplayTitle(session),
      session.prompt,
      session.status,
      session.engine ?? '',
      session.id,
    ].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [orderedSessions, searchTerm]);
  const allVisibleSelected = filteredSessions.length > 0 && filteredSessions.every((session) => selectedIds.has(session.id));
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const startReorder = useCallback((id: string): string[] => {
    const selected = selectedIdsRef.current;
    const ids = selectionMode && selected.has(id)
      ? orderedSessionsRef.current.filter((session) => selected.has(session.id)).map((session) => session.id)
      : [id];
    draggedIdsRef.current = ids;
    return ids;
  }, [selectionMode]);
  const dropReorder = useCallback((targetId: string) => {
    const ids = draggedIdsRef.current;
    draggedIdsRef.current = [];
    if (ids.length > 0 && !ids.includes(targetId)) onReorder?.(ids, targetId);
  }, [onReorder]);
  const beginRename = useCallback((id: string) => {
    const session = orderedSessionsRef.current.find((candidate) => candidate.id === id);
    if (!session) return;
    setRenameDraft(sessionDisplayTitle(session));
    setRenameError('');
    setRenameSessionId(id);
  }, []);
  const closeRename = useCallback(() => {
    setRenameSessionId(null);
    setRenameError('');
  }, []);
  const saveRename = useCallback(async () => {
    if (!renameSessionId || !onRename) return;
    const title = renameDraft.trim();
    if (!title) {
      setRenameError('Enter a session name.');
      return;
    }
    try {
      await onRename(renameSessionId, title);
      closeRename();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Could not rename this session.');
    }
  }, [closeRename, onRename, renameDraft, renameSessionId]);
  const toggleSearch = useCallback(() => {
    if (searchOpen) setSearchTerm('');
    setSearchOpen(!searchOpen);
  }, [searchOpen]);
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((active) => {
      if (active) {
        setSelectedIds(new Set());
        setConfirmDeleteIds(null);
      }
      return !active;
    });
  }, []);
  const toggleAllVisible = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filteredSessions.forEach((session) => next.delete(session.id));
      else filteredSessions.forEach((session) => next.add(session.id));
      return next;
    });
  };
  const confirmBulkDelete = (): void => {
    if (!confirmDeleteIds?.length) return;
    onBulkDelete?.(confirmDeleteIds);
    setConfirmDeleteIds(null);
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  if (mode === 'top') {
    return (
      <nav className="tabstrip" aria-label="Agent sessions">
        <div className="tabstrip__chips">
          {orderedSessions.map((s) => (
            <TabChip key={s.id} s={s} selected={s.id === selectedId} onSelect={onSelect} />
          ))}
        </div>
        <button
          type="button"
          className="tabstrip__new has-tooltip"
          onClick={onNewAgent}
          onMouseDown={preventMouseFocus}
          tabIndex={-1}
          aria-label="New agent"
          data-tooltip="New agent"
        >
          <PlusIcon />
        </button>
      </nav>
    );
  }

  return (
    <aside className="sidebar" aria-label="Agent sessions">
      <button
        type="button"
        className="sidebar__new-agent"
        onClick={onNewAgent}
        onMouseDown={preventMouseFocus}
        tabIndex={-1}
      >
        <span className="sidebar__new-agent-icon" aria-hidden="true"><PlusIcon /></span>
        New agent
      </button>

      <div className="sidebar__header">
        <span className="sidebar__header-title">Agents</span>
        {/* Two numbers, and only when they say something: the total, and how
            many are actually working. A count of zero is already obvious from
            the empty list below. */}
        {orderedSessions.length > 0 && (
          <span className="sidebar__header-count">
            {runningCount > 0 && <span className="sidebar__header-running" />}
            {orderedSessions.length}
          </span>
        )}
        <div className="sidebar__header-actions">
          <button
            type="button"
            className={`sidebar__icon-btn has-tooltip${searchOpen ? ' sidebar__icon-btn--active' : ''}`}
            onClick={toggleSearch}
            tabIndex={-1}
            aria-label={searchOpen ? 'Close session search' : 'Search sessions'}
            aria-pressed={searchOpen}
            data-tooltip={searchOpen ? 'Close search' : 'Search sessions'}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className={`sidebar__icon-btn has-tooltip${selectionMode ? ' sidebar__icon-btn--active' : ''}`}
            onClick={toggleSelectionMode}
            tabIndex={-1}
            aria-label={selectionMode ? 'Exit multi-select' : 'Select multiple sessions'}
            aria-pressed={selectionMode}
            data-tooltip={selectionMode ? 'Done selecting' : 'Select sessions'}
          >
            {selectionMode ? <CloseIcon /> : <SelectModeIcon />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <label className="sidebar__search-row">
          <SearchIcon />
          <input
            autoFocus
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') toggleSearch(); }}
            placeholder="Find a session"
            aria-label="Find a session"
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear search">
              <CloseIcon />
            </button>
          )}
        </label>
      )}

      {selectionMode && (
        <div className="sidebar__selection-bar" role="toolbar" aria-label="Session selection actions">
          <span className="sidebar__selection-count" aria-live="polite">{selectedIds.size} selected</span>
          {selectedIds.size > 0 && <span className="sidebar__selection-hint">Drag to reorder</span>}
          <button
            type="button"
            className="sidebar__icon-btn has-tooltip"
            onClick={toggleAllVisible}
            tabIndex={-1}
            disabled={filteredSessions.length === 0}
            aria-label={allVisibleSelected ? 'Deselect all visible sessions' : 'Select all visible sessions'}
            data-tooltip={allVisibleSelected ? 'Deselect visible' : 'Select visible'}
          >
            <SelectAllIcon checked={allVisibleSelected} />
          </button>
          <button
            type="button"
            className="sidebar__icon-btn sidebar__icon-btn--danger has-tooltip"
            onClick={() => setConfirmDeleteIds([...selectedIds])}
            tabIndex={-1}
            disabled={selectedIds.size === 0}
            aria-label={`Delete ${selectedIds.size} selected sessions`}
            data-tooltip="Delete selected"
          >
            <TrashIcon />
          </button>
        </div>
      )}

      <div className="sidebar__groups">
        {filteredSessions.length === 0 ? (
          // An empty panel with a + in the corner leaves the user to work out
          // that the + is the way in. Say it.
          <div className="sidebar__empty">
            <span className="sidebar__empty-title">{orderedSessions.length === 0 ? 'No agents yet' : 'No sessions found'}</span>
            {orderedSessions.length === 0 ? (
              <span className="sidebar__empty-hint">
                Describe a task on the right, or press <kbd className="sidebar__kbd">+</kbd> to start one.
              </span>
            ) : (
              <button type="button" className="sidebar__clear-search" onClick={() => setSearchTerm('')}>Clear search</button>
            )}
          </div>
        ) : (
          <div className="sidebar__group-body">
            {filteredSessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                selected={s.id === selectedId}
                onSelect={onSelect}
                onAction={onRowAction}
                onRename={beginRename}
                pinned={pinned.has(s.id)}
                selectionMode={selectionMode}
                multiSelected={selectedIds.has(s.id)}
                onStartReorder={startReorder}
                onDropReorder={dropReorder}
                onToggleSelection={toggleSelected}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDeleteIds && (
        <div className="sidebar__dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDeleteIds(null); }}>
          <section className="sidebar__dialog" role="alertdialog" aria-modal="true" aria-labelledby="sidebar-delete-title" aria-describedby="sidebar-delete-copy">
            <h2 id="sidebar-delete-title">Delete {confirmDeleteIds.length} {confirmDeleteIds.length === 1 ? 'session' : 'sessions'}?</h2>
            <p id="sidebar-delete-copy">Their chat history and session files will be removed.</p>
            <div className="sidebar__dialog-actions">
              <button type="button" onClick={() => setConfirmDeleteIds(null)}>Cancel</button>
              <button type="button" className="sidebar__dialog-delete" onClick={confirmBulkDelete}>Delete</button>
            </div>
          </section>
        </div>
      )}

      {renameSessionId && (
        <div className="sidebar__dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRename(); }}>
          <section className="sidebar__dialog" role="dialog" aria-modal="true" aria-labelledby="sidebar-rename-title">
            <h2 id="sidebar-rename-title">Rename session</h2>
            <input
              ref={renameInputRef}
              autoFocus
              className="sidebar__rename-input"
              value={renameDraft}
              maxLength={120}
              onChange={(event) => { setRenameDraft(event.target.value); setRenameError(''); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                if (event.key === 'Escape') closeRename();
              }}
              aria-label="Session name"
            />
            {renameError && <p className="sidebar__dialog-error" role="alert">{renameError}</p>}
            <div className="sidebar__dialog-actions">
              <button type="button" onClick={closeRename}>Cancel</button>
              <button type="button" className="sidebar__dialog-save" onClick={() => void saveRename()}>Save name</button>
            </div>
          </section>
        </div>
      )}

    </aside>
  );
}

export default Sidebar;
