/**
 * Settings › Extensions: the Chrome extensions in DEX's browser
 * (main/extensions). Add one from the Chrome Web Store (its page in a task's
 * tab, or a pasted link here), switch it off, pin it to the toolbar, open its
 * options, or remove it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Switch } from '../components/lib';
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

function ExtensionRow({ ext, onError }: { ext: ExtensionSummary; onError(message: string): void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (f: () => Promise<unknown> | undefined) => {
    setBusy(true);
    try { await f(); } catch (err) { onError(messageOf(err)); } finally { setBusy(false); }
  }, [onError]);

  return (
    <div className={`ext-row${ext.enabled ? '' : ' ext-row--off'}`}>
      <div className="ext-row__main">
        {ext.icon
          ? <img className="ext-row__icon" src={ext.icon} alt="" />
          : <span className="ext-row__icon ext-row__icon--blank" aria-hidden="true">{ext.name.slice(0, 1)}</span>}
        <div className="ext-row__text">
          <div className="ext-row__title">
            <span className="settings-pane__label">{ext.name}</span>
            <span className="ext-row__version">{ext.version}{ext.source === 'unpacked' ? ' · unpacked' : ''}</span>
          </div>
          {ext.description && <div className="settings-pane__sublabel ext-row__desc">{ext.description}</div>}
          {ext.error && <div className="ext-row__error" role="alert">{ext.error}</div>}
        </div>
        <Switch
          checked={ext.enabled}
          onChange={() => { void run(() => api()?.setEnabled(ext.id, !ext.enabled)); }}
          label={ext.enabled ? `Turn off ${ext.name}` : `Turn on ${ext.name}`}
          disabled={busy}
        />
      </div>
      <div className="ext-row__actions">
        <button
          type="button"
          className={`ext-pill${ext.pinned ? ' ext-pill--on' : ''}`}
          aria-pressed={ext.pinned}
          disabled={busy || !ext.enabled}
          onClick={() => { void run(() => api()?.setPinned(ext.id, !ext.pinned)); }}
        >
          {ext.pinned ? 'Pinned to toolbar' : 'Pin to toolbar'}
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
        <button type="button" className="ext-pill ext-pill--quiet" disabled={busy} onClick={() => { void run(() => api()?.remove(ext.id)); }}>
          Remove
        </button>
      </div>
      <details className="ext-row__details">
        <summary>What it can do</summary>
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
        {ext.storeUrl && (
          <button type="button" className="ext-link" onClick={() => { void api()?.open(`store-page:${ext.id}`); }}>
            See it in the Chrome Web Store
          </button>
        )}
      </details>
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
      if (result === 'success') { setNotice({ kind: 'ok', text: `${label ?? 'The extension'} is added. Its button is in the extensions menu (the puzzle piece) of a task's toolbar.` }); setInput(''); }
      else if (result === 'already_installed') setNotice({ kind: 'ok', text: `${label ?? 'That extension'} is already here.` });
      else if (result === 'install_in_progress') setNotice({ kind: 'ok', text: 'Still adding it…' });
    } catch (err) {
      setNotice({ kind: 'error', text: messageOf(err) });
    } finally {
      setAdding(null);
      refresh();
    }
  }, [refresh]);

  const installed = new Set((list ?? []).map((e) => e.id));
  const suggestions = SUGGESTED.filter((s) => !installed.has(s.id));

  return (
    <div className="settings-card ext-section">
      <div className="settings-pane__row ext-add">
        <div className="settings-pane__label-block">
          <div className="settings-pane__label">Add from the Chrome Web Store</div>
          <div className="settings-pane__sublabel">
            Click “Add to DEX” on its store page in a task's tab, or paste the page's link here. Extensions work in DEX's browser only, never in DEX itself.
          </div>
        </div>
        <form
          className="ext-add__form"
          onSubmit={(e) => { e.preventDefault(); void add(input); }}
        >
          <input
            className="ext-add__input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="chromewebstore.google.com/detail/… or an extension id"
            aria-label="Chrome Web Store link or extension id"
            spellCheck={false}
          />
          <button type="submit" className="conn-card__btn conn-card__btn--primary" disabled={!input.trim() || adding !== null}>
            {adding === input.trim() && adding ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void api()?.open('store'); }}>
            Browse the store
          </button>
        </form>
        {notice && <div className={`ext-notice ext-notice--${notice.kind}`} role="status">{notice.text}</div>}
      </div>

      {list === null ? (
        <div className="settings-pane__row"><div className="settings-pane__sublabel">Loading…</div></div>
      ) : list.length === 0 ? (
        <div className="settings-pane__row ext-empty">
          <div className="settings-pane__sublabel">No extensions yet. A few to start with:</div>
        </div>
      ) : (
        list.map((ext) => <ExtensionRow key={ext.id} ext={ext} onError={(text) => setNotice({ kind: 'error', text })} />)
      )}

      {list !== null && suggestions.length > 0 && (
        <div className="settings-pane__row ext-suggest">
          {list.length > 0 && <div className="settings-pane__sublabel">Popular</div>}
          <div className="ext-suggest__list">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ext-suggest__item"
                disabled={adding !== null}
                onClick={() => { void add(s.id, s.name); }}
              >
                <span className="ext-suggest__name">{adding === s.id ? `Adding ${s.name}…` : s.name}</span>
                <span className="ext-suggest__what">{s.what}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <details className="settings-pane__row ext-dev">
        <summary>For developers</summary>
        <div className="ext-dev__body">
          <div className="settings-pane__sublabel">Load an extension from a folder on your PC (it stays where it is; Reload picks up changes).</div>
          <button
            type="button"
            className="conn-card__btn conn-card__btn--secondary"
            onClick={() => {
              void api()?.loadUnpacked().then((r) => { if (r) setNotice({ kind: 'ok', text: `${r.name} is loaded.` }); refresh(); })
                .catch((err) => { const m = messageOf(err); if (m !== 'Cancelled') setNotice({ kind: 'error', text: m }); });
            }}
          >
            Load unpacked…
          </button>
          <button
            type="button"
            className="conn-card__btn conn-card__btn--secondary"
            onClick={() => {
              void api()?.checkUpdates().then((ids) => setNotice({ kind: 'ok', text: ids.length ? `Updated ${ids.length} extension${ids.length === 1 ? '' : 's'}.` : 'Every extension is up to date.' }))
                .catch((err) => setNotice({ kind: 'error', text: messageOf(err) }));
            }}
          >
            Check for updates
          </button>
        </div>
      </details>
    </div>
  );
}
