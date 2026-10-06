/**
 * DEX's New-tab page: what a blank tab you opened shows instead of an empty
 * page. Tools (docs/unify/PLAN.md §3.6) are one click away; Suggested is
 * where the task has been; Recents are the files this task made — a click
 * opens one as a document tab, and the box finds any of them. The address
 * bar above is already focused, so typing goes straight there.
 */
import React, { useMemo, useRef, useState } from 'react';
import { displayAddress } from '../../../shared/address';
import { showFile } from '../chat/FileCards';
import { taskFiles } from './docs/fileTree';
import type { AgentSession } from '../types';

interface NewTabPageProps {
  session: AgentSession;
  onOpen: (input: string) => void;
  /** The task's raw Logs window. */
  onOpenLogs?: () => void;
}

/** Settings at a section, from anywhere in the hub (HubApp listens). */
function openSettingsAt(sectionId: string): void {
  window.dispatchEvent(new CustomEvent('dex:open-settings', { detail: sectionId }));
}

const TOOL_ICONS = {
  files: 'M2 4.2c0-.6.5-1 1-1h3l1.4 1.5H13c.6 0 1 .4 1 1v6.1c0 .6-.4 1-1 1H3c-.5 0-1-.4-1-1z',
  logs: 'M3 3.5h10v9H3zM5.5 6.5h5M5.5 9h3',
  accounts: 'M8 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4',
};

function fileKind(name: string, mime: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(ext)) return 'Document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Spreadsheet';
  if (['ppt', 'pptx'].includes(ext)) return 'Presentation';
  if (['glb', 'gltf', 'blend'].includes(ext)) return '3D model';
  if (mime.startsWith('image/')) return 'Picture';
  if (mime.startsWith('video/')) return 'Video';
  if (['md', 'txt'].includes(ext)) return 'Text';
  return ext ? ext.toUpperCase() : 'File';
}

export function NewTabPage({ session, onOpen, onOpenLogs }: NewTabPageProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const findRef = useRef<HTMLInputElement>(null);
  const allFiles = useMemo(() => taskFiles(session.output, []), [session.output]);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allFiles.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 12) : null;
  }, [allFiles, query]);
  const recents = useMemo(() => {
    const seen = new Set<string>();
    const files: Array<{ name: string; path: string; kind: string }> = [];
    for (let i = session.output.length - 1; i >= 0; i--) {
      const e = session.output[i];
      if (e.type !== 'file_output' || !e.path || seen.has(e.path)) continue;
      seen.add(e.path);
      files.push({ name: e.name || e.path, path: e.path, kind: fileKind(e.name, e.mime) });
      if (files.length >= 8) break;
    }
    return files;
  }, [session.output]);

  const suggested = useMemo(() => {
    const sites = [session.lastUrl, session.primarySite].filter((u): u is string => Boolean(u && /^https?:/.test(u)));
    return Array.from(new Set(sites)).slice(0, 4);
  }, [session.lastUrl, session.primarySite]);

  const tools: Array<{ id: keyof typeof TOOL_ICONS; label: string; hint: string; run: () => void }> = [
    { id: 'files', label: 'Find a file', hint: 'Any file this task made', run: () => findRef.current?.focus() },
    ...(onOpenLogs ? [{ id: 'logs' as const, label: 'Logs', hint: 'The raw run, step by step', run: onOpenLogs }] : []),
    { id: 'accounts', label: 'Accounts', hint: 'Google, Microsoft, GitHub…', run: () => openSettingsAt('settings-integrations') },
  ];

  return (
    <div className="ws-newtab-page">
      <section className="ws-ntp-section">
        <h3 className="ws-ntp-heading">Tools</h3>
        <div className="ws-ntp-tools">
          {tools.map((t) => (
            <button key={t.id} type="button" className="ws-ntp-tool" onClick={t.run}>
              <svg className="ws-ntp-tool__icon" viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true">
                <path d={TOOL_ICONS[t.id]} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="ws-ntp-tool__text">
                <span className="ws-ntp-tool__label">{t.label}</span>
                <span className="ws-ntp-tool__hint">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {suggested.length > 0 && (
        <section className="ws-ntp-section">
          <h3 className="ws-ntp-heading">Suggested</h3>
          <div className="ws-ntp-sites">
            {suggested.map((url) => (
              <button key={url} type="button" className="ws-ntp-site" onClick={() => onOpen(url)} title={url}>
                <span className="ws-ntp-site__mark">{displayAddress(url).charAt(0).toUpperCase()}</span>
                <span className="ws-ntp-site__label">{displayAddress(url).split('/')[0]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="ws-ntp-section">
        <h3 className="ws-ntp-heading">Recents</h3>
        {allFiles.length > 0 && (
          <input
            ref={findRef}
            className="ws-ntp-find"
            type="search"
            placeholder={`Find among ${allFiles.length} file${allFiles.length === 1 ? '' : 's'}…`}
            aria-label="Find a file this task made"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {found ? (
          found.length === 0 ? <p className="ws-ntp-empty">No file matches “{query}”.</p> : (
            <ul className="ws-ntp-files">
              {found.map((f) => (
                <li key={f.path}>
                  <button type="button" className="ws-ntp-file" onClick={() => { void showFile(session.id, f.path); }} title={f.path}>
                    <span className="ws-ntp-file__badge">{fileKind(f.name, '').slice(0, 3).toUpperCase()}</span>
                    <span className="ws-ntp-file__text">
                      <span className="ws-ntp-file__name">{f.name}</span>
                      <span className="ws-ntp-file__kind">{fileKind(f.name, '')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : recents.length === 0 ? (
          <p className="ws-ntp-empty">Files this task makes show up here.</p>
        ) : (
          <ul className="ws-ntp-files">
            {recents.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className="ws-ntp-file"
                  onClick={() => { void showFile(session.id, f.path); }}
                  title={f.path}
                >
                  <span className="ws-ntp-file__badge">{f.kind.slice(0, 3).toUpperCase()}</span>
                  <span className="ws-ntp-file__text">
                    <span className="ws-ntp-file__name">{f.name}</span>
                    <span className="ws-ntp-file__kind">{f.kind}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
