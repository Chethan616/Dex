import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Orb, type OrbState, TaskAvatar } from '../components/lib';
import { STATUS_LABEL } from './constants';
import { ContentRenderer, getPreview } from './ContentRenderer';
import { Markdown, linkifyOutputPaths } from './Markdown';
import { TerminalPane } from './TerminalPane';
import claudeCodeLogo from './claude-code-logo.svg';
import openaiLogoDark from './openai-logo.svg';
import openaiLogoLight from './openai-logo-light.svg';
import opencodeLogoDark from './opencode-logo-dark.svg';
import opencodeLogoLight from './opencode-logo-light.svg';
import { useThemedAsset } from '../design/useThemedAsset';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';
import { getPendingConfirmations, ConfirmationCard } from './PreviewDeck';
import { ChatView } from './chat/ChatView';
import { WorkspaceBar } from './workspace/WorkspaceBar';
import { NewTabPage } from './workspace/NewTabPage';
import { useWorkspaceTabs } from './workspace/useWorkspaceTabs';
import { useWorkspaceDocs } from './workspace/useWorkspaceDocs';
import { DocumentView } from './workspace/docs/DocumentView';
import { useHydrateSession } from './useSessionsQuery';
import type { AgentSession, OutputEntry } from './types';

const ENGINE_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  browsercode: 'BrowserCode',
  opencode: 'OpenCode',
};

function formatElapsed(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function isApiKeyError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('invalid_api_key') ||
    lower.includes('invalid api key') ||
    lower.includes('no api key') ||
    lower.includes('authentication_error') ||
    lower.includes('x-api-key') ||
    lower.includes('401')
  );
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('browsercode') || lower.includes('moonshot') || lower.includes('minimax') || lower.includes('qwen') || lower.includes('alibaba')) {
    if (isApiKeyError(raw)) return 'BrowserCode provider API key is missing or invalid. Update it in Settings.';
  }
  if (lower.includes('credit balance is too low') || lower.includes('insufficient_quota')) return 'API credits exhausted. Please add credits to your Anthropic account.';
  if (isApiKeyError(raw)) return 'Anthropic API key is missing or invalid. Update it in Settings.';
  if (lower.includes('rate_limit') || lower.includes('rate limit')) return 'Rate limited. Too many requests — try again in a moment.';
  if (lower.includes('overloaded') || lower.includes('529')) return 'API is overloaded. Try again shortly.';
  if (lower.includes('cancelled')) return 'Task was cancelled.';
  if (lower.includes('app exited unexpectedly')) return 'App exited unexpectedly during this task.';
  if (lower.includes('cdp') || lower.includes('browser session expired')) return 'Browser session expired. Start a new task.';
  return raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Display dollar amounts: sub-cent uses 4 decimals so tiny runs stay visible
// (e.g. $0.0023), single-dollar uses 3 decimals, larger rounds to cents.
function formatCostUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function BrowseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CodeIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 4L2 7l3 3M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="3.5" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function NetworkIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 7h11M7 1.5c-2 2-2 5 0 5s2 3 0 5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FileIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M8 1.5H4a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 004 12.5h6a1.5 1.5 0 001.5-1.5V5L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ToolGenericIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ErrorIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.5v3M7 9.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const BROWSER_KEYWORDS = /goto|nav|tab|click|scroll|hover|select|wait|back|forward|refresh|browse|page/i;
const CODE_KEYWORDS = /^js$|javascript|eval|exec|script|shell|bash|code|run_code/i;
const SCREENSHOT_KEYWORDS = /screen|capture|snap|photo/i;
const NETWORK_KEYWORDS = /http|fetch|request|api|curl|download|upload/i;
const FILE_KEYWORDS = /file|read|write|search|find|glob|grep|dir|folder|path/i;

function toolIcon(name?: string): React.ReactElement {
  if (!name) return <ToolGenericIcon />;
  if (CODE_KEYWORDS.test(name)) return <CodeIcon />;
  if (SCREENSHOT_KEYWORDS.test(name)) return <CameraIcon />;
  if (NETWORK_KEYWORDS.test(name)) return <NetworkIcon />;
  if (BROWSER_KEYWORDS.test(name)) return <BrowseIcon />;
  if (FILE_KEYWORDS.test(name)) return <FileIcon />;
  return <ToolGenericIcon />;
}

// Same keyword classification as toolIcon(), same precedence — one tool
// category, two renderings (a static glyph once it's done, a live orb while
// it's running), so they must never disagree about what a tool "is".
function toolOrbState(name?: string): OrbState {
  if (!name) return 'working';
  if (CODE_KEYWORDS.test(name)) return 'solving';
  if (SCREENSHOT_KEYWORDS.test(name)) return 'searching';
  if (NETWORK_KEYWORDS.test(name)) return 'connecting';
  if (BROWSER_KEYWORDS.test(name)) return 'connecting';
  if (FILE_KEYWORDS.test(name)) return 'shaping';
  return 'working';
}

