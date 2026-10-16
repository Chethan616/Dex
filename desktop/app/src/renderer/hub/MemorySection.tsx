/**
 * Settings › Memory: what DEX remembers about the user, which every task on
 * every engine is told (main/hl/engines/memory.ts). Notes the user or DEX
 * added, and the sites they named — with whether a login is kept, never the
 * login. Nothing here leaves the PC.
 *
 * Seeing it is the point: a memory you can't look at is one you can't trust,
 * and one you can't correct is worse than none.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { MemoryNote } from '../../main/memory/notes';
import type { SafeSiteRecord } from '../../main/memory/siteStore';
import { TOPICS } from '../../shared/memoryTopics';
import './memory.css';

const SHOWN = 8;

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function CloseGlyph(): React.ReactElement {
  return <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function MemorySection(): React.ReactElement | null {
  // Read once: the effects below hang off it.
  const [api] = useState(() => window.electronAPI?.memory);
  const [notes, setNotes] = useState<MemoryNote[] | null>(null);
  const [sites, setSites] = useState<SafeSiteRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api?.list().then((m) => { setNotes(m.notes); setSites(m.sites); }).catch(() => setNotes([]));
  }, [api]);

  // An agent's `dex-remember` lands here while the page is open.
  useEffect(() => {
    reload();
    return api?.onChange(reload);
  }, [api, reload]);

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

  const shown = all ? notes : notes.slice(0, SHOWN);

  return (
    <div className="settings-card dexmem">
      <div className="settings-pane__row settings-pane__row--stack">
        <div>
          <div className="settings-pane__label">What DEX knows about you</div>
          <div className="settings-pane__sublabel">
            Every task starts with this — on Claude Code, Codex and BrowserCode, in any chat, from your phone too. DEX adds to it when you tell it something worth keeping.
          </div>
        </div>
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
        ) : (
          <ul className="dexmem__notes">
            {shown.map((n) => (
              <li key={n.id} className="dexmem__note">
                <span className="dexmem__text">{n.text}</span>
                <span className="dexmem__meta">{TOPICS[n.topic]?.label ?? 'Other'} · {n.by === 'user' ? 'You' : 'DEX'} · {day(n.at)}</span>
                <button
                  type="button"
                  className="dexmem__x"
                  aria-label={`Forget “${n.text}”`}
                  title="Forget"
                  onClick={() => { void api.forgetNote(n.id).then(reload); }}
                >
                  <CloseGlyph />
                </button>
              </li>
            ))}
          </ul>
        )}
        {notes.length > SHOWN && (
          <button type="button" className="dexmem__more" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${notes.length}`}
          </button>
        )}
      </div>

      <div className="settings-pane__row settings-pane__row--stack">
        <div>
          <div className="settings-pane__label">Your sites</div>
          <div className="settings-pane__sublabel">
            Sites you’ve named, so “my attendance” goes to the right place. A saved login stays in Windows’ credential store: DEX types it in for you, and no task ever sees it.
          </div>
        </div>
        {sites.length === 0 ? (
          <div className="dexmem__empty">None yet. Tell DEX “my uni portal is …” and it remembers.</div>
        ) : (
          <ul className="dexmem__sites">
            {sites.map((s) => (
              <li key={s.host} className="dexmem__site">
                <div className="dexmem__site-main">
                  <span className="dexmem__host">{s.host}</span>
                  {s.aliases.length > 0 && (
                    <span className="dexmem__aliases">you call it {s.aliases.slice(0, 6).join(', ')}</span>
                  )}
                </div>
                {(s.hasPassword || s.hasUsername) && (
                  <span className="dexmem__badge">
                    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4.5 7V5.5a3.5 3.5 0 017 0V7M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                    {s.hasPassword ? 'Login saved' : 'Username saved'}
                  </span>
                )}
                {confirming === s.host ? (
                  <span className="dexmem__confirm">
                    <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => setConfirming(null)}>Keep</button>
                    <button type="button" className="conn-card__btn dexmem__danger" onClick={() => { void forgetSite(s.host); }}>Forget it</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="conn-card__btn conn-card__btn--secondary"
                    onClick={() => { if (s.hasPassword || s.hasUsername) setConfirming(s.host); else void forgetSite(s.host); }}
                  >
                    Forget
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
