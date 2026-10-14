/**
 * The saved workflows in the chat (the widget kit's `workflows` type, from
 * `/workflow` or `dex-workflow show`): a card each — the name, when it runs,
 * how many steps, when next — with View (the graph) and Run now, like a
 * flight card's Select.
 *
 * View shows the workflow as it is now when it still exists (it may have
 * changed since the cards were drawn), else the copy the cards carry.
 */
import React, { useCallback, useState } from 'react';
import { nextRunText, triggerText, type Workflow } from '../../../shared/workflows';
import { WorkflowGraph } from './WorkflowGraph';
import { WfGlyph } from './glyphs';

type RunState = 'idle' | 'starting' | 'started' | 'failed';

function useRun(id: string): [RunState, () => void] {
  const [state, setState] = useState<RunState>('idle');
  const run = useCallback(() => {
    setState('starting');
    void (window.electronAPI?.workflows?.run(id) ?? Promise.resolve({ error: 'unavailable' }))
      .then((r) => setState(r.error ? 'failed' : 'started'))
      .catch(() => setState('failed'))
      .finally(() => { window.setTimeout(() => setState('idle'), 2400); });
  }, [id]);
  return [state, run];
}

function WorkflowCard({ workflow }: { workflow: Workflow }): React.ReactElement {
  const [open, setOpen] = useState<Workflow | null>(null);
  const [runState, run] = useRun(workflow.id);
  const next = nextRunText(workflow, Date.now());
  const canRun = Boolean(window.electronAPI?.workflows);

  const view = useCallback(() => {
    setOpen(workflow);
    void window.electronAPI?.workflows?.get(workflow.id).then((live) => { if (live) setOpen(live); }).catch(() => undefined);
  }, [workflow]);

  return (
    <div className="cx-wc__item">
      <span className="cx-wc__icon"><WfGlyph name={workflow.trigger.kind === 'manual' ? 'flow' : 'clock'} size={17} /></span>
      <div className="cx-wc__text">
        <span className="cx-wc__title">{workflow.name}</span>
        <span className="cx-wc__sub">{triggerText(workflow.trigger)}</span>
        <span className="cx-wc__line">
          {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}{next ? ` · ${next}` : ''}
        </span>
      </div>
      {!workflow.enabled && workflow.trigger.kind !== 'manual' && (
        <div className="cx-wc__side"><span className="cx-wc__badge cx-wc__badge--muted">Paused</span></div>
      )}
      <div className="cx-wc__actions">
        <button type="button" className="cx-wbtn cx-wbtn--small cx-wbtn--primary" onClick={view}>
          <WfGlyph name="flow" size={13} /><span>View</span>
        </button>
        {canRun && (
          <button type="button" className="cx-wbtn cx-wbtn--small" onClick={run} disabled={runState === 'starting'}>
            <WfGlyph name={runState === 'started' ? 'check' : 'play'} size={13} />
            <span>{runState === 'starting' ? 'Starting…' : runState === 'started' ? 'Started' : runState === 'failed' ? 'Couldn’t start' : 'Run now'}</span>
          </button>
        )}
      </div>
      {open && <WorkflowGraph workflow={open} onClose={() => setOpen(null)} onRun={canRun ? run : undefined} runState={runState} />}
    </div>
  );
}

export function WorkflowCards({ title, items }: { title?: string; items: Workflow[] }): React.ReactElement {
  return (
    <div className="cx-wc">
      <div className="cx-wc__head"><WfGlyph name="flow" size={15} /><span>{title ?? (items.length === 1 ? 'Workflow' : 'Your workflows')}</span></div>
      {items.length === 0 ? (
        <div className="cx-wc__item cx-wc__item--empty">
          <span className="cx-wc__icon"><WfGlyph name="flow" size={17} /></span>
          <div className="cx-wc__text">
            <span className="cx-wc__title">No workflows yet</span>
            <span className="cx-wc__line">Ask DEX to make one — “every weekday at 7:30, check the weather and summarise my mail”.</span>
          </div>
        </div>
      ) : items.map((w) => <WorkflowCard key={w.id} workflow={w} />)}
    </div>
  );
}
