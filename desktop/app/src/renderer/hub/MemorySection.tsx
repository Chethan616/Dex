/**
 * Settings › Memory: what DEX remembers about the user, which every task on
 * every engine is told (main/hl/engines/memory.ts). Notes the user or DEX
 * added, the sites they named (whether a login is kept, never the login), and
 * the memory graph: Index has a model read the notes into the things they're
 * about and how those link (main/memory/graph.ts), which `dex-recall` then
 * walks for whichever engine a task runs on. Nothing here leaves the PC
 * except that one Index call, to the engine the user already signed in to.
 *
 * Seeing it is the point: a memory you can't look at is one you can't trust,
 * and one you can't correct is worse than none.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemoryNote } from '../../main/memory/notes';
import type { SafeSiteRecord } from '../../main/memory/siteStore';
import type { MemoryGraph } from '../../shared/memoryGraph';
import { TOPICS, type Topic } from '../../shared/memoryTopics';
import { MemoryGraphView } from './MemoryGraphView';
import './memory.css';

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function ago(at: number): string {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return day(at);
}

const ENGINE_NAME: Record<MemoryGraph['by'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', local: 'DEX (no model)' };

function Icon({ d, size = 14 }: { d: string; size?: number }): React.ReactElement {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
const SEARCH = 'M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5';
const GRAPH = 'M4 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12 6a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM7 14.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5.2 3.8l5.4.9M4.6 4.3l1.9 7.3M11.4 5.6L7.7 11.7';
const LIST = 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01';
const SPARK = 'M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v2.5H11';
const LOCK = 'M4.5 7V5.5a3.5 3.5 0 017 0V7M3.5 7h9v6.5h-9z';

/** The search term, highlighted where it appears. */
function Marked({ text, q }: { text: string; q: string }): React.ReactElement {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function MemorySection(): React.ReactElement | null {
  // Read once: the effects below hang off it.
  const [api] = useState(() => window.electronAPI?.memory);
  const [notes, setNotes] = useState<MemoryNote[] | null>(null);
  const [sites, setSites] = useState<SafeSiteRecord[]>([]);
  const [graph, setGraph] = useState<{ graph: MemoryGraph | null; stale: boolean } | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api?.list().then((m) => { setNotes(m.notes); setSites(m.sites); }).catch(() => setNotes([]));
    void api?.graph?.().then((g) => { setGraph({ graph: g.graph, stale: g.stale }); if (g.indexing) setIndexing(true); }).catch(() => setGraph({ graph: null, stale: false }));
  }, [api]);

  // An agent's `dex-remember` lands here while the page is open.
  useEffect(() => {
    reload();
    return api?.onChange(reload);
  }, [api, reload]);

  const noteText = useCallback((id: string) => notes?.find((n) => n.id === id)?.text, [notes]);

  const q = query.trim();
  const shownNotes = useMemo(() => (notes ?? []).filter((n) =>
    (!topic || n.topic === topic) && (!q || `${n.text} ${TOPICS[n.topic]?.label ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [notes, topic, q]);
  const shownSites = useMemo(() => sites.filter((s) => !q || `${s.host} ${s.url ?? ''} ${s.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [sites, q]);
  const topics = useMemo(() => {
    const counts = new Map<Topic, number>();
    for (const n of notes ?? []) counts.set(n.topic, (counts.get(n.topic) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const groups = useMemo(() => {
    const m = new Map<Topic, MemoryNote[]>();
    for (const n of shownNotes) m.set(n.topic, [...(m.get(n.topic) ?? []), n]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [shownNotes]);

  if (!api || notes === null) return null;

  const add = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    const result = await api.addNote(text).catch(() => ({ error: 'Couldn’t save that. Try again.' }));
    if ('error' in result) {
      // The refusal is written for an agent; the user gets the short version.
      setError(/password|key|card/i.test(result.error) ? 'That looks like a password, key or card number — DEX doesn’t keep those as notes.' : result.error);
      return;
    }
    setError(null);
    setDraft('');
    reload();
  };

  const forgetSite = async (host: string): Promise<void> => {
    setConfirming(null);
    await api.forgetSite(host).catch(() => undefined);
    reload();
  };

  const runIndex = async (): Promise<void> => {
    setIndexing(true);
    setIndexError(null);
    const r = await api.index().catch((e: Error) => ({ error: e.message }));
    setIndexing(false);
    if ('error' in r) { setIndexError(r.error); return; }
    setGraph({ graph: r.graph, stale: false });
    setView('graph');
  };

  const g = graph?.graph ?? null;
  const fresh = Boolean(g) && !graph?.stale;

  return (
    <div className="dexmem">
      {/* What DEX knows, at a glance, and the Index. */}
      <div className="dexmem__hero">
        <div className="dexmem__hero-text">
          <div className="dexmem__hero-title">What DEX knows about you</div>
          <div className="dexmem__hero-sub">Every task starts with what bears on it — on Claude Code, Codex and BrowserCode, in any chat, from your phone too. DEX adds to it when you tell it something worth keeping.</div>
        </div>
        <div className="dexmem__stats">
          <div className="dexmem__stat"><b>{notes.length}</b><span>notes</span></div>
          <div className="dexmem__stat"><b>{sites.length}</b><span>sites</span></div>
          <div className="dexmem__stat"><b>{g ? g.nodes.length : '—'}</b><span>linked things</span></div>
        </div>
        <div className="dexmem__index">
          <button type="button" className={`conn-card__btn conn-card__btn--primary dexmem__index-btn${indexing ? ' is-busy' : ''}`} onClick={() => { void runIndex(); }} disabled={indexing || notes.length === 0}>
            <Icon d={SPARK} />
            {indexing ? 'Indexing…' : g ? (fresh ? 'Re-index' : 'Update index') : 'Index memory'}
          </button>
          <div className="dexmem__index-sub">
            {indexing ? 'A model is mapping your notes into a graph. This takes a minute or two.'
              : indexError ? <span className="dexmem__error">{indexError}</span>
              : g ? <>Indexed {ago(g.builtAt)} by {ENGINE_NAME[g.by]}{graph?.stale ? ' · notes changed since' : ''} · {g.communities.length} groups</>
              : 'Maps your notes into a graph of people, places, work, skills and more. Every engine can use it.'}
          </div>
        </div>
      </div>

      {/* Search, the topic filter and the view. */}
      <div className="dexmem__bar">
        <label className="dexmem__search">
          <Icon d={SEARCH} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your memory" aria-label="Search your memory" spellCheck={false} />
          {query && <button type="button" aria-label="Clear the search" onClick={() => setQuery('')}>×</button>}
        </label>
        <div className="dexmem__views" role="tablist" aria-label="Show as">
          <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}><Icon d={LIST} />List</button>
          <button type="button" role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')}><Icon d={GRAPH} />Graph</button>
        </div>
      </div>

      {view === 'graph' ? (
        g ? (
          <MemoryGraphView graph={g} query={q} noteText={noteText} />
        ) : (
          <div className="dexmem__empty-graph">
            <Icon d={GRAPH} size={28} />
            <div>No graph yet. <b>Index memory</b> reads your notes into one.</div>
          </div>
        )
      ) : (
        <>
          {topics.length > 1 && (
            <div className="dexmem__topics" role="group" aria-label="Topics">
              <button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)}>All <b>{notes.length}</b></button>
              {topics.map(([t, n]) => <button key={t} type="button" aria-pressed={topic === t} onClick={() => setTopic(topic === t ? null : t)}>{TOPICS[t]?.label ?? t} <b>{n}</b></button>)}
            </div>
          )}

          <form className="dexmem__add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input
              className="dexmem__input"
              value={draft}
              maxLength={400}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              placeholder="Tell DEX something to remember, like “I prefer aisle seats”"
              aria-label="Something for DEX to remember"
            />
            <button type="submit" className="conn-card__btn conn-card__btn--primary dexmem__go" disabled={!draft.trim()}>Remember</button>
          </form>
          {error && <div className="dexmem__error" role="alert">{error}</div>}

          {notes.length === 0 ? (
            <div className="dexmem__empty">Nothing yet. Say “remember that …” in any chat, or add it here.</div>
          ) : shownNotes.length === 0 ? (
            <div className="dexmem__empty">Nothing in your notes matches “{q}”.</div>
          ) : (
            <div className="dexmem__groups">
              {groups.map(([t, list]) => (
                <section key={t} className="dexmem__group">
                  <div className="dexmem__group-head"><span>{TOPICS[t]?.label ?? 'Other'}</span><b>{list.length}</b></div>
                  <ul className="dexmem__notes">
                    {list.map((n) => (
                      <li key={n.id} className="dexmem__note">
                        <span className="dexmem__text"><Marked text={n.text} q={q} /></span>
                        <span className="dexmem__meta">
                          {n.core && <span className="dexmem__core" title="Told to every task">core</span>}
                          {n.by === 'user' ? 'You' : 'DEX'} · {day(n.at)}
                        </span>
                        <button type="button" className="dexmem__x" aria-label={`Forget “${n.text}”`} title="Forget" onClick={() => { void api.forgetNote(n.id).then(reload); }}>×</button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <section className="dexmem__group dexmem__group--sites">
            <div className="dexmem__group-head"><span>Your sites</span><b>{sites.length}</b></div>
            <div className="dexmem__sites-sub">Sites you’ve named, so “my attendance” goes to the right place. A saved login stays in Windows’ credential store: DEX types it in, and no task ever sees it.</div>
            {sites.length === 0 ? (
              <div className="dexmem__empty">None yet. Tell DEX “my uni portal is …” and it remembers.</div>
            ) : (
              <ul className="dexmem__sites">
                {shownSites.map((s) => (
                  <li key={s.host} className="dexmem__site">
                    <span className="dexmem__favicon" aria-hidden="true">{s.host.replace(/^www\./, '').slice(0, 1).toUpperCase()}</span>
                    <div className="dexmem__site-main">
                      <span className="dexmem__host"><Marked text={s.host} q={q} /></span>
                      {s.aliases.length > 0 && <span className="dexmem__aliases">you call it {s.aliases.slice(0, 6).join(', ')}</span>}
                    </div>
                    {(s.hasPassword || s.hasUsername) && <span className="dexmem__badge"><Icon d={LOCK} size={11} />{s.hasPassword ? 'Login saved' : 'Username saved'}</span>}
                    {confirming === s.host ? (
                      <span className="dexmem__confirm">
                        <button type="button" className="dexmem__ghost" onClick={() => setConfirming(null)}>Keep</button>
                        <button type="button" className="dexmem__danger" onClick={() => { void forgetSite(s.host); }}>Forget it</button>
                      </span>
                    ) : (
                      <button type="button" className="dexmem__ghost" onClick={() => { if (s.hasPassword || s.hasUsername) setConfirming(s.host); else void forgetSite(s.host); }}>Forget</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
