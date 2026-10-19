/**
 * Settings › Desktop control (docs/desktop-control/PLAN.md §Phase 3): whether
 * DEX uses Windows apps at all, which apps it asks about first, which it never
 * uses, the admin helper for changes that need admin rights, and the changes
 * it made — each with Undo, right here. Saved by main
 * (main/desktop/deskSettings.ts); the Windows server and the approval path
 * read it on every call, so a change applies at once.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appName } from '../../shared/deskWords';
import { Switch } from '../components/lib';
import './desktop-control.css';

type AppInfo = { name: string; exe: string };

function Icon({ d, size = 15 }: { d: string; size?: number }): React.ReactElement {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
const MONITOR = 'M2.5 3h11v7.5h-11zM6 13.5h4M8 10.5v3';
const SEARCH = 'M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5';
const PLUS = 'M8 3.5v9M3.5 8h9';
const SHIELD = 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z';
const UNDO = 'M5 6H10.5a3 3 0 010 6H8M5 6l2.5-2.5M5 6l2.5 2.5';
const FOLDER = 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z';

/** Apps DEX never uses, whatever the lists say (main/desktop/deskSettings.ts keeps the real list). */
const ALWAYS_OFF = ['Password managers', 'Windows Security', 'Windows sign-in', 'Terminals', 'Other AI agents', 'DEX itself'];

/** Apps' icons from Windows (main's desktop:app-icon), fetched once per app for the whole page. */
const iconCache = new Map<string, Promise<string | null>>();
function useAppIcon(exe: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    const get = window.electronAPI?.settings?.desktop?.icon;
    if (!exe || !get) return;
    let live = true;
    if (!iconCache.has(exe)) iconCache.set(exe, get(exe).catch(() => null));
    void iconCache.get(exe)!.then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [exe]);
  return url;
}

