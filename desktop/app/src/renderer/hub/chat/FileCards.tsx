/**
 * The files a turn made, as one card list (Codex's layout): badge, name, what
 * kind of file it is, and "Open in ▾" — a document tab in DEX, the default
 * app, the folder, an editor, or a copy saved somewhere else. Opening goes
 * through `workspace.docOpen` / `sessions.openFile`, which only open files
 * this task recorded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileBadge, extOf, fileKind } from './fileKinds';
import type { FileItem } from './turns';
import { viewerFor } from '../workspace/docs/kinds';

const EDITABLE = new Set(['md', 'txt', 'json', 'csv', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'yaml', 'yml', 'toml', 'xml', 'sql', 'sh', 'ps1', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'kt', 'dart', 'swift', 'log']);

let editorsPromise: Promise<Array<{ id: string; name: string }>> | null = null;
function getEditors(): Promise<Array<{ id: string; name: string }>> {
  if (!editorsPromise) {
    editorsPromise = (window.electronAPI?.sessions?.listEditors?.() ?? Promise.resolve([]))
      .then((list) => list.filter((e) => e.id !== 'xcode'))
      .catch(() => []);
  }
  return editorsPromise;
}

export function openFile(sessionId: string, path: string, how: 'open' | 'reveal' | 'copy' = 'open'): Promise<void> {
  const api = window.electronAPI?.sessions;
  if (!api?.openFile) return Promise.resolve();
  return api.openFile(sessionId, path, how).then(() => undefined).catch((err: unknown) => {
    console.warn('[chat] openFile failed', { how, error: (err as Error)?.message });
  });
}

/**
 * Show a file the task made: as a document tab in the workspace when DEX can
 * draw it (docs/unify/PLAN.md §3.9), else in its default app.
 */
export function showFile(sessionId: string, path: string): Promise<void> {
  const ws = window.electronAPI?.workspace;
  if (!ws?.docOpen || viewerFor(path) === 'none') return openFile(sessionId, path);
  return ws.docOpen(sessionId, path).then(() => undefined).catch((err: unknown) => {
    console.warn('[chat] docOpen failed; opening in its app', { error: (err as Error)?.message });
    return openFile(sessionId, path);
  });
}

function MenuIcon({ d }: { d: string }): React.ReactElement {
  return (
    <svg className="cx-menu__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICON = {
  tab: 'M2.5 4h11v8.5h-11zM2.5 6.5h11M5 4V2.8',
  app: 'M2.5 3.5h11v9h-11zM2.5 6h11',
  folder: 'M2 4.2c0-.6.5-1 1-1h3l1.4 1.5H13c.6 0 1 .4 1 1v6.1c0 .6-.4 1-1 1H3c-.5 0-1-.4-1-1z',
  editor: 'M5.5 5 2.8 8l2.7 3M10.5 5l2.7 3-2.7 3M9 3.5l-2 9',
  copy: 'M8 2.5v7m0 0L5.2 6.8M8 9.5l2.8-2.7M3 11v1.5c0 .6.4 1 1 1h8c.6 0 1-.4 1-1V11',
};

/** "Open in ▾" and its menu. The chat is React, so a plain popover works here. */
function OpenIn({ sessionId, file }: { sessionId: string; file: FileItem }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [editors, setEditors] = useState<Array<{ id: string; name: string }>>([]);
  const ref = useRef<HTMLDivElement>(null);
  const editable = EDITABLE.has(extOf(file.name));

  useEffect(() => {
    if (open && editable) void getEditors().then(setEditors);
  }, [open, editable]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = useCallback((fn: () => unknown) => { setOpen(false); void fn(); }, []);

  return (
    <div className="cx-openin" ref={ref}>
      <button type="button" className="cx-openin__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Open in
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="cx-menu" role="menu">
          {viewerFor(file.name) !== 'none' && (
            <button type="button" role="menuitem" className="cx-menu__item" onClick={() => pick(() => showFile(sessionId, file.path))}>
              <MenuIcon d={ICON.tab} />A tab in DEX
            </button>
          )}
          <button type="button" role="menuitem" className="cx-menu__item" onClick={() => pick(() => openFile(sessionId, file.path, 'open'))}>
            <MenuIcon d={ICON.app} />Default app
          </button>
          {editors.map((ed) => (
            <button key={ed.id} type="button" role="menuitem" className="cx-menu__item" onClick={() => pick(() => window.electronAPI?.sessions?.openInEditor?.(ed.id, file.path, sessionId).catch(() => openFile(sessionId, file.path, 'reveal')))}>
              <MenuIcon d={ICON.editor} />{ed.name}
            </button>
          ))}
          <div className="cx-menu__sep" />
          <button type="button" role="menuitem" className="cx-menu__item" onClick={() => pick(() => openFile(sessionId, file.path, 'reveal'))}>
            <MenuIcon d={ICON.folder} />Show in File Explorer
          </button>
          <button type="button" role="menuitem" className="cx-menu__item" onClick={() => pick(() => openFile(sessionId, file.path, 'copy'))}>
            <MenuIcon d={ICON.copy} />Download a copy
          </button>
        </div>
      )}
    </div>
  );
}

export function FileCards({ sessionId, files }: { sessionId: string; files: FileItem[] }): React.ReactElement {
  return (
    <div className="cx-files">
      {files.map((f) => (
        <div key={f.path} className="cx-file">
          <button type="button" className="cx-file__main" onClick={() => void showFile(sessionId, f.path)} title={f.path}>
            <FileBadge name={f.name} mime={f.mime} />
            <span className="cx-file__text">
              <span className="cx-file__name">{f.name}</span>
              <span className="cx-file__kind">{fileKind(f.name, f.mime).label}</span>
            </span>
          </button>
          <OpenIn sessionId={sessionId} file={f} />
        </div>
      ))}
    </div>
  );
}
