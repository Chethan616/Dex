/**
 * The minibar: the floating card at the chat's top right (Codex's, reshaped
 * for DEX). What's working on this, how far along it is, what it made, and
 * what it drew on — each a click from the thing itself.
 */
import React, { useState } from 'react';
import { FileBadge } from './fileKinds';
import { showFile } from './FileCards';
import type { FileItem, Source } from './turns';
import type { TaskStep } from '../types';

interface MinibarProps {
  /** The task's own face, beside its title. */
  avatar?: React.ReactNode;
  sessionId: string;
  title: string;
  engineName: string;
  engineIcon?: string;
  model?: string;
  status: string;
  steps: TaskStep[];
  outputs: FileItem[];
  docs: Array<{ title: string; onOpen: () => void }>;
  sources: Source[];
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

const SHOWN_SOURCES = 4;

function StepGlyph({ status }: { status: TaskStep['status'] }): React.ReactElement {
  if (status === 'done') {
    return <svg className="cx-step__glyph cx-step__glyph--done" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (status === 'failed') {
    return <svg className="cx-step__glyph cx-step__glyph--failed" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  }
  return <span className={`cx-step__dot cx-step__dot--${status}`} aria-hidden="true" />;
}

function SourceIcon({ source }: { source: Source }): React.ReactElement {
  const d = source.kind === 'search'
    ? 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.5 10.5L14 14'
    : source.kind === 'tool'
      ? 'M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5'
      : 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM1.8 8h12.4M8 1.8c1.7 1.9 2.5 4 2.5 6.2s-.8 4.3-2.5 6.2M8 1.8C6.3 3.7 5.5 5.8 5.5 8s.8 4.3 2.5 6.2';
  return (
    <svg className="cx-mini__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function sourceLabel(s: Source): string {
  if (s.kind === 'site') return s.host;
  if (s.kind === 'search') return s.query;
  return s.name;
}

export function Minibar({ avatar, sessionId, title, engineName, engineIcon, model, status, steps, outputs, docs, sources, onOpenUrl, onClose }: MinibarProps): React.ReactElement {
  const [allSources, setAllSources] = useState(false);
  const shownSources = allSources ? sources : sources.slice(0, SHOWN_SOURCES);
  const doneSteps = steps.filter((s) => s.status === 'done').length;

  return (
    <aside className="cx-mini" aria-label="About this task">
      <div className="cx-mini__head">
        {avatar && <span className="cx-mini__avatar">{avatar}</span>}
        <span className="cx-mini__title" title={title}>{title}</span>
        <button type="button" className="cx-mini__close" onClick={onClose} aria-label="Hide panel" title="Hide panel">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="cx-mini__row cx-mini__row--engine">
        {engineIcon
          ? <img className="cx-mini__icon cx-mini__icon--img" src={engineIcon} alt="" />
          : <span className="cx-mini__icon cx-mini__dot" aria-hidden="true" />}
        <span className="cx-mini__label">{engineName}{model ? <span className="cx-mini__muted"> · {model}</span> : null}</span>
        <span className={`cx-mini__status cx-mini__status--${status}`}>{status}</span>
      </div>

      {steps.length > 0 && (
        <section className="cx-mini__section">
          <div className="cx-mini__section-head"><span>Progress</span><span className="cx-mini__count">{doneSteps}/{steps.length}</span></div>
          <ol className="cx-steps">
            {steps.map((step) => (
              <li key={step.id} className={`cx-step cx-step--${step.status}`} title={step.failures.at(-1)?.reason}>
                <StepGlyph status={step.status} />
                <span className="cx-step__title">{step.title}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(outputs.length > 0 || docs.length > 0) && (
        <section className="cx-mini__section">
          <div className="cx-mini__section-head"><span>Outputs</span></div>
          {docs.map((doc, i) => (
            <button key={`doc-${i}`} type="button" className="cx-mini__row cx-mini__row--link" onClick={doc.onOpen} title={doc.title}>
              <FileBadge name="document.md" size="sm" />
              <span className="cx-mini__label">{doc.title}</span>
            </button>
          ))}
          {outputs.map((f) => (
            <button key={f.path} type="button" className="cx-mini__row cx-mini__row--link" onClick={() => void showFile(sessionId, f.path)} title={f.path}>
              <FileBadge name={f.name} mime={f.mime} size="sm" />
              <span className="cx-mini__label">{f.name}</span>
            </button>
          ))}
        </section>
      )}

      {sources.length > 0 && (
        <section className="cx-mini__section">
          <div className="cx-mini__section-head"><span>Sources</span></div>
          {shownSources.map((s, i) => (
            <button
              key={`${s.kind}-${i}`}
              type="button"
              className={`cx-mini__row${s.kind === 'site' ? ' cx-mini__row--link' : ''}`}
              onClick={s.kind === 'site' ? () => onOpenUrl(s.url) : undefined}
              title={s.kind === 'site' ? s.url : s.kind === 'search' ? `Searched: ${s.query}` : `Used ${s.name}`}
              disabled={s.kind !== 'site'}
            >
              <SourceIcon source={s} />
              <span className="cx-mini__label">{sourceLabel(s)}</span>
            </button>
          ))}
          {sources.length > SHOWN_SOURCES && (
            <button type="button" className="cx-mini__row cx-mini__more" onClick={() => setAllSources((v) => !v)}>
              <svg className="cx-mini__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="cx-mini__label">{allSources ? 'Show fewer' : `View all ${sources.length}`}</span>
            </button>
          )}
        </section>
      )}
    </aside>
  );
}
