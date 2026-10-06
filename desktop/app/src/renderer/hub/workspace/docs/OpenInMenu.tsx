/**
 * The document bar's "Open in ▾": the default app, a code editor for text
 * files (VS Code, Cursor… whichever are installed), the folder, or a copy
 * saved somewhere else. Everything goes through sessions.openFile /
 * openInEditor, which only accept files this task recorded or opened.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { openFile } from '../../chat/FileCards';
import { extOf } from './kinds';

const EDITABLE = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'bat', 'cmd', 'sql', 'dart', 'swift', 'lua', 'r',
]);

let editors: Promise<Array<{ id: string; name: string }>> | null = null;
function installedEditors(): Promise<Array<{ id: string; name: string }>> {
  if (!editors) {
    editors = (window.electronAPI?.sessions?.listEditors?.() ?? Promise.resolve([]))
      .then((list) => list.filter((e) => e.id !== 'xcode'))
      .catch(() => []);
  }
  return editors;
}

export function OpenInMenu({ sessionId, path, name }: { sessionId: string; path: string; name: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Array<{ id: string; name: string }>>([]);
  const ref = useRef<HTMLDivElement>(null);
  const editable = EDITABLE.has(extOf(name));

  useEffect(() => {
    if (open && editable) void installedEditors().then(setList);
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
    <div className="dv-openin" ref={ref}>
      <button type="button" className="dv-chip dv-openin__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Open in
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="dv-menu" role="menu">
          <button type="button" role="menuitem" className="dv-menu__item" onClick={() => pick(() => openFile(sessionId, path, 'open'))}>Default app</button>
          {list.map((ed) => (
            <button
              key={ed.id}
              type="button"
              role="menuitem"
              className="dv-menu__item"
              onClick={() => pick(() => window.electronAPI?.sessions?.openInEditor?.(ed.id, path, sessionId).catch(() => openFile(sessionId, path, 'reveal')))}
            >
              {ed.name}
            </button>
          ))}
          <div className="dv-menu__sep" />
          <button type="button" role="menuitem" className="dv-menu__item" onClick={() => pick(() => openFile(sessionId, path, 'reveal'))}>Show in File Explorer</button>
          <button type="button" role="menuitem" className="dv-menu__item" onClick={() => pick(() => openFile(sessionId, path, 'copy'))}>Download a copy</button>
        </div>
      )}
    </div>
  );
}
