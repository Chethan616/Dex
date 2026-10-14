/**
 * Settings › Desktop control (docs/desktop-control/PLAN.md §Phase 3): whether
 * DEX uses Windows apps at all, which apps it asks about first, which it never
 * uses, and the journal of what it changed. Saved by main
 * (main/desktop/deskSettings.ts); the Windows server and the approval path
 * read it on every call, so a change applies at once.
 */
import React, { useEffect, useId, useState } from 'react';
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

function AppList({ label, sublabel, items, suggestions, onChange }: {
  label: string;
  sublabel: string;
  items: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (): void => {
    const name = draft.trim();
    if (!name) return;
    const exe = name.toLowerCase().endsWith('.exe') ? name.toLowerCase() : `${name.toLowerCase()}.exe`;
    if (!items.includes(exe)) onChange([...items, exe]);
    setDraft('');
  };
  return (
    <div className="settings-pane__row settings-pane__row--stack desk-apps">
      <div>
        <div className="settings-pane__label">{label}</div>
        <div className="settings-pane__sublabel">{sublabel}</div>
      </div>
      <div className="desk-apps__list">
        {items.map((exe) => (
          <span key={exe} className="desk-apps__chip" title={exe}>
            {appName(exe)}
            <button type="button" aria-label={`Remove ${appName(exe)}`} onClick={() => onChange(items.filter((i) => i !== exe))}>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </span>
        ))}
        <form className="desk-apps__add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input
            list={listId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an app, e.g. Outlook"
            aria-label={`Add to ${label}`}
            spellCheck={false}
          />
          <datalist id={listId}>
            {suggestions.filter((s) => !items.includes(s)).map((s) => <option key={s} value={s.replace(/\.exe$/, '')}>{appName(s)}</option>)}
          </datalist>
          <button type="submit" className="conn-card__btn conn-card__btn--secondary" disabled={!draft.trim()}>Add</button>
        </form>
      </div>
    </div>
  );
}

export function DesktopControlSection(): React.ReactElement | null {
  const api = window.electronAPI?.settings?.desktop;
  const [settings, setSettings] = useState<DesktopControlSettings | null>(null);
  const [running, setRunning] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api?.get().then(setSettings).catch(() => setSettings(null));
    void api?.runningApps().then(setRunning).catch(() => setRunning([]));
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
    <div className="settings-card">
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
            suggestions={running}
            onChange={(askFirst) => save({ askFirst })}
          />
          <AppList
            label="Never use"
            sublabel="Always off-limits too: password managers, Windows Security and sign-in, terminals, other AI agents, and DEX itself."
            items={settings.blocked}
            suggestions={running}
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
