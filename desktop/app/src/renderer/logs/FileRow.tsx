/**
 * FileRow — a produced file, with an "Open in <editor> / Reveal" menu.
 * Shared by the chat transcript (inline file cards) and the Raw view's footer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';

export interface FileOutputEntry {
  type: 'file_output';
  name: string;
  path: string;
  size: number;
  mime: string;
}

export function formatSize(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// Editor list is fetched once per logs-window lifetime; filter out
// blocklisted entries defensively on the renderer.
const EDITOR_BLOCKLIST = new Set(['xcode']);
let editorsPromise: Promise<Array<{ id: string; name: string }>> | null = null;
function getEditors(): Promise<Array<{ id: string; name: string }>> {
  if (!editorsPromise) {
    const base = window.electronAPI?.sessions.listEditors?.() ?? Promise.resolve([]);
    editorsPromise = base.then((list) => list.filter((e) => !EDITOR_BLOCKLIST.has(e.id)));
  }
  return editorsPromise;
}

export function FileRow({ entry }: { entry: FileOutputEntry }): React.ReactElement {
  const [editors, setEditors] = useState<Array<{ id: string; name: string }>>([]);
  const [popupId, setPopupId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { void getEditors().then(setEditors).catch(() => setEditors([])); }, []);

  const onOpenInEditor = useCallback(async (editorId: string) => {
    console.log('[LogsApp file] onOpenInEditor click', { editorId, path: entry.path });
    if (!entry.path) {
      console.warn('[LogsApp file] entry.path is falsy; aborting');
      return;
    }
    const api = window.electronAPI?.sessions?.openInEditor;
    if (!api) {
      console.error('[LogsApp file] window.electronAPI.sessions.openInEditor is undefined — preload bridge missing');
      return;
    }
    try {
      const res = await api(editorId, entry.path);
      console.log('[LogsApp file] openInEditor success', res);
    } catch (err) {
      console.error('[LogsApp file] openInEditor failed', err);
      try { await window.electronAPI?.sessions?.revealOutput?.(entry.path); }
      catch (revealErr) { console.error('[LogsApp file] reveal fallback also failed', revealErr); }
    }
  }, [entry.path]);

  const onReveal = useCallback(async () => {
    if (!entry.path) return;
    try { await window.electronAPI?.sessions.revealOutput(entry.path); }
    catch (err) { console.error('[LogsApp file] reveal failed', err); }
  }, [entry.path]);

  const toggleMenu = useCallback(async () => {
    const button = buttonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    const resolvedEditors = editors.length > 0
      ? editors
      : await getEditors().then((list) => { setEditors(list); return list; }).catch(() => [] as Array<{ id: string; name: string }>);
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'menu',
        placement: 'top-start',
        width: 220,
        items: [
          ...resolvedEditors.map((editor) => ({
            id: `editor:${editor.id}`,
            label: `Open in ${editor.name}`,
            icon: { type: 'editor' as const, id: editor.id },
          })),
          {
            id: 'reveal',
            label: 'Reveal in Finder',
            icon: { type: 'finder' as const },
            separatorBefore: resolvedEditors.length > 0,
          },
        ],
      },
      {
        onAction: (action) => {
          if (action.kind !== 'menu-select') return;
          if (action.itemId.startsWith('editor:')) void onOpenInEditor(action.itemId.slice('editor:'.length));
          if (action.itemId === 'reveal') void onReveal();
        },
        onClosed: () => setPopupId(null),
      },
    );
    if (nextId) setPopupId(nextId);
  }, [editors, onOpenInEditor, onReveal, popupId]);

  return (
    <div className="logs-file-row-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="logs-file-row"
        onClick={(e) => { e.stopPropagation(); void toggleMenu(); }}
        title={entry.path}
        aria-haspopup="menu"
        aria-expanded={Boolean(popupId)}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M8 1.5H4a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 004 12.5h6a1.5 1.5 0 001.5-1.5V5L8 1.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M8 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <span className="logs-file-row__name">{entry.name}</span>
        <span className="logs-file-row__size">{formatSize(entry.size)}</span>
        <span className="logs-file-row__caret">{'▾'}</span>
      </button>
    </div>
  );
}