/** An app's own icon, or a letter tile tinted by its name while there's none. */
function AppTile({ name, exe }: { name: string; exe?: string }): React.ReactElement {
  const icon = useAppIcon(exe);
  const [broken, setBroken] = useState(false);
  if (icon && !broken) return <span className="desk-tile desk-tile--icon" aria-hidden="true"><img src={icon} alt="" draggable={false} onError={() => setBroken(true)} /></span>;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="desk-tile" style={{ ['--tile-h' as string]: h }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

function ago(at: string): string {
  const t = Date.parse(at);
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Pick an app: a search over everything installed (not only what's open),
 * with the apps open now first. Keyboard all the way: arrows, Enter, Escape.
 */
function AppPicker({ installed, running, exclude, onPick, onClose }: {
  installed: AppInfo[] | null;
  running: string[];
  exclude: string[];
  onPick: (exe: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const byExe = useMemo(() => new Map((installed ?? []).map((a) => [a.exe, a])), [installed]);
  const openNow = useMemo(() => running.filter((exe) => !exclude.includes(exe)).map((exe) => byExe.get(exe) ?? { exe, name: appName(exe) }), [running, exclude, byExe]);
  const results: AppInfo[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return openNow.slice(0, 7);
    const pool = installed ?? [];
    const starts = pool.filter((a) => !exclude.includes(a.exe) && a.name.toLowerCase().startsWith(term));
    const rest = pool.filter((a) => !exclude.includes(a.exe) && !a.name.toLowerCase().startsWith(term) && `${a.name} ${a.exe}`.toLowerCase().includes(term));
    const found = [...starts, ...rest].slice(0, 8);
    // A program name typed out in full ("notepad++.exe") is fine too.
    if (found.length === 0 && /^[\w .()&+-]{1,80}$/.test(term)) {
      const exe = term.endsWith('.exe') ? term : `${term}.exe`;
      if (!exclude.includes(exe)) return [{ exe, name: appName(exe) }];
    }
    return found;
  }, [q, installed, exclude, openNow]);
  useEffect(() => setActive(0), [q]);

  return (
    <div className="desk-pick" ref={boxRef} role="dialog" aria-label="Choose an app">
      <label className="desk-pick__search">
        <Icon d={SEARCH} size={14} />
        <input
          autoFocus
          value={q}
          placeholder="Search apps on this PC"
          aria-label="Search apps on this PC"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && results[active]) { e.preventDefault(); onPick(results[active].exe); }
          }}
        />
        <kbd>Esc</kbd>
      </label>
      <div className="desk-pick__label">{q.trim() ? (results.length ? 'Apps' : 'No app by that name') : openNow.length ? 'Open now' : 'Type to search'}</div>
      <ul className="desk-pick__list" role="listbox">
        {results.map((a, i) => (
          <li key={a.exe}>
            <button type="button" role="option" aria-selected={i === active} className={`desk-pick__row${i === active ? ' is-on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(a.exe)}>
              <AppTile name={a.name} exe={a.exe} />
              <span className="desk-pick__name">{a.name}</span>
              <span className="desk-pick__exe">{a.exe}</span>
              {running.includes(a.exe) && <span className="desk-pick__open">open</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="desk-pick__foot">{installed === null ? 'Finding your apps…' : `${installed.length} apps on this PC, open or not · ↑↓ to move, Enter to add`}</div>
    </div>
  );
}

function AppList({ title, sub, tone, items, installed, running, exclude, onChange }: {
  title: string;
  sub: string;
  tone: 'ask' | 'never';
  items: string[];
  installed: AppInfo[] | null;
  running: string[];
  /** Apps already on either list. */
  exclude: string[];
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const [picking, setPicking] = useState(false);
  const nameOf = (exe: string): string => installed?.find((a) => a.exe === exe)?.name ?? appName(exe);
  return (
    <div className={`desk-list desk-list--${tone}`}>
      <div className="desk-list__head">
        <div>
          <div className="desk-list__title">{title}<b>{items.length}</b></div>
          <div className="desk-list__sub">{sub}</div>
        </div>
        <span className="desk-list__add-wrap">
          <button type="button" className="conn-card__btn conn-card__btn--secondary desk-list__add" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
            <Icon d={PLUS} size={12} />Add app
          </button>
          {picking && (
            <AppPicker installed={installed} running={running} exclude={exclude} onPick={(exe) => { onChange([...items, exe]); setPicking(false); }} onClose={() => setPicking(false)} />
          )}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="desk-list__empty">{tone === 'ask' ? 'None yet. Mail and chat apps are good ones to add.' : 'None besides the built-in list below.'}</div>
      ) : (
        <ul className="desk-list__rows">
          {items.map((exe) => (
            <li key={exe} className="desk-row">
              <AppTile name={nameOf(exe)} exe={exe} />
              <span className="desk-row__name">{nameOf(exe)}</span>
              <span className="desk-row__exe">{exe}</span>
              {running.includes(exe) && <span className="desk-row__open">open now</span>}
              <button type="button" className="desk-row__x" aria-label={`Remove ${nameOf(exe)}`} title="Remove" onClick={() => onChange(items.filter((i) => i !== exe))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DesktopControlSection(): React.ReactElement | null {
  const api = window.electronAPI?.settings?.desktop;
  const elevationApi = window.electronAPI?.settings?.elevation;
  const [settings, setSettings] = useState<DesktopControlSettings | null>(null);
  const [running, setRunning] = useState<string[]>([]);
  const [installed, setInstalled] = useState<AppInfo[] | null>(null);
  const [journal, setJournal] = useState<{ entries: DeskJournalEntry[]; total: number } | null>(null);
  const [elevation, setElevation] = useState<{ supported: boolean; installed: boolean; outdated: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadJournal = useCallback(() => {
    void api?.journal?.().then((r) => setJournal({ entries: r.entries, total: r.total ?? r.entries.length })).catch(() => setJournal({ entries: [], total: 0 }));
  }, [api]);

  useEffect(() => {
    void api?.get().then(setSettings).catch(() => setSettings(null));
    // Read once here, so the picker has them by the time it opens (a few seconds the first time).
    void api?.apps().then((r) => { setInstalled(r.installed); setRunning(r.running); }).catch(() => setInstalled([]));
    void elevationApi?.status().then(setElevation).catch(() => setElevation(null));
    loadJournal();
  }, [api, elevationApi, loadJournal]);

  if (!api || !settings) return null;
  if (!settings.supported) {
    return (
      <div className="desk">
        <div className="desk-hero">
          <span className="desk-hero__icon"><Icon d={MONITOR} size={20} /></span>
          <div className="desk-hero__text"><div className="desk-hero__title">Desktop control</div><div className="desk-hero__sub">Using your apps in the background is Windows-only for now.</div></div>
        </div>
      </div>
    );
  }

  const save = (patch: Partial<Omit<DesktopControlSettings, 'supported'>>): void => {
    setError(null);
    setSettings({ ...settings, ...patch });   // at once; main answers with the cleaned-up lists
    api.set(patch).then(setSettings).catch(() => { setError('Couldn’t save that. Try again.'); void api.get().then(setSettings); });
  };

  const undo = async (e: DeskJournalEntry): Promise<void> => {
    setBusy(e.id);
    setNote(null);
    const r = await window.electronAPI?.desk?.undo(e.sessionId, e.id).catch((err: Error) => ({ ok: false, message: err.message }));
    setBusy(null);
    setNote(r && 'ok' in r && r.ok ? `Undone: ${e.title}` : `Couldn’t undo “${e.title}”${r && 'message' in r && r.message ? `: ${r.message}` : '.'}`);
    loadJournal();
  };

  const setUpAdmin = async (remove: boolean): Promise<void> => {
    setBusy('admin');
    setNote(null);
    const r = await (remove ? elevationApi?.remove() : elevationApi?.setUp())?.catch((err: Error) => ({ ok: false, error: err.message }));
    setBusy(null);
    if (r && !r.ok) setNote(r.error ?? 'Windows didn’t finish that. Try again.');
    void elevationApi?.status().then(setElevation);
  };

  const on = settings.enabled;
  return (
    <div className="desk">
      {/* Whether DEX uses Windows apps at all, and what's going on. */}
      <div className={`desk-hero${on ? ' is-on' : ''}`}>
        <span className="desk-hero__icon"><Icon d={MONITOR} size={20} /></span>
        <div className="desk-hero__text">
          <div className="desk-hero__title">Use Windows apps <span className={`desk-pill${on ? ' desk-pill--on' : ''}`}>{on ? 'On' : 'Off'}</span></div>
          <div className="desk-hero__sub">DEX opens and uses apps in the background, off your screen, without taking your mouse, keyboard or focus. Watch it in a task’s Desk tab.</div>
        </div>
        <Switch checked={on} onChange={(v) => save({ enabled: v })} label="Use Windows apps" />
        <div className="desk-stats">
          <div><b>{installed?.length ?? '…'}</b><span>apps on this PC</span></div>
          <div><b>{running.length}</b><span>open now</span></div>
          <div><b>{journal?.total ?? '…'}</b><span>changes made</span></div>
          <div><b>{settings.askFirst.length + settings.blocked.length}</b><span>apps with rules</span></div>
        </div>
      </div>

      {on && (
        <>
          <div className="desk-card">
            <div className="desk-toggle">
              <div>
                <div className="desk-toggle__title">Ask the first time a task uses an app</div>
                <div className="desk-toggle__sub">One “Let DEX use Spotify for this task?” per app. Applies with Approve for me and Ask; Full access stays quiet.</div>
              </div>
              <Switch checked={settings.firstUseAsks} onChange={(v) => save({ firstUseAsks: v })} label="Ask the first time a task uses an app" />
            </div>
          </div>

          <div className="desk-lists">
            <AppList
              title="Ask first"
              sub="DEX asks before it starts using these in a task, whatever the approval mode."
              tone="ask"
              items={settings.askFirst}
              installed={installed}
              running={running}
              exclude={[...settings.askFirst, ...settings.blocked]}
              onChange={(askFirst) => save({ askFirst })}
            />
            <AppList
              title="Never use"
              sub="DEX won’t open, read or touch these, in any task."
              tone="never"
              items={settings.blocked}
              installed={installed}
              running={running}
              exclude={[...settings.askFirst, ...settings.blocked]}
              onChange={(blocked) => save({ blocked })}
            />
          </div>

          <div className="desk-card desk-always">
            <span className="desk-always__icon"><Icon d={SHIELD} size={14} /></span>
            <div className="desk-always__text">
              <div className="desk-toggle__title">Always off-limits</div>
              <div className="desk-always__chips">{ALWAYS_OFF.map((a) => <span key={a}>{a}</span>)}</div>
            </div>
          </div>
        </>
      )}

      {elevation?.supported && (
        <div className="desk-card">
          <div className="desk-toggle">
            <div>
              <div className="desk-toggle__title">
                Admin changes
                <span className={`desk-pill${elevation.installed && !elevation.outdated ? ' desk-pill--on' : elevation.outdated ? ' desk-pill--warn' : ''}`}>
                  {elevation.installed ? (elevation.outdated ? 'Needs an update' : 'Set up') : 'Not set up'}
                </span>
              </div>
              <div className="desk-toggle__sub">A small helper Windows trusts once, so a change that needs admin rights (clearing system temp files, turning off a startup service) doesn’t ask every time. You still approve each one.</div>
            </div>
            <div className="desk-toggle__actions">
              {elevation.installed && <button type="button" className="conn-card__btn conn-card__btn--secondary" disabled={busy === 'admin'} onClick={() => { void setUpAdmin(true); }}>Remove</button>}
              {(!elevation.installed || elevation.outdated) && (
                <button type="button" className="conn-card__btn conn-card__btn--primary" disabled={busy === 'admin'} onClick={() => { void setUpAdmin(false); }}>{busy === 'admin' ? 'Waiting for Windows…' : elevation.outdated ? 'Update' : 'Set up'}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* What DEX changed, with Undo. */}
      <div className="desk-card desk-journal">
        <div className="desk-journal__head">
          <div>
            <div className="desk-toggle__title">Recent changes</div>
            <div className="desk-toggle__sub">Every change DEX made to this PC, newest first. Each also has Undo in its task’s chat.</div>
          </div>
          <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void window.electronAPI?.desk?.openJournal(); }}><Icon d={FOLDER} size={12} /> Open folder</button>
        </div>
        {(note || error) && <div className={`desk-note${error ? ' desk-note--bad' : ''}`} role="status">{error ?? note}</div>}
        {journal === null ? (
          <div className="desk-list__empty">Reading the journal…</div>
        ) : journal.entries.length === 0 ? (
          <div className="desk-journal__empty">No changes yet. When DEX changes a setting, closes an app or cleans up files, it shows here with a way back.</div>
        ) : (
          <ul className="desk-journal__rows">
            {journal.entries.map((e) => (
              <li key={`${e.sessionId}/${e.id}`} className={`desk-change${e.undone ? ' is-undone' : ''}`}>
                <span className={`desk-change__dot${e.admin ? ' is-admin' : ''}`} aria-hidden="true" />
                <div className="desk-change__text">
                  <div className="desk-change__title">{e.title}{e.admin && <span className="desk-pill desk-pill--warn">admin</span>}{e.undone && <span className="desk-pill">undone</span>}</div>
                  <div className="desk-change__sub">{[ago(e.at), e.task ? `in “${e.task}”` : null, e.reason].filter(Boolean).join(' · ')}</div>
                </div>
                {e.canUndo && (
                  <button type="button" className="conn-card__btn conn-card__btn--secondary desk-change__undo" disabled={busy === e.id} onClick={() => { void undo(e); }}>
                    <Icon d={UNDO} size={12} />{busy === e.id ? 'Undoing…' : 'Undo'}
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
