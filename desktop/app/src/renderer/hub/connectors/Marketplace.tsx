/**
 * The Marketplace: every connector DEX can use, in one pane — the built-in
 * accounts (Google, Microsoft 365, GitHub…) and the hosted connectors
 * (shared/connectorCatalog.ts: Notion, Jira, Canva, Stripe, PubMed,
 * Kiwi.com flights…). One click signs in through the user's browser; the
 * agent can use it from the next task on.
 *
 * Opened by a `dex:open-marketplace` window event (HubApp listens). The live
 * browser pages are native views drawn above the hub's DOM, so they step out
 * of the way while it's open.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUDIENCES, HOSTED_CONNECTORS, type Audience, type ConnectorCategory, type ConnectorMark } from '../../../shared/connectorCatalog';
import './marketplace.css';

type Source = { kind: 'hosted'; id: string } | { kind: 'account'; provider: AccountProviderId };

export interface MarketItem {
  key: string;
  name: string;
  blurb: string;
  category: ConnectorCategory;
  audiences: Audience[];
  mark: ConnectorMark;
  featured?: boolean;
  needsPlan?: boolean;
  noSignIn?: boolean;
  source: Source;
}

const ALL: Audience[] = ['student', 'work', 'engineer', 'doctor', 'creator', 'business'];

/** DEX's own one-click accounts (main/accounts), listed with the rest. */
const BUILT_IN: MarketItem[] = [
  { key: 'account:google', name: 'Google', blurb: 'Gmail, Calendar, Drive, Docs, Sheets, Meet, Tasks and Contacts.', category: 'Productivity', audiences: ALL, mark: { text: 'G', bg: '#ffffff', fg: '#4285f4' }, featured: true, source: { kind: 'account', provider: 'google' } },
  { key: 'account:microsoft', name: 'Microsoft 365', blurb: 'Outlook, Calendar, OneDrive, SharePoint, Teams and To Do.', category: 'Productivity', audiences: ['work', 'student', 'business'], mark: { text: 'M', bg: '#0078d4' }, featured: true, source: { kind: 'account', provider: 'microsoft' } },
  { key: 'account:github', name: 'GitHub', blurb: 'Repositories, issues, pull requests and Actions.', category: 'Developer tools', audiences: ['engineer', 'student'], mark: { text: 'GH', bg: '#24292f' }, featured: true, source: { kind: 'account', provider: 'github' } },
  { key: 'account:slack', name: 'Slack', blurb: 'Read channels and post updates in your workspace.', category: 'Communication', audiences: ['work', 'business', 'engineer'], mark: { text: 'S', bg: '#4a154b' }, source: { kind: 'account', provider: 'slack' } },
  { key: 'account:reddit', name: 'Reddit', blurb: 'Search communities and read discussions with your account.', category: 'Communication', audiences: ['student', 'creator'], mark: { text: 'R', bg: '#ff4500' }, source: { kind: 'account', provider: 'reddit' } },
  { key: 'account:huggingface', name: 'Hugging Face', blurb: '3D models from a sentence or a photo, on your free GPU time.', category: 'Design & media', audiences: ['creator', 'engineer'], mark: { text: '🤗', bg: '#ffd21e', fg: '#1b1b1b' }, source: { kind: 'account', provider: 'huggingface' } },
];

export const MARKET_ITEMS: MarketItem[] = [
  ...BUILT_IN,
  ...HOSTED_CONNECTORS.map((c) => ({
    key: `hosted:${c.id}`,
    name: c.name,
    blurb: c.blurb,
    category: c.category,
    audiences: c.audiences,
    mark: c.mark,
    featured: c.featured,
    needsPlan: c.needsPlan,
    noSignIn: c.auth === 'none',
    source: { kind: 'hosted' as const, id: c.id },
  })),
];

const CATEGORY_ORDER: ConnectorCategory[] = ['Productivity', 'Communication', 'Meetings & notes', 'Files', 'Developer tools', 'Design & media', 'Research & health', 'Travel & food', 'Sales & support', 'Finance & business'];

const AUDIENCE_KEY = 'dex.market.audience';
function readAudience(): Audience | 'all' {
  try {
    const v = window.localStorage.getItem(AUDIENCE_KEY);
    return v && (v === 'all' || AUDIENCES.some((a) => a.id === v)) ? (v as Audience | 'all') : 'all';
  } catch { return 'all'; }
}

export function Mark({ mark, size = 44 }: { mark: ConnectorMark; size?: number }): React.ReactElement {
  return (
    <span className="mk-mark" style={{ width: size, height: size, background: mark.bg, color: mark.fg ?? '#fff', fontSize: size * (mark.text.length > 1 ? 0.34 : 0.46) }} aria-hidden="true">
      {mark.text}
    </span>
  );
}

interface State {
  connected: Set<string>;
  tools: Map<string, number>;
  /** Built-in accounts this build can't sign in to (no OAuth app configured). */
  unavailable: Set<string>;
}

