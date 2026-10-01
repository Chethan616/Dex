/**
 * Onboarding → "Get your PC ready": the free tools DEX runs on, found or
 * installed with one click (main/setup/essentials.ts). Nothing to type; the
 * only interruption is Windows asking permission once for Git and Node.js.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Orb } from '../components/lib';
import { ArrowRight, StepFooter } from './StepFooter';

type EssentialId = 'git' | 'node' | 'bun' | 'blender' | 'uv';

interface Essential {
  id: EssentialId;
  name: string;
  why: string;
  group: 'core' | '3d';
  installed: boolean;
  detail?: string;
  asksPermission: boolean;
}

type Progress =
  | { id: EssentialId; phase: 'installing'; line?: string }
  | { id: EssentialId; phase: 'done' }
  | { id: EssentialId; phase: 'failed'; error: string };

type Live = Partial<Record<EssentialId, { phase: 'installing' | 'failed'; line?: string; error?: string }>>;

function StatusMark({ state }: { state: 'ok' | 'busy' | 'failed' | 'missing' }): React.ReactElement {
  if (state === 'busy') return <span className="setup-mark setup-mark--busy"><Orb size={20} state="working" /></span>;
  return (
    <span className={`setup-mark setup-mark--${state}`} aria-hidden="true">
      {state === 'ok' && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.4l2.7 2.7L12.5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {state === 'failed' && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 4.2v4.6M8 11.4v.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
    </span>
  );
}

export function SetupStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }): React.ReactElement {
  const api = window.onboardingAPI.setup;
  const [items, setItems] = useState<Essential[] | null>(null);
  const [live, setLive] = useState<Live>({});
  const [running, setRunning] = useState(false);
  const [want3d, setWant3d] = useState(false);

  useEffect(() => {
    void api.detect().then((list) => {
      const essentials = list as Essential[];
      setItems(essentials);
      // Blender already on the PC: 3D is on by default.
      if (essentials.some((e) => e.id === 'blender' && e.installed)) setWant3d(true);
    });
    return api.onProgress((event) => {
      const p = event as Progress;
      setLive((prev) => {
        if (p.phase === 'done') { const next = { ...prev }; delete next[p.id]; return next; }
        if (p.phase === 'failed') return { ...prev, [p.id]: { phase: 'failed', error: p.error } };
        return { ...prev, [p.id]: { phase: 'installing', line: p.line ?? prev[p.id]?.line } };
      });
    });
  }, [api]);

  const shown = (items ?? []).filter((e) => e.group === 'core' || want3d);
  const missing = shown.filter((e) => !e.installed);
  const allReady = items !== null && missing.length === 0;
  const asksPermission = missing.some((e) => e.asksPermission);

  const install = useCallback(async () => {
    if (running || missing.length === 0) return;
    setRunning(true);
    try {
      const fresh = (await api.install(missing.map((e) => e.id))) as Essential[];
      setItems(fresh);
    } finally {
      setRunning(false);
    }
  }, [api, missing, running]);

  const rowState = (e: Essential): 'ok' | 'busy' | 'failed' | 'missing' =>
    e.installed ? 'ok' : live[e.id]?.phase === 'installing' ? 'busy' : live[e.id]?.phase === 'failed' ? 'failed' : 'missing';

  return (
    <div className="step-panel setup-step">
      <h1 className="step-title">Get your PC ready</h1>
      <p className="step-subtitle">
        DEX runs on a few free tools. It installs whatever is missing for you — nothing to type.
      </p>

      {!items ? (
        <div className="setup-loading"><Orb size={32} state="searching" /><span>Checking this PC…</span></div>
      ) : (
        <div className="setup-list">
          {shown.map((e) => {
            const state = rowState(e);
            const info = live[e.id];
            return (
              <div key={e.id} className={`setup-row setup-row--${state}`}>
                <StatusMark state={state} />
                <div className="setup-row__text">
                  <span className="setup-row__name">{e.name}</span>
                  <span className="setup-row__why">
                    {state === 'busy' ? (info?.line ?? 'Downloading and installing…')
                      : state === 'failed' ? `Couldn’t install: ${info?.error ?? 'unknown error'}`
                      : e.why}
                  </span>
                </div>
                <span className="setup-row__status">
                  {state === 'ok' ? 'Ready' : state === 'busy' ? 'Installing' : state === 'failed' ? 'Failed' : 'Missing'}
                </span>
              </div>
            );
          })}

          <label className="setup-3d">
            <input type="checkbox" checked={want3d} disabled={running} onChange={(ev) => setWant3d(ev.target.checked)} />
            <span className="setup-3d__text">
              <strong>Also set up 3D</strong>
              <span>Blender, so DEX can model and render scenes for you (about 400 MB).</span>
            </span>
          </label>
        </div>
      )}

      {asksPermission && !running && !allReady && (
        <p className="setup-note">Windows may ask for permission once, to install Git or Node.js for everyone on this PC.</p>
      )}

      <StepFooter onBack={onBack} backDisabled={running}>
        {allReady ? (
          <button type="button" className="ob-btn ob-btn--primary" onClick={onContinue}>
            Continue
            <ArrowRight />
          </button>
        ) : (
          <>
            <button type="button" className="ob-btn ob-btn--text" onClick={onContinue} disabled={running}>Skip for now</button>
            <button type="button" className="ob-btn ob-btn--primary" onClick={() => { void install(); }} disabled={running || !items}>
              {running ? 'Installing…' : missing.some((e) => live[e.id]?.phase === 'failed') ? 'Try again' : `Install what’s missing (${missing.length})`}
            </button>
          </>
        )}
      </StepFooter>
    </div>
  );
}
