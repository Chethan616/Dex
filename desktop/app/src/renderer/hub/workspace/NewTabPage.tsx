/**
 * DEX's New-tab page: what a blank tab you opened shows instead of an empty
 * page. Recents are the files this task made (open them with a click), and
 * Suggested is where the task has been. The address bar above is already
 * focused, so typing goes straight there.
 */
import React, { useMemo } from 'react';
import { displayAddress } from '../../../shared/address';
import type { AgentSession } from '../types';

interface NewTabPageProps {
  session: AgentSession;
  onOpen: (input: string) => void;
}

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

export function NewTabPage({ session, onOpen }: NewTabPageProps): React.ReactElement {
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

  return (
    <div className="ws-newtab-page">
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
        {recents.length === 0 ? (
          <p className="ws-ntp-empty">Files this task makes show up here.</p>
        ) : (
          <ul className="ws-ntp-files">
            {recents.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className="ws-ntp-file"
                  onClick={() => { void window.electronAPI?.sessions?.downloadOutput?.(f.path); }}
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
