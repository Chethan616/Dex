/**
 * Extensions, as the Marketplace shows connectors (connectors/Marketplace.tsx,
 * the same layout and classes): Browse the popular ones and add one in a
 * click, Installed to manage them, a page per extension with every option,
 * and Advanced for a store link, an unpacked folder and updates.
 *
 * Opened by a `dex:open-extensions` window event (HubApp listens), from
 * Settings › Extensions or the toolbar's puzzle menu.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXTENSION_CATALOG, EXTENSION_CATEGORIES, type CatalogExtension } from '../../shared/extensionCatalog';
import { Switch } from '../components/lib';
import './connectors/marketplace.css';
import './extensions.css';

export type ExtensionsView = 'browse' | 'installed' | 'advanced';
type View = { name: ExtensionsView } | { name: 'detail'; id: string };

const api = (): ElectronExtensionsAPI | undefined => window.electronAPI?.extensions;

function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

/** A Chrome Web Store link or a bare extension id, pasted into the search. */
function storeIdIn(text: string): string | null {
  const m = /(?:^|\/)([a-p]{32})(?:[/?#]|$)/.exec(text.trim());
  return m ? m[1] : null;
}

/** The extension's icon on a tile, like a connector's logo; its letter while there's none. */
export function ExtMark({ icon, name, size = 44 }: { icon?: string | null; name: string; size?: number }): React.ReactElement {
  if (icon) {
    return (
      <span className="mk-mark mk-mark--logo ext-mark" style={{ width: size, height: size }} aria-hidden="true">
        <img src={icon} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className="mk-mark ext-mark ext-mark--letter" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

const Back = ({ onClick, label }: { onClick: () => void; label: string }): React.ReactElement => (
  <button type="button" className="mk__back" onClick={onClick} aria-label={label}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </button>
);

export function ExtensionsMarket({ initialView = 'browse', onClose }: { initialView?: ExtensionsView; onClose: () => void }): React.ReactElement {
  const [view, setView] = useState<View>({ name: initialView });
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => { void api()?.list().then(setInstalled).catch(() => setInstalled([])); }, []);
  useEffect(() => {
    refresh();
    return api()?.onChanged(refresh);
  }, [refresh]);
  useEffect(() => {
    void api()?.catalogIcons(EXTENSION_CATALOG.map((e) => e.id)).then(setIcons).catch(() => setIcons({}));
  }, []);

  // The live pages are native views above the DOM: they step aside while this is up.
  useEffect(() => { void window.electronAPI?.sessions?.viewsSetVisible?.(false); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (view.name === 'browse') onClose(); else setView({ name: 'browse' });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, view.name]);
  useEffect(() => { if (view.name === 'browse') searchRef.current?.focus(); }, [view.name]);

  const byId = useMemo(() => new Map(installed.map((e) => [e.id, e])), [installed]);
  const iconOf = (id: string): string | null => byId.get(id)?.icon ?? icons[id] ?? null;

  const setError = (key: string, message: string | null): void => setErrors((prev) => {
    const next = new Map(prev);
    if (message) next.set(key, message); else next.delete(key);
    return next;
  });

  const add = async (idOrLink: string, key = idOrLink): Promise<void> => {
    setBusy(key);
    setError(key, null);
    try {
      const result = await api()?.install(idOrLink);
      if (result === 'install_in_progress') setError(key, 'Still adding the last one…');
    } catch (err) {
      setError(key, messageOf(err));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  /** Run something on an installed extension; errors land on its page. */
  const run = async (id: string, f: () => Promise<unknown> | undefined): Promise<void> => {
    setBusy(id);
    setError(id, null);
    try { await f(); } catch (err) { setError(id, messageOf(err)); } finally { setBusy(null); refresh(); }
  };

  /** A store page or an extension's options: DEX's extension window opens over this. */
  const openPage = async (target: string, key: string): Promise<void> => {
    setError(key, null);
    const shown = await api()?.open(target).catch(() => false);
    if (!shown) setError(key, 'DEX couldn’t open that page.');
  };

  const q = query.trim().toLowerCase();
  const pastedId = storeIdIn(query);
  const results = useMemo(() => (q
    ? EXTENSION_CATALOG.filter((e) => `${e.name} ${e.blurb} ${e.category}`.toLowerCase().includes(q))
    : []), [q]);

  const row = (item: CatalogExtension) => {
    const on = byId.has(item.id);
    const error = errors.get(item.id);
    return (
      <div key={item.id} className={`mk__item${on ? ' mk__item--on' : ''}`}>
        <button type="button" className="mk__item-open" onClick={() => setView({ name: 'detail', id: item.id })} title={item.blurb}>
          <ExtMark icon={iconOf(item.id)} name={item.name} />
          <span className="mk__row-text">
            <span className="mk__name">{item.name}</span>
            <span className={`mk__blurb${error ? ' mk__blurb--error' : ''}`}>{error ?? item.blurb}</span>
          </span>
        </button>
        {on ? (
          <span className="mk__added">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Added
          </span>
        ) : (
          <button type="button" className="mk__btn" disabled={busy !== null} onClick={() => void add(item.id)}>
            {busy === item.id ? 'Adding…' : 'Add'}
          </button>
        )}
      </div>
    );
  };

  const detail = view.name === 'detail' ? (() => {
    const ext = byId.get(view.id);
    const item = EXTENSION_CATALOG.find((e) => e.id === view.id);
    const name = ext?.name ?? item?.name ?? 'Extension';
    const error = errors.get(view.id);
    return (
      <>
        <header className="mk__head">
          <Back onClick={() => setView({ name: ext ? 'installed' : 'browse' })} label="Back" />
        </header>
        <div className="mk__body mk__detail">
          <ExtMark icon={iconOf(view.id)} name={name} size={64} />
          <h2 className="mk__detail-name">{name}</h2>
          <p className="mk__detail-meta">
            {[item?.category, ext ? `Version ${ext.version}` : null, ext?.source === 'unpacked' ? 'Unpacked' : 'Chrome Web Store'].filter(Boolean).join(' · ')}
          </p>
          <p className="mk__detail-blurb">{ext?.description || item?.blurb}</p>
          <p className="mk__detail-how">
            {item?.passwords
              ? 'Runs in your tasks’ tabs, never in DEX itself. DEX’s agent is never let near its pages.'
              : 'Runs in your tasks’ tabs, never in DEX itself.'}
          </p>
          {error && <p className="mk__error" role="alert">{error}</p>}

          {ext ? (
            <>
              <div className="ext-detail">
                <div className="ext-detail__row">
                  <span>On</span>
                  <Switch checked={ext.enabled} disabled={busy === ext.id} label={`Turn ${name} ${ext.enabled ? 'off' : 'on'}`} onChange={() => void run(ext.id, () => api()?.setEnabled(ext.id, !ext.enabled))} />
                </div>
                <div className="ext-detail__row">
                  <span>Pin to the toolbar</span>
                  <Switch checked={ext.pinned} disabled={busy === ext.id || !ext.enabled} label="Pin to the toolbar" onChange={() => void run(ext.id, () => api()?.setPinned(ext.id, !ext.pinned))} />
                </div>
                <div className="ext-detail__row">
                  <span>Allow access to files on your PC</span>
                  <Switch checked={ext.fileAccess} disabled={busy === ext.id || !ext.enabled} label="Allow access to files on your PC" onChange={() => void run(ext.id, () => api()?.setFileAccess(ext.id, !ext.fileAccess))} />
                </div>
                <div className="ext-detail__perms">
                  <span className="ext-detail__perms-title">What it can do</span>
                  {ext.warnings.length ? <ul>{ext.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : <p>It needs no special permissions.</p>}
                </div>
              </div>
              <div className="mk__detail-actions">
                {ext.optionsUrl && <button type="button" className="mk__btn" disabled={!ext.loaded} onClick={() => void openPage(`options:${ext.id}`, ext.id)}>Options</button>}
                {ext.source === 'unpacked' && <button type="button" className="mk__btn" disabled={!ext.enabled} onClick={() => void run(ext.id, () => api()?.reload(ext.id))}>Reload</button>}
                {ext.storeUrl && <button type="button" className="mk__btn" onClick={() => void openPage(`store-page:${ext.id}`, ext.id)}>Store page</button>}
                <button type="button" className="mk__btn mk__btn--quiet" disabled={busy === ext.id} onClick={() => void run(ext.id, () => api()?.remove(ext.id)).then(() => setView({ name: 'installed' }))}>Remove</button>
              </div>
            </>
          ) : (
            <div className="mk__detail-actions">
              <button type="button" className="mk__btn mk__btn--primary" disabled={busy !== null} onClick={() => void add(view.id)}>
                {busy === view.id ? 'Adding…' : 'Add to DEX'}
              </button>
            </div>
          )}
        </div>
      </>
    );
  })() : null;

  return (
    <div className="mk" role="dialog" aria-modal="true" aria-label="Extensions" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk__panel">
        <button type="button" className="mk__close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>

        {view.name === 'browse' && (
          <>
            <header className="mk__head">
              <h2 className="mk__title">Extensions</h2>
              <button type="button" className="mk__installed" onClick={() => setView({ name: 'installed' })} disabled={installed.length === 0}>
                <span className="mk__stack">{installed.slice(0, 4).map((e) => <ExtMark key={e.id} icon={e.icon} name={e.name} size={22} />)}</span>
                {installed.length} installed
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </header>
            <label className="mk__search">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <input ref={searchRef} type="search" placeholder="Search extensions, or paste a Chrome Web Store link" aria-label="Search extensions" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>

            <div className="mk__body">
              {errors.get('store') && <p className="mk__error" role="status">{errors.get('store')}</p>}
              {q ? (
                <section className="mk__section">
                  {pastedId && !byId.has(pastedId) && (
                    <div className="mk__grid">
                      <div className="mk__item">
                        <span className="mk__item-open">
                          <ExtMark name="+" />
                          <span className="mk__row-text">
                            <span className="mk__name">Add this extension</span>
                            <span className={`mk__blurb${errors.get(pastedId) ? ' mk__blurb--error' : ''}`}>{errors.get(pastedId) ?? pastedId}</span>
                          </span>
                        </span>
                        <button type="button" className="mk__btn" disabled={busy !== null} onClick={() => void add(pastedId)}>{busy === pastedId ? 'Adding…' : 'Add'}</button>
                      </div>
                    </div>
                  )}
                  {!pastedId && <h3 className="mk__heading">{results.length ? 'Results' : `Nothing called “${query}” here`}</h3>}
                  {results.length > 0 && <div className="mk__grid">{results.map(row)}</div>}
                  {!pastedId && (
                    <button type="button" className="ext-store-search" onClick={() => void openPage(`store-search:${query.trim()}`, 'store')}>
                      Search the Chrome Web Store for “{query.trim()}” ›
                    </button>
                  )}
                </section>
              ) : (
                <>
                  <section className="mk__section">
                    <h3 className="mk__heading">Popular</h3>
                    <div className="mk__grid">{EXTENSION_CATALOG.filter((e) => e.featured).map(row)}</div>
                  </section>
                  {EXTENSION_CATEGORIES.map((cat) => {
                    const inCategory = EXTENSION_CATALOG.filter((e) => e.category === cat);
                    if (inCategory.length === 0) return null;
                    return (
                      <section key={cat} className="mk__section">
                        <h3 className="mk__heading">{cat}</h3>
                        <div className="mk__grid">{inCategory.map(row)}</div>
                      </section>
                    );
                  })}
                  <p className="mk__foot">
                    Anything else: <button type="button" className="ext-link" onClick={() => void openPage('store', 'store')}>open the Chrome Web Store</button> and click “Add to DEX” on its page.
                    {' '}Building one? <button type="button" className="ext-link" onClick={() => setView({ name: 'advanced' })}>Advanced</button>
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {view.name === 'installed' && (
          <>
            <header className="mk__head">
              <Back onClick={() => setView({ name: 'browse' })} label="Back to Extensions" />
              <h2 className="mk__title">Installed</h2>
            </header>
            <div className="mk__body">
              {installed.length === 0 && <p className="mk__empty">Nothing yet. Add an extension and it works in your tasks’ tabs.</p>}
              <div className="mk__list">
                {installed.map((ext) => (
                  <div key={ext.id} className={`mk__installed-row${ext.enabled ? '' : ' ext-off'}`}>
                    <button type="button" className="mk__item-open" onClick={() => setView({ name: 'detail', id: ext.id })}>
                      <ExtMark icon={ext.icon} name={ext.name} size={36} />
                      <span className="mk__row-text">
                        <span className="mk__name">{ext.name}</span>
                        <span className={`mk__blurb${ext.error ? ' mk__blurb--error' : ''}`}>
                          {ext.error ?? [ext.enabled ? null : 'Off', ext.pinned ? 'Pinned' : null, ext.source === 'unpacked' ? 'Unpacked' : null, `Version ${ext.version}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                    <Switch checked={ext.enabled} disabled={busy === ext.id} label={`Turn ${ext.name} ${ext.enabled ? 'off' : 'on'}`} onChange={() => void run(ext.id, () => api()?.setEnabled(ext.id, !ext.enabled))} />
                  </div>
                ))}
              </div>
              <p className="mk__foot">
                <button type="button" className="ext-link" onClick={() => setView({ name: 'advanced' })}>Advanced</button>: a store link, an unpacked folder, updates.
              </p>
            </div>
          </>
        )}

        {view.name === 'advanced' && (
          <>
            <header className="mk__head">
              <Back onClick={() => setView({ name: 'browse' })} label="Back to Extensions" />
              <h2 className="mk__title">Advanced</h2>
            </header>
            <div className="mk__body">
              <section className="mk__section ext-adv">
                <h3 className="mk__heading">Add by link</h3>
                <p className="ext-adv__text">A Chrome Web Store page’s link, or an extension id. DEX checks Google signed it before adding it.</p>
                <form className="ext-adv__form" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('link') as HTMLInputElement).value; if (v.trim()) void add(v.trim(), 'link'); }}>
                  <input name="link" type="text" placeholder="chromewebstore.google.com/detail/… or an id" aria-label="Chrome Web Store link or extension id" spellCheck={false} />
                  <button type="submit" className="mk__btn" disabled={busy !== null}>{busy === 'link' ? 'Adding…' : 'Add'}</button>
                </form>
                {errors.get('link') && <p className="mk__error" role="alert">{errors.get('link')}</p>}
              </section>
              <section className="mk__section ext-adv">
                <h3 className="mk__heading">Load unpacked</h3>
                <p className="ext-adv__text">An extension in a folder on your PC, for building one. It stays where it is; Reload on its page picks up changes.</p>
                <div>
                  <button
                    type="button"
                    className="mk__btn"
                    onClick={() => {
                      setError('unpacked', null);
                      void api()?.loadUnpacked().then((r) => { refresh(); if (r) setView({ name: 'detail', id: r.id }); })
                        .catch((err) => { const m = messageOf(err); if (m !== 'Cancelled') setError('unpacked', m); });
                    }}
                  >
                    Choose a folder…
                  </button>
                </div>
                {errors.get('unpacked') && <p className="mk__error" role="alert">{errors.get('unpacked')}</p>}
              </section>
              <section className="mk__section ext-adv">
                <h3 className="mk__heading">Updates</h3>
                <p className="ext-adv__text">Extensions from the store update on their own every five hours.</p>
                <div>
                  <button
                    type="button"
                    className="mk__btn"
                    disabled={busy === 'updates'}
                    onClick={() => {
                      setBusy('updates');
                      setError('updates', null);
                      void api()?.checkUpdates()
                        .then((ids) => setError('updates', ids.length ? `Updated ${ids.length} extension${ids.length === 1 ? '' : 's'}.` : 'Every extension is up to date.'))
                        .catch((err) => setError('updates', messageOf(err)))
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === 'updates' ? 'Checking…' : 'Check now'}
                  </button>
                </div>
                {errors.get('updates') && <p className="ext-adv__text" role="status">{errors.get('updates')}</p>}
              </section>
            </div>
          </>
        )}

        {detail}
      </div>
    </div>
  );
}