function ToolStep({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  const hasResult = !!entry.result;
  const dur = entry.result?.duration;

  return (
    <div className={`step step--tool${hasResult ? '' : ' step--tool-active'}`}>
      <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
        <span className="step__icon">{toolIcon(entry.tool)}</span>
        <span className="step__name">{entry.tool}</span>
        {!hasResult && (
          <Orb size={20} state={toolOrbState(entry.tool)} className="step__spinner" />
        )}
        <span className="step__fill" />
        {dur != null && <span className="step__dur">{formatDuration(dur)}</span>}
      </div>
      {open && (
        <div className="step__detail">
          <ContentRenderer content={entry.content} type="tool_call" />
          {hasResult && (
            <>
              <div className="step__divider" />
              <ContentRenderer content={entry.result!.content} type="tool_result" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolGroup({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  const count = entry.groupCount ?? 0;
  const children = entry.groupEntries ?? [];

  return (
    <div className="step step--tool-group">
      <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
        <span className="step__icon">{toolIcon(entry.tool)}</span>
        <span className="step__name">{entry.tool}</span>
        <span className="step__badge">{count}</span>
        <span className="step__fill" />
      </div>
      {open && (
        <div className="step__group-children">
          {children.map((child) => (
            <ToolStep key={child.id} entry={child} />
          ))}
        </div>
      )}
    </div>
  );
}

// Cached editor list — fetched once per renderer load.
// Filter out editors we don't want to expose (Xcode etc.) defensively here so
// the UI updates without waiting for a main-process restart to flush its cache.
const EDITOR_BLOCKLIST = new Set(['xcode']);
let editorsPromise: Promise<Array<{ id: string; name: string }>> | null = null;
function getEditors(): Promise<Array<{ id: string; name: string }>> {
  if (!editorsPromise) {
    const base = window.electronAPI?.sessions?.listEditors?.() ?? Promise.resolve([]);
    editorsPromise = base.then((list) => list.filter((e) => !EDITOR_BLOCKLIST.has(e.id)));
  }
  return editorsPromise;
}

function formatFileSize(n: number | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function FileOutputRow({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [editors, setEditors] = useState<Array<{ id: string; name: string }>>([]);
  const [popupId, setPopupId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { getEditors().then(setEditors).catch(() => setEditors([])); }, []);

  const onOpenInEditor = useCallback(async (editorId: string) => {
    console.log('[file_output] onOpenInEditor click', { editorId, path: entry.tool });
    if (!entry.tool) {
      console.warn('[file_output] onOpenInEditor: entry.tool is falsy; aborting');
      return;
    }
    const api = window.electronAPI?.sessions?.openInEditor;
    if (!api) {
      console.error('[file_output] window.electronAPI.sessions.openInEditor is undefined — preload bridge missing');
      return;
    }
    try {
      const res = await api(editorId, entry.tool);
      console.log('[file_output] openInEditor success', res);
    } catch (err) {
      console.error('[file_output] openInEditor failed', err);
      // Fallback so the user gets *some* response: reveal the file in Finder
      // so they can open it manually.
      try { await window.electronAPI?.sessions?.revealOutput?.(entry.tool); }
      catch (revealErr) { console.error('[file_output] reveal fallback also failed', revealErr); }
    }
  }, [entry.tool]);

  const onRevealInFinder = useCallback(async () => {
    if (!entry.tool) return;
    try { await window.electronAPI?.sessions?.revealOutput?.(entry.tool); }
    catch (err) { console.error('[file_output] reveal failed', err); }
  }, [entry.tool]);

  const toggleMenu = useCallback(async () => {
    const button = buttonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'menu',
        placement: 'top-end',
        width: 220,
        items: [
          ...editors.map((editor) => ({
            id: `editor:${editor.id}`,
            label: `Open in ${editor.name}`,
            icon: { type: 'editor' as const, id: editor.id },
          })),
          {
            id: 'reveal',
            label: 'Reveal in Finder',
            icon: { type: 'finder' as const },
            separatorBefore: editors.length > 0,
          },
        ],
      },
      {
        onAction: (action) => {
          if (action.kind !== 'menu-select') return;
          if (action.itemId.startsWith('editor:')) void onOpenInEditor(action.itemId.slice('editor:'.length));
          if (action.itemId === 'reveal') void onRevealInFinder();
        },
        onClosed: () => setPopupId(null),
      },
    );
    if (nextId) setPopupId(nextId);
  }, [editors, onOpenInEditor, onRevealInFinder, popupId]);

  return (
    <div className="step step--file-output">
      <span className="step__icon">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M8 1.5H4a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 004 12.5h6a1.5 1.5 0 001.5-1.5V5L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="step__skill-label">Produced file</span>
      <span className="step__skill-topic" title={entry.tool}>{entry.content}</span>
      <span className="step__file-size">{formatFileSize(entry.fileSize)}</span>
      <div className="step__file-ide">
        <button
          ref={buttonRef}
          className="step__file-download step__file-ide-toggle"
          onClick={(e) => { e.stopPropagation(); void toggleMenu(); }}
          aria-haspopup="menu"
          aria-expanded={Boolean(popupId)}
        >
          Open in {'\u25BE'}
        </button>
      </div>
    </div>
  );
}

function OutputRow({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  if (entry.type === 'thinking') {
    return (
      <div className="step step--thinking">
        <div className="step__thinking-header">
          <Orb size={20} state="composing" />
          <span className="step__thinking-label">Thinking</span>
        </div>
        <div className="step__text">
          <Markdown source={linkifyOutputPaths(entry.content)} />
        </div>
      </div>
    );
  }

  if (entry.type === 'tool_call') {
    if (entry.groupCount && entry.groupCount > 1) {
      return <ToolGroup entry={entry} />;
    }
    return <ToolStep entry={entry} />;
  }

  if (entry.type === 'tool_result') {
    const dur = entry.duration;
    return (
      <div className="step step--tool">
        <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
          <span className="step__icon">{toolIcon(entry.tool)}</span>
          <span className="step__name">{entry.tool}</span>
          <span className="step__fill" />
          {dur != null && <span className="step__dur">{formatDuration(dur)}</span>}
        </div>
        {open && (
          <div className="step__detail">
            <ContentRenderer content={entry.content} type="tool_result" />
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'skill_written') {
    const label = entry.harnessAction === 'patch' ? 'Edited skill' : 'Wrote skill';
    return (
      <div className="step step--skill">
        <span className="step__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 11.5V3a1.5 1.5 0 011.5-1.5h7A1.5 1.5 0 0112 3v7a1.5 1.5 0 01-1.5 1.5h-7L2 11.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M5 5h4M5 7.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="step__skill-label">{label}</span>
        <span className="step__skill-topic">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'skill_used') {
    return (
      <div className="step step--skill-used">
        <span className="step__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3h10v8H2z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="step__skill-label">Read skill</span>
        <span className="step__skill-topic">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'harness_edited') {
    const isHelpers = entry.harnessTarget === 'helpers';
    const verb = entry.harnessAction === 'patch' ? 'Patched' : 'Updated';
    const addedCount = entry.added?.length ?? 0;
    const removedCount = entry.removed?.length ?? 0;
    const changedCount = entry.changed?.length ?? 0;
    const diffParts: string[] = [];
    if (addedCount) diffParts.push(`+${addedCount}`);
    if (removedCount) diffParts.push(`-${removedCount}`);
    if (changedCount) diffParts.push(`~${changedCount}`);
    const diffSummary = diffParts.length ? ` (${diffParts.join(' ')})` : '';
    const title = (entry.added ?? []).concat(entry.changed ?? []).concat((entry.removed ?? []).map((n) => `-${n}`)).join(', ');
    return (
      <div className="step step--harness" title={title || undefined}>
        <span className="step__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2v10M11 2v10M3 4h8M3 10h8M5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="step__skill-label">{verb} harness</span>
        <span className="step__skill-topic">{isHelpers ? 'helpers.js' : `AGENTS.md${diffSummary}`}</span>
      </div>
    );
  }

  if (entry.type === 'file_output') {
    return <FileOutputRow entry={entry} />;
  }

  if (entry.type === 'notify') {
    const isBlocking = entry.level === 'blocking';
    return (
      <div className={`step step--notify${isBlocking ? ' step--notify-blocking' : ' step--notify-info'}`}>
        <span className="step__text">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'user_input') {
    return (
      <div className="step step--user-input">
        <span className="step__user-chevron">&rsaquo;</span>
        <span className="step__user-text">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'done') {
    return null as unknown as React.ReactElement;
  }

  if (entry.type === 'error') {
    return (
      <div className="step step--error">
        <span className="step__text">{entry.content}</span>
      </div>
    );
  }

  return (
    <div className="step step--output">
      <div className="step__text">
        <Markdown source={entry.content} />
      </div>
    </div>
  );
}

function BrowserIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3.5" cy="4" r="0.5" fill="currentColor" />
      <circle cx="5.5" cy="4" r="0.5" fill="currentColor" />
    </svg>
  );
}

function OutputIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3 4h8M3 7h6M3 10h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SplitIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2" width="11" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="7.5" width="11" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CopyIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RerunIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M2 7a5 5 0 019.33-2.5M12 7a5 5 0 01-9.33 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 2v3h-3M3 12V9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ResumeIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M5 3.5v7L10.5 7 5 3.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="3" width="2" height="8" rx="0.6" fill="currentColor" />
      <rect x="8" y="3" width="2" height="8" rx="0.6" fill="currentColor" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface AgentPaneProps {
  session: AgentSession;
  focused?: boolean;
  onRerun?: (sessionId: string) => void;
  onResume?: (sessionId: string) => void;
  onPause?: (sessionId: string) => void;
  onFollowUp?: (sessionId: string, prompt: string, attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>) => void;
  onDismiss?: (sessionId: string) => void;
  onCancel?: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
  onOpenFollowUp?: () => void;
  onOpenSettings?: () => void;
  followUpShortcut?: string;
  cycleShortcut?: string;
}

function AgentPaneImpl({ session, focused, onRerun, onResume, onPause, onFollowUp, onDismiss, onCancel, onSelect, onOpenFollowUp, onOpenSettings, followUpShortcut, cycleShortcut }: AgentPaneProps): React.ReactElement {
  const openaiLogo = useThemedAsset(openaiLogoDark, openaiLogoLight);
  const opencodeLogo = useThemedAsset(opencodeLogoDark, opencodeLogoLight);
  const paneRef = useRef<HTMLDivElement>(null);
  /**
   * Whether a WebContentsView is currently attached to this pane, and
   * whether that attach actually succeeded. These have to survive the
   * bounds effect below being torn down and recreated — which happens on
   * every deckActive change, including "a confirmation just became
   * pending" — because the native view itself is main-process state that
   * doesn't reset just because the effect closure did. A plain `let` inside
   * the effect forgot "yes, a view is attached" the moment deckActive
   * flipped true, so the code never issued the viewDetach call the deck
   * needed to actually become visible: the confirmation card rendered, but
   * underneath the still-attached live page, which composites above React
   * regardless of what React thinks should be showing.
   */
  const hasAttachedRef = useRef(false);
  const attachSucceededRef = useRef(false);
  const [browserDead, setBrowserDead] = useState(false);
  const [browserMissing, setBrowserMissing] = useState(false);
  const [frameRect, setFrameRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /**
   * The user asked for the browser back.
   *
   * Resuming hands the task to the agent, which is not the same thing as
   * wanting to carry on browsing yourself — after a task ends you often want
   * to keep clicking around the page it left open. The deck would otherwise
   * hold the rect for as long as the session has anything to show, with no way
   * to reach the page underneath.
   */
  /**
   * Chat or page (docs/unify/PLAN.md §3.12). Your own pick wins until the next
   * run starts; otherwise a running task that has opened a page shows the
   * page, and everything else — a finished task, a desktop or file task, a
   * paused one — shows the conversation. The page isn't lost when the chat
   * has the rect: it's parked on the stage, where DEX can keep using it.
   */
  const [paneOverride, setPaneOverride] = useState<'auto' | 'page' | 'chat' | 'doc'>('auto');
  /**
   * Document tabs (docs/unify/PLAN.md §3.9): files drawn by the hub itself.
   * One in front owns the rect like the chat does; the page steps aside to
   * the stage. A doc someone just opened — you from a file card, or DEX with
   * `dex-open` — comes to the front.
   */
  const workspaceDocs = useWorkspaceDocs(session.id);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceDocs.focus) return;
    setActiveDocId(workspaceDocs.focus.id);
    setPaneOverride('doc');
  }, [workspaceDocs.focus]);
  const activeDoc = paneOverride === 'doc' ? workspaceDocs.docs.find((d) => d.id === activeDocId) : undefined;
  const docActive = Boolean(activeDoc);
  // The doc in front was closed (here, or by its task going away).
  useEffect(() => {
    if (paneOverride === 'doc' && !activeDoc) setPaneOverride('auto');
  }, [paneOverride, activeDoc]);
  const closeDoc = useCallback((docId: string) => {
    if (docId === activeDocId) {
      // Next to the right, else to the left, else back to the usual surface.
      const list = workspaceDocs.docs;
      const i = list.findIndex((d) => d.id === docId);
      const next = list[i + 1] ?? list[i - 1];
      if (next) setActiveDocId(next.id);
      else setPaneOverride('auto');
    }
    void window.electronAPI?.workspace?.docClose(session.id, docId);
  }, [activeDocId, workspaceDocs.docs, session.id]);
  // The conversation needs the whole history, not just what streamed in.
  useHydrateSession(session.id);
  // The follow-up shortcut: to the chat, cursor in the composer.
  const [composerFocus, setComposerFocus] = useState(0);
  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== session.id) return;
      setPaneOverride('chat');
      setComposerFocus((n) => n + 1);
    };
    window.addEventListener('dex:focus-composer', onFocus);
    return () => window.removeEventListener('dex:focus-composer', onFocus);
  }, [session.id]);
  const chatActive = useMemo(() => {
    if (docActive) return false;
    if (session.hasBrowser === false) return true;
    if (paneOverride !== 'auto') return paneOverride === 'chat';
    const working = session.status === 'running' || session.status === 'stuck';
    return !(working && session.primarySite);
  }, [docActive, session.hasBrowser, session.status, session.primarySite, paneOverride]);

  /**
   * The task's tabs (docs/unify/PLAN.md §3.2). A blank tab *you* opened shows
   * DEX's New-tab page in the rect, like the deck does: the native view steps
   * aside for React. The task's own first tab stays on the old rules above.
   */
  const workspaceOn = session.hasBrowser !== false && !browserDead;
  const tabs = useWorkspaceTabs(session.id, workspaceOn);
  const activeTab = tabs.find((t) => t.active);
  const newTabActive = !chatActive && !docActive && Boolean(activeTab?.isNewTab && activeTab.openedBy !== 'task');
  /** Something React draws owns the rect (the chat, a document, or the New-tab page). */
  const surfaceActive = chatActive || docActive || newTabActive;

  /** Something new in the chat while you were on the page: a dot on the Chat tab. */
  const replyCount = useMemo(
    () => session.output.filter((e) => e.type === 'done' || e.type === 'file_output' || e.type === 'canvas' || e.type === 'artifact' || e.type === 'error').length,
    [session.output],
  );
  const seenReplyCountRef = useRef(0);
  useEffect(() => {
    if (chatActive) seenReplyCountRef.current = replyCount;
  }, [chatActive, replyCount]);
  useEffect(() => {
    seenReplyCountRef.current = 0;
  }, [session.id]);
  const chatUnread = !chatActive && replyCount > seenReplyCountRef.current;

  // Rendered in the header/chrome below, not inside the deck — see the doc
  // comment on ConfirmationCard in PreviewDeck.tsx for why.
  const pendingConfirmations = useMemo(() => getPendingConfirmations(session), [session]);

  // A new run is the agent taking the pane back, so the deck should return
  // with it — otherwise starting a task after browsing looks like nothing
  // happened.
  useEffect(() => {
    if (session.status === 'running') setPaneOverride('auto');
  }, [session.status]);
  useEffect(() => {
    setPaneOverride('auto');
  }, [session.id]);
  // Logs overlay is a separate window (see logsPill.ts). The pane tracks
  // visibility only to reflect it in the Logs button's active state.
  const [logsOpen, setLogsOpen] = useState(false);
  const computeBounds = useCallback((): { x: number; y: number; width: number; height: number; slotWidth: number } | null => {
    const el = paneRef.current?.querySelector('.pane__output') as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const fullWidth = Math.round(rect.width);
    const slotWidth = fullWidth;
    const border = 1;
    return {
      x: Math.round(rect.x) + border,
      y: Math.round(rect.y) + border,
      width: slotWidth - border * 2,
      height: Math.round(rect.height) - border * 2,
      slotWidth,
    };
  }, []);

  useEffect(() => {
    if (session.status === 'running') {
      setBrowserDead(false);
    }
  }, [session.id, session.status]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on?.sessionBrowserGone) return;
    const off = api.on.sessionBrowserGone((id) => {
      if (id === session.id) {
        console.log('[AgentPane] browser-gone signal', { id });
        setBrowserDead(true);
        // Keep frameRect — the "Browser ended" overlay needs it to paint.
        // Without it the empty .pane__output area shows as black with no label.
      }
    });
    return off;
  }, [session.id]);

  const handleToggleLogs = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.logs) return;
    const outEl = paneRef.current?.querySelector('.pane__output') as HTMLElement | null;
    const rect = outEl?.getBoundingClientRect();
    const anchor = rect
      ? { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      : undefined;
    void api.logs.toggle(session.id, anchor).then((nowOpen) => setLogsOpen(nowOpen));
  }, [session.id]);

  useEffect(() => {
    const paneEl = paneRef.current;
    if (!paneEl) return;
    const api = window.electronAPI;
    if (!api) return;
    if (browserDead) {
      // Dead browser — ensure any lingering view is detached.
      // Keep frameRect so the "Browser ended" overlay can paint over the
      // pane__output slot; nulling it leaves the pane black with no label.
      api.sessions.viewDetach(session.id).catch(() => {});
      hasAttachedRef.current = false;
      attachSucceededRef.current = false;
      return;
    }

    // Reset every time this effect (re)starts so the first bounds
    // computation below always runs its body at least once, even if the
    // geometry hasn't actually changed since the last instance — that first
    // run is what re-evaluates the attach/detach decision against the
    // current deckActive, using hasAttachedRef/attachSucceededRef (declared
    // outside this effect) rather than a value that would otherwise forget
    // whatever the previous instance left attached.
    let lastKey = '';
    let rafScheduled = 0;
    const applyBounds = () => {
      rafScheduled = 0;
      const outEl = paneEl.querySelector('.pane__output') as HTMLElement | null;
      if (!outEl) return;
      const computed = computeBounds();
      if (!computed) return;
      const { slotWidth, ...bounds } = computed;
      const key = `${bounds.x}|${bounds.y}|${bounds.width}|${bounds.height}`;
      if (key === lastKey) return;
      lastKey = key;
      // No overlay over the page any more: you and DEX share it (docs/unify
      // PLAN §3.4). While DEX drives, .pane__output--agent draws a glow
      // around the rect, and the workspace bar says so, with Pause.
      if (surfaceActive) {
        // The chat or the New-tab page owns the rect: the page steps aside
        // (to the stage, where the agent can still use it). Bounds measurement below still runs, so it's
        // positioned exactly where the browser would have been.
        if (hasAttachedRef.current) {
          hasAttachedRef.current = false;
          attachSucceededRef.current = false;
          api.sessions.viewDetach(session.id).catch(() => {});
        }
      } else if (!hasAttachedRef.current) {
        hasAttachedRef.current = true;
        api.sessions.viewAttach(session.id, bounds).then((ok) => {
          attachSucceededRef.current = ok;
          setBrowserMissing(!ok);
        }).catch(() => {
          hasAttachedRef.current = false;
          attachSucceededRef.current = false;
        });
      } else {
        api.sessions.viewResize(session.id, bounds);
      }
      const p = paneEl.getBoundingClientRect();
      const o = outEl.getBoundingClientRect();
      setFrameRect({
        left: Math.round(o.left - p.left),
        top: Math.round(o.top - p.top),
        width: slotWidth,
        height: Math.round(o.height),
      });
      // The Logs window (opened with its button) follows the pane.
      const logsAnchor = {
        x: Math.round(o.left),
        y: Math.round(o.top),
        width: Math.round(o.width),
        height: Math.round(o.height),
      };
      if (logsAnchor.width > 0 && logsAnchor.height > 0) {
        api.logs?.updateAnchor?.(logsAnchor);
      }
    };
    // Coalesce rapid ResizeObserver / layout callbacks into one IPC per frame.
    const updateBounds = () => {
      if (rafScheduled) return;
      rafScheduled = requestAnimationFrame(applyBounds);
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(paneEl, { box: 'border-box' });
    // .pane__output's OWN size can change without paneEl's outer size
    // changing at all — e.g. the confirmation bar appearing in the header
    // pushes .pane__output down and shrinks it, but the pane's overall
    // footprint in the grid is unaffected, so a ResizeObserver watching only
    // paneEl never fires. The native view then keeps whatever bounds were
    // last correct, which is exactly the "browser view rendered in a narrow
    // misaligned strip" bug once a confirmation card started appearing in
    // the header instead of inside .pane__output.
    const outElForObserver = paneEl.querySelector('.pane__output') as HTMLElement | null;
    if (outElForObserver) observer.observe(outElForObserver, { box: 'border-box' });

    // ResizeObserver misses position-only changes (e.g. sibling pane dismissed
    // causes a grid reflow without this pane resizing). HubApp dispatches
    // pane:layout-change when the session list or grid layout changes — we
    // re-read bounds across a few frames to catch any CSS transition.
    const onLayoutChange = () => {
      // Layout just changed (grid columns, page, session list). Force the next
      // bounds call through the viewAttach path so if the WebContentsView was
      // silently detached (e.g. by temporarilyDetachAll for pill/settings), it
      // gets re-added. Bounds are always set BEFORE addChildView so there's no
      // stale-position flash.
      hasAttachedRef.current = false;
      lastKey = '';
      updateBounds();
      requestAnimationFrame(updateBounds);
      setTimeout(updateBounds, 120);
    };
    window.addEventListener('pane:layout-change', onLayoutChange);

    return () => {
      observer.disconnect();
      window.removeEventListener('pane:layout-change', onLayoutChange);
      if (rafScheduled) cancelAnimationFrame(rafScheduled);
    };
  }, [session.id, computeBounds, browserDead, session.status, session.primarySite, surfaceActive]);

  useEffect(() => {
    return () => {
      const api = window.electronAPI;
      if (!api) return;
      console.log('[AgentPane] unmount -> detach', { id: session.id });
      api.sessions.viewDetach(session.id).catch(() => {});
    };
  }, [session.id]);

  // Browser shortcuts while the hub itself has focus (the page handles the
  // same keys in main when it has focus): Ctrl+T/W/L/R, Ctrl+Tab. With a
  // document in front, Ctrl+W closes the document and there's no page to reload.
  const frontDocId = activeDoc?.id;
  useEffect(() => {
    if (!focused || (!workspaceOn && !frontDocId)) return;
    const api = window.electronAPI?.workspace;
    if (!api) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
      const key = e.key.toLowerCase();
      if (frontDocId && (key === 'w' || key === 'r')) {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'w') closeDoc(frontDocId);
        return;
      }
      if (!workspaceOn) return;
      const shortcut: WorkspaceShortcut | null =
        key === 't' ? 'new-tab'
          : key === 'w' ? 'close-tab'
            : key === 'l' ? 'focus-address'
              : key === 'tab' ? (e.shiftKey ? 'prev-tab' : 'next-tab')
                : key === 'r' && !typing ? 'reload'
                  : null;
      if (!shortcut) return;
      e.preventDefault();
      e.stopPropagation();
      void api.shortcut(session.id, shortcut);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [focused, workspaceOn, session.id, frontDocId, closeDoc]);

  const engineName = session.engine ? ENGINE_NAMES[session.engine] ?? session.engine : 'DEX';
  const engineIcon = session.engine === 'claude-code' ? claudeCodeLogo
    : session.engine === 'codex' ? openaiLogo
      : session.engine === 'browsercode' ? opencodeLogo
        : undefined;
  const tabUrls = useMemo(() => tabs.map((t) => t.url).filter(Boolean), [tabs]);
  const elapsed = formatElapsed(session.createdAt);
  const statusText = STATUS_LABEL[session.status] ?? session.status;
  const isCancellation = !!session.error && session.error.toLowerCase().includes('cancel');
  const showErrorUi = !!session.error && !isCancellation;
  const isRunningLike = session.status === 'running' || session.status === 'stuck';
  const isPaused = session.status === 'paused';
  const canResume = Boolean(
    onResume &&
    session.canResume === true &&
    (
      session.status === 'paused' ||
      (
        (session.status === 'idle' || session.status === 'stopped') &&
        (browserDead || browserMissing || session.status === 'stopped')
      )
    ),
  );

  useEffect(() => {
    if (!focused || (!isRunningLike && !isPaused) || (!onPause && !onCancel)) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key.toLowerCase() !== 'c' || !e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (isPaused) {
        onCancel?.(session.id);
      } else {
        onPause?.(session.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [focused, isPaused, isRunningLike, onCancel, onPause, session.id]);

  return (
    <div
      ref={paneRef}
      className={`pane pane--${session.status}${focused ? ' pane--focused' : ''}`}
      onClick={() => onSelect?.(session.id)}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault();
      }}
    >
      <div className="pane__header">
        {/* The agent's face: shape from the engine, hopping while it works,
            asleep while paused. The status dot rides its corner. */}
        <span className="pane__avatar">
          <TaskAvatar session={session} size={30} interactive={focused} />
          <span className={`pane__dot pane__dot--${session.status}`} />
        </span>
        <div className="pane__title-group">
          <span className="pane__prompt">{session.prompt}</span>
          {session.engine === 'codex' && (
            <img className="pane__engine-icon" src={openaiLogo} alt="Codex" title="Codex" />
          )}
          {session.engine === 'browsercode' && (
            <img className="pane__engine-icon" src={opencodeLogo} alt="BrowserCode" title="BrowserCode" />
          )}
          {session.engine === 'claude-code' && (
            <img className="pane__engine-icon" src={claudeCodeLogo} alt="Claude Code" title="Claude Code" />
          )}
          {session.model && session.engine === 'browsercode' && (
            <span className="pane__model-badge" title={`Model: ${session.model}`}>
              {session.model.includes('/') ? session.model.split('/').pop() : session.model}
            </span>
          )}
          {session.authMode && (
            <span
              className={`pane__auth-badge pane__auth-badge--${session.authMode}`}
              title={
                session.authMode === 'subscription'
                  ? `Ran under ${session.subscriptionType ?? 'subscription'} OAuth`
                  : 'Ran under saved API key'
              }
            >
              {session.authMode === 'subscription' ? 'SUBSCRIPTION' : 'KEY'}
            </span>
          )}
          {/* Cost chip is hidden under subscription auth (Claude Code / Codex
              OAuth) — billing is covered by the subscription, so the
              API-equivalent figure is noise. Only show for direct API-key
              auth where the user is actually paying per-token. */}
          {typeof session.costUsd === 'number' && session.costUsd > 0 && session.authMode !== 'subscription' && (
            <span
              className="pane__cost"
              title={
                session.costSource === 'estimated'
                  ? `Estimated from token count × local price table · ${session.inputTokens ?? 0} in / ${session.outputTokens ?? 0} out`
                  : `${session.inputTokens ?? 0} in / ${session.outputTokens ?? 0} out`
              }
            >
              {session.costSource === 'estimated' ? '~' : ''}
              {formatCostUsd(session.costUsd)}
            </span>
          )}
        </div>
        <div className="pane__actions">
          {browserDead && (
            <span className="pane__action-btn pane__action-btn--disabled">
              <BrowserIcon />
              <span>Browser ended</span>
            </span>
          )}
          <button
            className={`pane__action-btn${logsOpen ? ' pane__action-btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleToggleLogs(); }}
            aria-label="Toggle logs overlay"
            data-tip="Toggle logs overlay"
          >
            <SplitIcon />
            <span>Logs</span>
          </button>
          {onRerun && (
            <button
              className="pane__action-btn pane__action-btn--icon"
              onClick={(e) => { e.stopPropagation(); onRerun(session.id); }}
              aria-label="Rerun"
              data-tip="Rerun"
            >
              <RerunIcon />
            </button>
          )}
          {canResume && (
            <button
              className="pane__action-btn pane__action-btn--icon pane__action-btn--primary"
              onClick={(e) => { e.stopPropagation(); onResume?.(session.id); }}
              aria-label="Resume"
              data-tip="Resume"
            >
              <ResumeIcon />
            </button>
          )}
          {isRunningLike && onPause && (
            <button
              className="pane__action-btn pane__action-btn--icon"
              onClick={(e) => { e.stopPropagation(); onPause(session.id); }}
              aria-label="Pause"
              data-tip="Pause"
            >
              <PauseIcon />
            </button>
          )}
          {(isRunningLike || isPaused) && onCancel && (
            <button
              className="pane__action-btn pane__action-btn--icon pane__action-btn--danger"
              onClick={(e) => { e.stopPropagation(); onCancel(session.id); }}
              aria-label="Stop"
              data-tip="Stop"
            >
              <CloseIcon />
            </button>
          )}
          {!isRunningLike && !isPaused && onDismiss && (
            <button
              className="pane__action-btn pane__action-btn--icon pane__action-btn--danger"
              onClick={(e) => { e.stopPropagation(); onDismiss(session.id); }}
              aria-label="Close"
              data-tip="Close"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
      <div className="pane__meta">
        <span className="pane__status">{statusText}</span>
        <span className="pane__sep" />
        <span className="pane__elapsed">{elapsed}</span>
        {session.group && (
          <>
            <span className="pane__sep" />
            <span className="pane__group">{session.group}</span>
          </>
        )}
      </div>

      <div className="pane__progress" aria-hidden="true">
        {session.status === 'running' && <div className="pane__progress-bar" />}
      </div>

      {/* Always here, regardless of deckActive/browseHere/logsOpen — this is
          plain pane chrome, not part of .pane__output, so neither the native
          WebContentsView nor the floating Logs window (both of which anchor
          to .pane__output and composite above it) can ever sit on top of it.
          A blocking human decision has to be reachable no matter what else
          is currently occupying the pane. */}
      {pendingConfirmations.length > 0 && (
        <div className="pane__confirm-bar">
          {pendingConfirmations.map((event) => (
            <ConfirmationCard sessionId={session.id} event={event} key={event.id} />
          ))}
        </div>
      )}

      {/* The pane's non-browser surface. Shown when no live page occupies the
          rect — the pre-existing idle/error states, plus the two new ones the
          deck introduces: a running task that has never navigated (desktop,
          file or OS work) and a paused session. */}
      {((tabs.length > 0 && workspaceOn) || workspaceDocs.docs.length > 0) && (
        <WorkspaceBar
          sessionId={session.id}
          tabs={workspaceOn ? tabs : []}
          browser={workspaceOn}
          docs={{
            items: workspaceDocs.docs,
            activeId: activeDoc?.id ?? null,
            onSelect: (id) => { setActiveDocId(id); setPaneOverride('doc'); },
            onClose: closeDoc,
          }}
          agentActive={session.status === 'running'}
          onPause={onPause ? () => onPause(session.id) : undefined}
          chat={{
            active: chatActive,
            unread: chatUnread,
            working: isRunningLike,
            onSelect: () => setPaneOverride('chat'),
            icon: <TaskAvatar session={session} size={18} interactive={false} />,
          }}
          onSelectPage={() => setPaneOverride('page')}
        />
      )}

      {frameRect && !surfaceActive && (showErrorUi || browserDead || browserMissing || session.status === 'draft' || session.status === 'stopped' || session.status === 'idle' || session.status === 'stuck') && (() => {
        const isStarting = !showErrorUi && !browserDead && !browserMissing && session.status === 'draft';
        const browserLine = browserDead
          ? 'Browser ended'
          : browserMissing
            ? (session.status === 'stopped' || session.status === 'idle' || session.status === 'stuck' ? 'Browser stopped' : 'No browser started yet')
            : (session.status === 'stopped' || session.status === 'idle' || session.status === 'stuck' ? 'Browser ended' : null);
        const primaryLine = showErrorUi
          ? friendlyError(session.error!)
          : isCancellation
            ? 'Task was cancelled.'
            : browserLine;
        const subLine = (showErrorUi || isCancellation) ? browserLine : null;
        // Offering to hand the rect back only makes sense while the deck is
        // holding it and there is still a live browser underneath to hand back.
        const showActions = !isStarting && (onRerun || canResume || (showErrorUi && isApiKeyError(session.error) && onOpenSettings));
        const placeholder = (
            <div className="pane__browser-starting">
              {showErrorUi && (
                <div className="pane__error-icon">
                  <ErrorIcon />
                </div>
              )}
              <span className="pane__browser-starting-row">
                {isStarting ? (
                  <>
                    <Orb size={64} state="connecting" className="pane__spinner" />
                    <span>Browser starting…</span>
                  </>
                ) : (
                  <span>{primaryLine}</span>
                )}
              </span>
              {subLine && primaryLine !== subLine && (
                <span className="pane__browser-subline">{subLine}</span>
              )}
              {showActions && (
                <div className="pane__browser-actions">
                  {canResume && (
                    <button
                      className="pane__rerun-btn pane__rerun-btn--primary"
                      onClick={() => onResume?.(session.id)}
                    >
                      <ResumeIcon />
                      <span>Resume</span>
                    </button>
                  )}
                  {showErrorUi && isApiKeyError(session.error) && onOpenSettings && (
                    <button className="pane__rerun-btn" onClick={onOpenSettings}>
                      <span>Open Settings</span>
                    </button>
                  )}
                  {onRerun && (
                    <button
                      className="pane__rerun-btn"
                      onClick={() => onRerun(session.id)}
                    >
                      <RerunIcon />
                      <span>Rerun task</span>
                    </button>
                  )}
                </div>
              )}
            </div>
        );
        return (
          <div
            className="pane__browser-frame"
            style={{
              left: frameRect.left,
              top: frameRect.top,
              width: frameRect.width,
              height: frameRect.height,
            }}
          >
            {placeholder}
          </div>
        );
      })()}
      {/* The deck is flow content inside the slot, not an absolutely
          positioned overlay. The native browser view is detached whenever the
          deck is showing, so there is nothing to sit on top of — and a rect
          measured at the wrong moment was drawing the cards into a narrow
          strip with the rest of the pane left black. */}
      <div className={`pane__output${session.status === 'running' && !surfaceActive ? ' pane__output--agent' : ''}${chatActive || docActive ? ' pane__output--chat' : ''}`}>
        {activeDoc ? (
          <DocumentView
            sessionId={session.id}
            doc={activeDoc}
            revision={workspaceDocs.revisions[activeDoc.id] ?? 0}
            onOpenUrl={(url) => {
              void window.electronAPI?.workspace?.tab(session.id, { op: 'new', input: url });
              setPaneOverride('page');
            }}
          />
        ) : chatActive ? (
          <ChatView
            session={session}
            tabUrls={tabUrls}
            engineName={engineName}
            engineIcon={engineIcon}
            onFollowUp={onFollowUp}
            onPause={isRunningLike ? onPause : undefined}
            onOpenUrl={(url) => {
              void window.electronAPI?.workspace?.tab(session.id, { op: 'new', input: url });
              setPaneOverride('page');
            }}
            focused={focused}
            focusSignal={composerFocus}
          />
        ) : newTabActive && activeTab ? (
          <NewTabPage
            session={session}
            onOpen={(input) => { void window.electronAPI?.workspace?.tab(session.id, { op: 'navigate', tabId: activeTab.id, input }); }}
          />
        ) : null}
      </div>

    </div>
  );
}

/**
 * Every AgentPane in Grid view used to re-render on every sessions refetch
 * (React Query's staleTime/refetchOnWindowFocus, or any other session's
 * sessionOutput event) because HubApp recreates the whole `sessions` array
 * — and the callback props passed alongside it — by reference on every one
 * of those, and a plain component re-renders whenever its parent does
 * regardless of whether ITS OWN data changed. With several running
 * sessions this compounded into visible jank: an unrelated session
 * finishing a tool call would restart every other pane's bounds/
 * ResizeObserver effect too.
 *
 * Compares `session` by the fields this component actually reads rather
 * than by reference, so a session that's genuinely unchanged skips the
 * re-render even though HubApp handed it a new object. Every callback prop
 * (onRerun, onResume, onPause, onFollowUp, onDismiss, onCancel, onSelect,
 * onOpenFollowUp, onOpenSettings) is deliberately excluded from the
 * comparison: each one takes the session id as its own call-time argument
 * rather than closing over per-session state (see AgentPaneProps above), so
 * a new function identity every render never changes what clicking a
 * button actually does — bailing out on a stale-but-equivalent callback
 * reference is safe.
 */
export function areAgentPanePropsEqual(prev: AgentPaneProps, next: AgentPaneProps): boolean {
  if (prev.focused !== next.focused) return false;
  if (prev.followUpShortcut !== next.followUpShortcut) return false;
  if (prev.cycleShortcut !== next.cycleShortcut) return false;

  const a = prev.session;
  const b = next.session;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.status === b.status &&
    // Reference equality is the fast, correct check once a session has real
    // output — useSessionsQuery only ever grows that array in place (append
    // or reuse the cached reference), never rebuilds an equal-but-new one.
    // A session with none yet is the one case that breaks that assumption:
    // every refetch hands back a brand new `[]` literal from IPC, so two
    // merely-empty arrays need to count as equal too.
    (a.output === b.output || (a.output.length === 0 && b.output.length === 0)) &&
    a.error === b.error &&
    a.hasBrowser === b.hasBrowser &&
    a.primarySite === b.primarySite &&
    a.lastUrl === b.lastUrl &&
    a.canResume === b.canResume &&
    a.lastActivityAt === b.lastActivityAt &&
    a.engine === b.engine &&
    a.model === b.model &&
    a.costUsd === b.costUsd &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.costSource === b.costSource &&
    a.authMode === b.authMode &&
    a.subscriptionType === b.subscriptionType
  );
}

export const AgentPane = React.memo(AgentPaneImpl, areAgentPanePropsEqual);

export default AgentPane;
