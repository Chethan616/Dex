/**
 * Settings › Extensions: the Chrome extensions in DEX's browser
 * (main/extensions), laid out like Settings › Connectors — one card that
 * leads to the Chrome Web Store, then a quiet list of what's installed. A row
 * opens to pin, options and permissions; adding by link and loading an
 * unpacked extension sit under Advanced.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Switch } from '../components/lib';
import { PuzzleIcon } from './icons/PuzzleIcon';
import './extensions.css';

/** A few people reach for first; each is an "Add" away. */
const SUGGESTED = [
  { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', what: 'Dark mode for every site' },
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', what: 'Blocks ads and trackers' },
  { id: 'aapbdbdomjkkjkaonfhkkikfgjllcleb', name: 'Google Translate', what: 'Translate pages and words' },
  { id: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', name: 'Grammarly', what: 'Writing help as you type' },
];

const api = (): ElectronExtensionsAPI | undefined => window.electronAPI?.extensions;

function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

function ExtIcon({ ext, size }: { ext: Pick<ExtensionSummary, 'icon' | 'name'>; size: number }): React.ReactElement {
  return ext.icon
    ? <img className="ext-icon" src={ext.icon} alt="" width={size} height={size} draggable={false} />
    : <span className="ext-icon ext-icon--blank" style={{ width: size, height: size }} aria-hidden="true">{ext.name.slice(0, 1)}</span>;
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg className={`ext-row__chev${open ? ' ext-row__chev--open' : ''}`} viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExtensionRow({ ext, onError }: { ext: ExtensionSummary; onError(message: string): void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const run = useCallback(async (f: () => Promise<unknown> | undefined) => {
    setBusy(true);
    try { await f(); } catch (err) { onError(messageOf(err)); } finally { setBusy(false); }
  }, [onError]);

  return (
    <div className={`ext-row${ext.enabled ? '' : ' ext-row--off'}${open ? ' ext-row--open' : ''}`}>
      <div className="ext-row__head">
        <button type="button" className="ext-row__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ExtIcon ext={ext} size={28} />
          <span className="ext-row__text">
            <span className="ext-row__name">
              {ext.name}
              {ext.pinned && <span className="ext-row__tag">Pinned</span>}
              {ext.source === 'unpacked' && <span className="ext-row__tag">Unpacked</span>}
            </span>
            {ext.error
              ? <span className="ext-row__error" role="alert">{ext.error}</span>
              : ext.description && <span className="ext-row__desc">{ext.description}</span>}
          </span>
          <Chevron open={open} />
        </button>
        <Switch
          checked={ext.enabled}
          onChange={() => { void run(() => api()?.setEnabled(ext.id, !ext.enabled)); }}
          label={ext.enabled ? `Turn off ${ext.name}` : `Turn on ${ext.name}`}
          disabled={busy}
        />
      </div>

      {open && (
        <div className="ext-row__body">
          <div className="ext-row__actions">
            <button
              type="button"
              className="ext-pill"
              aria-pressed={ext.pinned}
              disabled={busy || !ext.enabled}
              onClick={() => { void run(() => api()?.setPinned(ext.id, !ext.pinned)); }}
            >
              {ext.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
            </button>
            {ext.optionsUrl && (
              <button type="button" className="ext-pill" disabled={busy || !ext.loaded} onClick={() => { void run(() => api()?.open(`options:${ext.id}`)); }}>
                Options
              </button>
            )}
            {ext.source === 'unpacked' && (
              <button type="button" className="ext-pill" disabled={busy || !ext.enabled} onClick={() => { void run(() => api()?.reload(ext.id)); }}>
                Reload
              </button>
            )}
            {ext.storeUrl && (
              <button type="button" className="ext-pill" onClick={() => { void api()?.open(`store-page:${ext.id}`); }}>
                Store page
              </button>
            )}
            <button type="button" className="ext-pill ext-pill--danger" disabled={busy} onClick={() => { void run(() => api()?.remove(ext.id)); }}>
              Remove
            </button>
          </div>
          <div className="ext-row__perms">
            <span className="ext-row__perms-title">What it can do</span>
            {ext.warnings.length
              ? <ul>{ext.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              : <p>It needs no special permissions.</p>}
            <label className="ext-row__check">
              <input
                type="checkbox"
                checked={ext.fileAccess}
                disabled={busy || !ext.enabled}
                onChange={() => { void run(() => api()?.setFileAccess(ext.id, !ext.fileAccess)); }}
              />
              Allow access to files on your PC (file:// pages)
            </label>
          </div>
          <span className="ext-row__version">Version {ext.version}</span>
        </div>
      )}
    </div>
  );
}

export function ExtensionsSection(): React.ReactElement {
  const [list, setList] = useState<ExtensionSummary[] | null>(null);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(() => {
    void api()?.list().then(setList).catch(() => setList([]));
  }, []);

  useEffect(() => {
    refresh();
    return api()?.onChanged(refresh);
  }, [refresh]);

  const add = useCallback(async (idOrLink: string, label?: string) => {
    const text = idOrLink.trim();
    if (!text) return;
    setAdding(text);
    setNotice(null);
    try {
      const result = await api()?.install(text);
      if (result === 'success') { setNotice({ kind: 'ok', text: `${label ?? 'The extension'} is added. Its button is under the puzzle piece in a task's toolbar.` }); setInput(''); }
      else if (result === 'already_installed') setNotice({ kind: 'ok', text: `${label ?? 'That extension'} is already here.` });
      else if (result === 'install_in_progress') setNotice({ kind: 'ok', text: 'Still adding it…' });
    } catch (err) {
      setNotice({ kind: 'error', text: messageOf(err) });
    } finally {
      setAdding(null);
      refresh();
    }
  }, [refresh]);

  const exts = list ?? [];
  const installedIds = new Set(exts.map((e) => e.id));
  const suggestions = SUGGESTED.filter((s) => !installedIds.has(s.id));

  return (
    <>
      <div className="settings-market">
        <span className="ext-market__mark" aria-hidden="true"><PuzzleIcon size={22} /></span>
        <div className="settings-market__text">
          <span className="settings-market__title">Chrome Web Store</span>
          <span className="settings-market__sub">
            Add extensions to DEX’s browser: Dark Reader, uBlock Origin Lite, Google Translate, Grammarly and thousands more. Click “Add to DEX” on a store page. They work in task tabs, never in DEX itself.
          </span>
          {exts.length > 0 && (
            <span className="ext-market__installed">
              <span className="ext-market__stack">{exts.slice(0, 5).map((e) => <ExtIcon key={e.id} ext={e} size={20} />)}</span>
              {exts.length} installed
            </span>
          )}
        </div>
        <button type="button" className="settings-market__browse" onClick={() => { void api()?.open('store'); }}>Browse</button>
      </div>

      {notice && <div className={`ext-notice ext-notice--${notice.kind}`} role="status">{notice.text}</div>}

      {list !== null && (exts.length > 0 || suggestions.length > 0) && (
        <div className="settings-card ext-list">
          {exts.map((ext) => <ExtensionRow key={ext.id} ext={ext} onError={(text) => setNotice({ kind: 'error', text })} />)}
          {suggestions.length > 0 && (
            <div className="ext-popular">
              <span className="ext-popular__label">{exts.length ? 'Popular' : 'Popular, to start with'}</span>
              <div className="ext-popular__list">
                {suggestions.map((s) => (
                  <button key={s.id} type="button" className="ext-pill" title={s.what} disabled={adding !== null} onClick={() => { void add(s.id, s.name); }}>
                    {adding === s.id ? `Adding ${s.name}…` : `+ ${s.name}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <details className="channels-advanced ext-advanced">
        <summary>Advanced — add by link, load unpacked, check for updates</summary>
        <div className="ext-advanced__body">
          <form className="ext-advanced__add" onSubmit={(e) => { e.preventDefault(); void add(input); }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="A Chrome Web Store link or an extension id"
              aria-label="Chrome Web Store link or extension id"
              spellCheck={false}
            />
            <button type="submit" className="ext-pill" disabled={!input.trim() || adding !== null}>
              {adding && adding === input.trim() ? 'Adding…' : 'Add'}
            </button>
          </form>
          <div className="ext-advanced__dev">
            <button
              type="button"
              className="ext-pill"
              onClick={() => {
                void api()?.loadUnpacked().then((r) => { if (r) setNotice({ kind: 'ok', text: `${r.name} is loaded.` }); refresh(); })
                  .catch((err) => { const m = messageOf(err); if (m !== 'Cancelled') setNotice({ kind: 'error', text: m }); });
              }}
            >
              Load unpacked…
            </button>
            <button
              type="button"
              className="ext-pill"
              onClick={() => {
                void api()?.checkUpdates().then((ids) => setNotice({ kind: 'ok', text: ids.length ? `Updated ${ids.length} extension${ids.length === 1 ? '' : 's'}.` : 'Every extension is up to date.' }))
                  .catch((err) => setNotice({ kind: 'error', text: messageOf(err) }));
              }}
            >
              Check for updates
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
