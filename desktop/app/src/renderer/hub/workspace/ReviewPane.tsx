/**
 * The Review tab (docs/unify/PLAN.md §3.6, Ctrl+Shift+G): everything this
 * task changed. Files it edited or wrote, each with its line diffs (from the
 * agent's own Edit/Write calls, review.ts); the files it handed over; and the
 * changes it made to the PC, with Undo.
 */
import React, { memo, useMemo, useState } from 'react';
import type { AgentSession } from '../types';
import { showFile } from '../chat/FileCards';
import { FileBadge } from '../chat/fileKinds';
import { DeskChanges, changesFrom } from '../chat/DeskChanges';
import { changeCounts, collectReview, diffLines, type ReviewEdit, type ReviewFile } from './review';
import './review.css';

const WRITE_PREVIEW_LINES = 200;

const EditDiff = memo(function EditDiff({ edit }: { edit: ReviewEdit }): React.ReactElement {
  if (edit.kind === 'add' || edit.kind === 'update' || edit.kind === 'delete') {
    const what = edit.kind === 'add' ? 'Added' : edit.kind === 'delete' ? 'Deleted' : 'Changed';
    return <div className="rv-note">{what} (this engine doesn’t say which lines).</div>;
  }
  if (edit.kind === 'write') {
    const lines = (edit.after ?? '').replace(/\r\n/g, '\n').split('\n');
    const shown = lines.slice(0, WRITE_PREVIEW_LINES);
    return (
      <div className="rv-diff" role="table" aria-label="Written">
        {shown.map((t, i) => <div key={i} className="rv-line rv-line--add" role="row"><span className="rv-sign">+</span><span>{t || ' '}</span></div>)}
        {lines.length > shown.length && <div className="rv-gap">{lines.length - shown.length} more lines</div>}
      </div>
    );
  }
  const rows = diffLines(edit.before ?? '', edit.after ?? '');
  return (
    <div className="rv-diff" role="table" aria-label="Edit">
      {rows.map((r, i) => (r.type === 'gap'
        ? <div key={i} className="rv-gap">{r.count} unchanged line{r.count === 1 ? '' : 's'}</div>
        : (
          <div key={i} className={`rv-line${r.type === '+' ? ' rv-line--add' : r.type === '-' ? ' rv-line--del' : ''}`} role="row">
            <span className="rv-sign">{r.type === ' ' ? '' : r.type}</span>
            <span>{r.text || ' '}</span>
          </div>
        )))}
    </div>
  );
});

function FileBlock({ sessionId, file, startOpen }: { sessionId: string; file: ReviewFile; startOpen: boolean }): React.ReactElement {
  const [open, setOpen] = useState(startOpen);
  const counts = useMemo(() => changeCounts(file), [file]);
  const verb = file.edits.some((e) => e.kind === 'write') ? 'Written'
    : file.edits.some((e) => e.kind === 'add') ? 'Added'
      : file.edits.some((e) => e.kind === 'delete') ? 'Deleted'
        : file.edits.length ? 'Edited' : 'Made';
  return (
    <section className="rv-file">
      <header className="rv-file__head">
        <button type="button" className="rv-file__toggle" aria-expanded={open} disabled={file.edits.length === 0} onClick={() => setOpen((v) => !v)}>
          {file.edits.length > 0 && (
            <svg className={`rv-chev${open ? ' rv-chev--open' : ''}`} viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
              <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <FileBadge name={file.name} size="sm" />
          <span className="rv-file__name">{file.name}</span>
          <span className="rv-file__path" title={file.path}>{file.path}</span>
        </button>
        {(counts.added > 0 || counts.removed > 0) && (
          <span className="rv-file__counts">
            {counts.added > 0 && <span className="rv-add">+{counts.added}</span>}
            {counts.removed > 0 && <span className="rv-del">−{counts.removed}</span>}
          </span>
        )}
        <span className="rv-file__verb">{verb}{file.edits.length > 1 ? ` · ${file.edits.length} times` : ''}</span>
        {file.made && (
          <button type="button" className="rv-open" onClick={() => { void showFile(sessionId, file.path); }}>Open</button>
        )}
      </header>
      {open && file.edits.length > 0 && (
        <div className="rv-file__edits">
          {file.edits.map((e, i) => <EditDiff key={i} edit={e} />)}
        </div>
      )}
    </section>
  );
}

export function ReviewPane({ session }: { session: AgentSession }): React.ReactElement {
  const files = useMemo(() => collectReview(session.output as ReadonlyArray<{ type?: string } & Record<string, unknown>>), [session.output]);
  const changes = useMemo(() => changesFrom(session.output), [session.output]);
  const totals = useMemo(() => files.reduce((t, f) => {
    const c = changeCounts(f);
    return { added: t.added + c.added, removed: t.removed + c.removed };
  }, { added: 0, removed: 0 }), [files]);

  return (
    <div className="rv">
      <div className="rv-head">
        <h2 className="rv-title">Review</h2>
        {files.length > 0 && (
          <span className="rv-summary">
            {files.length} file{files.length === 1 ? '' : 's'}
            {totals.added > 0 && <span className="rv-add">+{totals.added}</span>}
            {totals.removed > 0 && <span className="rv-del">−{totals.removed}</span>}
          </span>
        )}
      </div>
      {files.length === 0 && changes.length === 0 ? (
        <p className="rv-empty">Nothing changed yet. Files this task edits or makes, and changes it makes to your PC, show up here.</p>
      ) : (
        <>
          {files.map((f, i) => <FileBlock key={f.path} sessionId={session.id} file={f} startOpen={i < 3} />)}
          {changes.length > 0 && <div className="rv-pc"><DeskChanges sessionId={session.id} changes={changes} heading="Changes to this PC" /></div>}
        </>
      )}
    </div>
  );
}
