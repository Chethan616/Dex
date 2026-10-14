/**
 * Settings › Desktop control (docs/desktop-control/PLAN.md §Phase 3): whether
 * DEX uses Windows apps at all, which apps it asks about first, which it never
 * uses, and the journal of what it changed. Saved by main
 * (main/desktop/deskSettings.ts); the Windows server and the approval path
 * read it on every call, so a change applies at once.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appName } from '../../shared/deskWords';
import { Switch } from '../components/lib';
import './desktop-control.css';

function Row({ label, sublabel, children }: { label: string; sublabel: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="settings-pane__row">
      <div>
        <div className="settings-pane__label">{label}</div>
        <div className="settings-pane__sublabel">{sublabel}</div>
      </div>
      {children}
    </div>
  );
}

type AppInfo = { name: string; exe: string };

/** A letter tile for an app (Windows apps' own icons aren't reachable from here). */
function AppTile({ name }: { name: string }): React.ReactElement {
  return <span className="desk-app__tile" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Pick an app: a search over everything installed (not only what's open),
 * with the apps open now as suggestions. At most eight rows, never the whole list.
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
  const results: AppInfo[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) {
      // Suggestions: the apps open now, by name.
      return running.filter((exe) => !exclude.includes(exe)).map((exe) => byExe.get(exe) ?? { exe, name: appName(exe) }).slice(0, 6);
    }
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
  }, [q, installed, running, exclude, byExe]);
  useEffect(() => setActive(0), [q]);

  return (
    <div className="desk-pick" ref={boxRef} role="dialog" aria-label="Choose an app">
      <input
        autoFocus
        className="desk-pick__search"
        value={q}
        placeholder="Search your apps"
        aria-label="Search your apps"
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); onPick(results[active].exe); }
        }}
      />
      <div className="desk-pick__label">{q.trim() ? (results.length ? 'Apps' : 'No app by that name') : running.length ? 'Open now' : ''}</div>
      <ul className="desk-pick__list" role="listbox">
        {results.map((a, i) => (
          <li key={a.exe}>
            <button type="button" role="option" aria-selected={i === active} className={`desk-pick__row${i === active ? ' desk-pick__row--on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(a.exe)}>
              <AppTile name={a.name} />
              <span className="desk-pick__name">{a.name}</span>
              <span className="desk-pick__exe">{a.exe}</span>
            </button>
          </li>
        ))}
      </ul>
      {!q.trim() && (
        <div className="desk-pick__foot">{installed === null ? 'Finding your apps…' : `Type to search all ${installed.length} apps on this PC, open or not.`}</div>
      )}
    </div>
  );
}

function AppList({ label, sublabel, items, installed, running, exclude, onChange }: {
  label: string;
  sublabel: string;
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
    <div className="settings-pane__row settings-pane__row--stack desk-apps">
      <div>
        <div className="settings-pane__label">{label}</div>
        <div className="settings-pane__sublabel">{sublabel}</div>
      </div>
      <div className="desk-apps__list">
        {items.map((exe) => (
          <span key={exe} className="desk-apps__chip" title={exe}>
            <AppTile name={nameOf(exe)} />
            {nameOf(exe)}
            <button type="button" aria-label={`Remove ${nameOf(exe)}`} onClick={() => onChange(items.filter((i) => i !== exe))}>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </span>
        ))}
        <span className="desk-apps__add-wrap">
          <button type="button" className="desk-apps__add" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Add app
          </button>
          {picking && (
            <AppPicker
              installed={installed}
              running={running}
              exclude={exclude}
              onPick={(exe) => { onChange([...items, exe]); setPicking(false); }}
              onClose={() => setPicking(false)}
            />
          )}
        </span>
      </div>
    </div>
  );
}

export function DesktopControlSection(): React.ReactElement | null {
  const api = window.electronAPI?.settings?.desktop;
  const [settings, setSettings] = useState<DesktopControlSettings | null>(null);
  const [running, setRunning] = useState<string[]>([]);
  const [installed, setInstalled] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api?.get().then(setSettings).catch(() => setSettings(null));
    // Read once here, so the picker has them by the time it opens (a few seconds the first time).
    void api?.apps().then((r) => { setInstalled(r.installed); setRunning(r.running); }).catch(() => setInstalled([]));
  }, [api]);

  if (!api || !settings) return null;
  if (!settings.supported) {
    return (
      <div className="settings-card">
        <Row label="Desktop control" sublabel="Using your apps in the background is Windows-only for now." />
      </div>
    );
  }

  const save = (patch: Partial<Omit<DesktopControlSettings, 'supported'>>): void => {
    setError(null);
    setSettings({ ...settings, ...patch });   // at once; main answers with the cleaned-up lists
    api.set(patch).then(setSettings).catch(() => { setError('Couldn’t save that. Try again.'); void api.get().then(setSettings); });
  };

  return (
    <div className="settings-card desk-card">
      <Row
        label="Use Windows apps"
        sublabel="DEX opens and uses apps in the background, off your screen, without taking your mouse, keyboard or focus. Watch it in a task’s Desk tab."
      >
        <Switch checked={settings.enabled} onChange={(on) => save({ enabled: on })} label="Use Windows apps" />
      </Row>
      {settings.enabled && (
        <>
          <Row
            label="Ask the first time a task uses an app"
            sublabel="One “Let DEX use Spotify for this task?” per app. Applies with Approve for me and Ask; Full access stays quiet."
          >
            <Switch checked={settings.firstUseAsks} onChange={(on) => save({ firstUseAsks: on })} label="Ask the first time a task uses an app" />
          </Row>
          <AppList
            label="Ask first"
            sublabel="DEX asks before it starts using these in a task, whatever the approval mode. Good for mail and chat apps."
            items={settings.askFirst}
            installed={installed}
            running={running}
            exclude={[...settings.askFirst, ...settings.blocked]}
            onChange={(askFirst) => save({ askFirst })}
          />
          <AppList
            label="Never use"
            sublabel="Always off-limits too: password managers, Windows Security and sign-in, terminals, other AI agents, and DEX itself."
            items={settings.blocked}
            installed={installed}
            running={running}
            exclude={[...settings.askFirst, ...settings.blocked]}
            onChange={(blocked) => save({ blocked })}
          />
        </>
      )}
      <Row
        label="Change journal"
        sublabel={error ?? 'Every change DEX made to this PC, with how to undo it. Each change also has an Undo button in its task’s chat.'}
      >
        <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void window.electronAPI?.desk?.openJournal(); }}>
          Open
        </button>
      </Row>
    </div>
  );
}