function useMarketState(): [State, () => Promise<void>] {
  const [state, setState] = useState<State>({ connected: new Set(), tools: new Map(), unavailable: new Set() });
  const load = useCallback(async () => {
    const api = window.electronAPI?.settings;
    const [hosted, accounts] = await Promise.all([
      api?.connectors?.list().catch(() => []) ?? Promise.resolve([]),
      api?.accounts?.list().catch(() => []) ?? Promise.resolve([]),
    ]);
    const connected = new Set<string>();
    const tools = new Map<string, number>();
    const unavailable = new Set<string>();
    for (const h of hosted) {
      if (h.connected) connected.add(`hosted:${h.id}`);
      if (h.toolCount) tools.set(`hosted:${h.id}`, h.toolCount);
    }
    for (const a of accounts) {
      if (a.connected) connected.add(`account:${a.provider}`);
      if (!a.available) unavailable.add(`account:${a.provider}`);
    }
    setState({ connected, tools, unavailable });
  }, []);
  useEffect(() => { void load(); }, [load]);
  return [state, load];
}

type View = { name: 'browse' } | { name: 'installed' } | { name: 'detail'; key: string };

export function Marketplace({ initialView = 'browse', onClose }: { initialView?: 'browse' | 'installed'; onClose: () => void }): React.ReactElement {
  const [state, reload] = useMarketState();
  const [view, setView] = useState<View>(initialView === 'installed' ? { name: 'installed' } : { name: 'browse' });
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState<Audience | 'all'>(readAudience);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);

  // The live pages are native views above the DOM: hide them while this is
  // up (whoever opened it brings them back when it closes).
  useEffect(() => { void window.electronAPI?.sessions?.viewsSetVisible?.(false); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); if (view.name === 'browse') onClose(); else setView({ name: 'browse' }); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, view.name]);
  useEffect(() => { if (view.name === 'browse') searchRef.current?.focus(); }, [view.name]);

  const pickAudience = (a: Audience | 'all') => {
    setAudience(a);
    try { window.localStorage.setItem(AUDIENCE_KEY, a); } catch { /* no storage: just this time */ }
  };

  const add = async (item: MarketItem) => {
    setBusy(item.key);
    setErrors((prev) => { const next = new Map(prev); next.delete(item.key); return next; });
    try {
      const api = window.electronAPI?.settings;
      const result = item.source.kind === 'hosted'
        ? await api?.connectors?.connect(item.source.id)
        : await api?.accounts?.connect(item.source.provider);
      if (result && !result.ok && 'error' in result && result.error) {
        setErrors((prev) => new Map(prev).set(item.key, result.error as string));
      }
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const cancel = async (item: MarketItem) => {
    const api = window.electronAPI?.settings;
    if (item.source.kind === 'hosted') await api?.connectors?.cancel();
    else await api?.accounts?.cancel(item.source.provider);
  };

  const remove = async (item: MarketItem) => {
    const api = window.electronAPI?.settings;
    if (item.source.kind === 'hosted') await api?.connectors?.disconnect(item.source.id);
    else await api?.accounts?.disconnect(item.source.provider);
    await reload();
  };

  const installed = MARKET_ITEMS.filter((i) => state.connected.has(i.key));
  const q = query.trim().toLowerCase();
  const results = useMemo(() => (q
    ? MARKET_ITEMS.filter((i) => `${i.name} ${i.blurb} ${i.category}`.toLowerCase().includes(q))
    : []), [q]);
  const forYou = useMemo(() => {
    const pool = MARKET_ITEMS.filter((i) => audience === 'all' ? i.featured : i.audiences.includes(audience));
    return [...pool.filter((i) => !state.connected.has(i.key)), ...pool.filter((i) => state.connected.has(i.key))].slice(0, 6);
  }, [audience, state.connected]);

  const row = (item: MarketItem) => (
    <MarketRow
      key={item.key}
      item={item}
      connected={state.connected.has(item.key)}
      unavailable={state.unavailable.has(item.key)}
      busy={busy === item.key}
      error={errors.get(item.key)}
      onOpen={() => setView({ name: 'detail', key: item.key })}
      onAdd={() => void add(item)}
      onCancel={() => void cancel(item)}
    />
  );

  return (
    <div className="mk" role="dialog" aria-modal="true" aria-label="Marketplace" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk__panel">
        <button type="button" className="mk__close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>

        {view.name === 'browse' && (
          <>
            <header className="mk__head">
              <h2 className="mk__title">Marketplace</h2>
              <button type="button" className="mk__installed" onClick={() => setView({ name: 'installed' })} disabled={installed.length === 0}>
                <span className="mk__stack">{installed.slice(0, 4).map((i) => <Mark key={i.key} mark={i.mark} size={22} />)}</span>
                {installed.length} installed
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </header>
            <label className="mk__search">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <input ref={searchRef} type="search" placeholder="Search connectors" aria-label="Search connectors" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>

            <div className="mk__body">
              {q ? (
                <section className="mk__section">
                  <h3 className="mk__heading">{results.length ? 'Results' : `Nothing called “${query}” yet`}</h3>
                  <div className="mk__grid">{results.map(row)}</div>
                </section>
              ) : (
                <>
                  <section className="mk__section">
                    <div className="mk__heading-row">
                      <h3 className="mk__heading">For you</h3>
                      <div className="mk__audiences" role="tablist" aria-label="Who it's for">
                        {[{ id: 'all' as const, label: 'Everyone' }, ...AUDIENCES].map((a) => (
                          <button key={a.id} type="button" role="tab" aria-selected={audience === a.id} className={`mk__audience${audience === a.id ? ' mk__audience--on' : ''}`} onClick={() => pickAudience(a.id)}>{a.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="mk__grid">{forYou.map(row)}</div>
                  </section>
                  <section className="mk__section">
                    <h3 className="mk__heading">Featured</h3>
                    <div className="mk__grid">{MARKET_ITEMS.filter((i) => i.featured).map(row)}</div>
                  </section>
                  {CATEGORY_ORDER.map((cat) => {
                    const items = MARKET_ITEMS.filter((i) => i.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <section key={cat} className="mk__section">
                        <h3 className="mk__heading">{cat}</h3>
                        <div className="mk__grid">{items.map(row)}</div>
                      </section>
                    );
                  })}
                  <p className="mk__foot">
                    Flights, hotels and restaurants: DEX searches Google Flights, Google Hotels and Google Maps in its browser — no connector needed.
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {view.name === 'installed' && (
          <>
            <header className="mk__head">
              <button type="button" className="mk__back" onClick={() => setView({ name: 'browse' })} aria-label="Back to the Marketplace">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <h2 className="mk__title">Installed</h2>
            </header>
            <div className="mk__body">
              {installed.length === 0 && <p className="mk__empty">Nothing yet. Add a connector and DEX can use it in your next task.</p>}
              <div className="mk__list">
                {installed.map((item) => (
                  <div key={item.key} className="mk__installed-row">
                    <Mark mark={item.mark} size={36} />
                    <span className="mk__row-text">
                      <span className="mk__name">{item.name}</span>
                      <span className="mk__blurb">{state.tools.get(item.key) ? `${state.tools.get(item.key)} tools` : item.category}</span>
                    </span>
                    <button type="button" className="mk__btn mk__btn--quiet" onClick={() => void remove(item)}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {view.name === 'detail' && (() => {
          const item = MARKET_ITEMS.find((i) => i.key === view.key);
          if (!item) return null;
          const on = state.connected.has(item.key);
          const how = item.noSignIn ? 'No sign-in needed.' : item.source.kind === 'account' ? `Signs in with your ${item.name} account, in your browser.` : `Signs in with your ${item.name} account, in your browser. DEX never sees your password.`;
          return (
            <>
              <header className="mk__head">
                <button type="button" className="mk__back" onClick={() => setView({ name: 'browse' })} aria-label="Back to the Marketplace">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </header>
              <div className="mk__body mk__detail">
                <Mark mark={item.mark} size={64} />
                <h2 className="mk__detail-name">{item.name}</h2>
                <p className="mk__detail-meta">{item.category}{item.needsPlan ? ' · needs a paid plan of the service' : ''}</p>
                <p className="mk__detail-blurb">{item.blurb}</p>
                <p className="mk__detail-how">{how}</p>
                {on && state.tools.get(item.key) ? <p className="mk__detail-how">DEX has {state.tools.get(item.key)} tools from it, in every task.</p> : null}
                {errors.get(item.key) && <p className="mk__error" role="alert">{errors.get(item.key)}</p>}
                <div className="mk__detail-actions">
                  {on ? (
                    <button type="button" className="mk__btn mk__btn--quiet" onClick={() => void remove(item)}>Remove</button>
                  ) : busy === item.key ? (
                    <>
                      <span className="mk__waiting">Finish signing in in your browser…</span>
                      <button type="button" className="mk__btn mk__btn--quiet" onClick={() => void cancel(item)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="mk__btn mk__btn--primary" disabled={state.unavailable.has(item.key)} onClick={() => void add(item)}>Add to DEX</button>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

function MarketRow({ item, connected, unavailable, busy, error, onOpen, onAdd, onCancel }: {
  item: MarketItem;
  connected: boolean;
  unavailable: boolean;
  busy: boolean;
  error?: string;
  onOpen: () => void;
  onAdd: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className={`mk__item${connected ? ' mk__item--on' : ''}`}>
      <button type="button" className="mk__item-open" onClick={onOpen} title={item.blurb}>
        <Mark mark={item.mark} />
        <span className="mk__row-text">
          <span className="mk__name">{item.name}</span>
          <span className={`mk__blurb${error ? ' mk__blurb--error' : ''}`}>{error ?? item.blurb}</span>
        </span>
      </button>
      {connected ? (
        <span className="mk__added">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Added
        </span>
      ) : busy ? (
        <button type="button" className="mk__btn mk__btn--quiet" onClick={onCancel} title="Finish signing in in your browser, or cancel">Cancel</button>
      ) : (
        <button type="button" className="mk__btn" onClick={onAdd} disabled={unavailable} title={unavailable ? 'Not set up in this build of DEX' : undefined}>{item.noSignIn ? 'Add' : 'Connect'}</button>
      )}
    </div>
  );
}
