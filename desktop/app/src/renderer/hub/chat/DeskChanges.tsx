/**
 * Changes DEX made to the PC with the Windows tools (their undo journal),
 * each with Undo while it can be undone — your click is the approval. In the
 * chat under the turn that made them, and in the Desk tab.
 */
import React, { useState } from 'react';
import type { Block } from '../../logs/transcript';

type Change = Extract<Block, { kind: 'change' }>;

/** A task's changes from its raw events, each marked once a later one undid it. */
export function changesFrom(output: ReadonlyArray<{ type: string }>): Change[] {
  const list: Change[] = [];
  output.forEach((raw, i) => {
    if (raw.type !== 'desk_change') return;
    const e = raw as { entry?: unknown; title?: unknown; reason?: unknown; undoable?: unknown; undone?: unknown; undoes?: unknown; restartNeeded?: unknown; at?: number };
    if (typeof e.entry !== 'string') return;
    const undoes = typeof e.undoes === 'string' ? e.undoes : undefined;
    if (undoes) { const j = list.findIndex((c) => c.entry === undoes); if (j >= 0) list[j] = { ...list[j], undone: true }; }
    list.push({
      kind: 'change', id: i, entry: e.entry, title: String(e.title ?? ''), reason: typeof e.reason === 'string' ? e.reason : undefined,
      undoable: e.undoable === true, undone: e.undone === true, undoes, restartNeeded: e.restartNeeded === true || undefined, at: e.at,
    });
  });
  return list;
}

function failureText(r: { error?: string; message?: string } | undefined): string {
  if (r?.error === 'elevation_not_set_up') return 'Undoing this needs DEX’s admin helper: Settings › Agent approval › Admin changes.';
  if (r?.error === 'nothing_to_undo') return 'That change was already undone.';
  return r?.message || 'The undo didn’t work.';
}

export function DeskChanges({ sessionId, changes, heading = 'Changed on your PC' }: { sessionId: string; changes: Change[]; heading?: string }): React.ReactElement | null {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An undo next to the change it undid says nothing the "Undone" mark doesn't.
  const here = new Set(changes.map((c) => c.entry));
  const rows = changes.filter((c) => !(c.undoes && here.has(c.undoes)));
  if (rows.length === 0) return null;

  const undo = async (entry: string): Promise<void> => {
    setBusy(entry);
    setError(null);
    try {
      const r = await window.electronAPI?.desk?.undo(sessionId, entry);
      if (!r?.ok) setError(failureText(r));
    } catch {
      setError(failureText(undefined));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cx-changes">
      <div className="cx-changes__head">
        <span>{heading}</span>
        <button type="button" className="cx-changes__journal" onClick={() => { void window.electronAPI?.desk?.openJournal(sessionId); }}>
          Journal
        </button>
      </div>
      <ul className="cx-changes__list">
        {rows.map((c) => (
          <li key={c.entry} className={`cx-change${c.undone ? ' cx-change--undone' : ''}`}>
            <span className="cx-change__text">
              <span className="cx-change__title">{c.title}</span>
              {(c.reason || c.restartNeeded) && (
                <span className="cx-change__why">
                  {c.restartNeeded ? 'Takes effect after a restart.' : ''}{c.restartNeeded && c.reason ? ' ' : ''}{c.undoes ? '' : c.reason}
                </span>
              )}
            </span>
            {c.undone ? (
              <span className="cx-change__done">Undone</span>
            ) : c.undoable ? (
              <button type="button" className="cx-change__undo" disabled={busy !== null} onClick={() => { void undo(c.entry); }}>
                {busy === c.entry ? 'Undoing…' : 'Undo'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error && <div className="cx-changes__error" role="alert">{error}</div>}
    </div>
  );
}
