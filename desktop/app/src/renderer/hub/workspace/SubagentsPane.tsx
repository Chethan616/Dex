/**
 * SubagentsPane — the Subagents tab's surface (UI/claude_see_this_if_u_have_
 * time_do_this_simple_basic_ui_thing_1.png, _1.1, _2.png): "Active · N" and
 * "Done · N" lists, each row the subagent's own bot avatar, its name, a live
 * activity line ("inspecting current file") or "25m ago". Clicking a row
 * opens that subagent's own transcript — its prompt, steps and result — in
 * this same pane (its own "clicking a row shows..." from the brief).
 *
 * Avatars in this list are still (`animate={false}`): the fluidity rule is
 * "nothing animates forever in a list" on desktop as much as on the phone —
 * a small CSS dot carries the "still working" signal instead.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AgentAvatar } from '../../components/lib';
import { currentActivity, type Subagent, type SubagentStep } from '../subagents';
import { formatDuration } from '../chat/turns';
import './subagents.css';

export interface SubagentsPaneProps {
  subagents: Subagent[];
}

/** A clock that ticks only while something on screen is counting (same pattern as ChatView's useNow). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function agoLabel(ms: number | undefined, now: number): string {
  if (!ms) return '';
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function Row({ a, now, onOpen }: { a: Subagent; now: number; onOpen: () => void }): React.ReactElement {
  const active = a.status === 'active';
  const activity = active ? currentActivity(a) : null;
  const elapsed = a.startedAt ? formatDuration((active ? now : (a.endedAt ?? now)) - a.startedAt) : null;
  return (
    <button type="button" className={`sa-row${active ? ' sa-row--active' : ''}`} onClick={onOpen}>
      <span className="sa-row__avatar-wrap">
        <AgentAvatar sessionId={a.id} size={28} animate={false} className="sa-row__avatar" />
        {active && <span className="sa-row__live-dot" aria-hidden="true" />}
      </span>
      <span className="sa-row__text">
        <span className="sa-row__name">{a.name}</span>
        {activity && <span className="sa-row__activity">{activity}</span>}
      </span>
      <span className="sa-row__time">{active ? elapsed : agoLabel(a.endedAt, now)}</span>
    </button>
  );
}

function StepRow({ step }: { step: SubagentStep }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const label = step.kind === 'tool_call' ? (step.name ?? 'tool') : `${step.name ?? 'tool'} result`;
  return (
    <div className={`sa-step${step.kind === 'tool_result' && step.ok === false ? ' sa-step--failed' : ''}`}>
      <button type="button" className="sa-step__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sa-step__kind">{step.kind === 'tool_call' ? 'Called' : 'Result'}</span>
        <span className="sa-step__name">{label}</span>
        {step.ms != null && <span className="sa-step__ms">{formatDuration(step.ms)}</span>}
      </button>
      {open && step.preview && <pre className="sa-step__preview">{step.preview}</pre>}
    </div>
  );
}

function Detail({ a, onBack }: { a: Subagent; onBack: () => void }): React.ReactElement {
  const now = useNow(a.status === 'active');
  const elapsed = a.startedAt ? formatDuration((a.status === 'active' ? now : (a.endedAt ?? now)) - a.startedAt) : null;
  return (
    <div className="sa sa--detail">
      <button type="button" className="sa-back" onClick={onBack}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M7.5 3L4.5 6l3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Subagents
      </button>
      <div className="sa-detail__head">
        <AgentAvatar sessionId={a.id} size={36} animate={false} />
        <div className="sa-detail__title">
          <span className="sa-detail__name">{a.name}</span>
          <span className="sa-detail__meta">
            {a.subagentType ? `${a.subagentType} · ` : ''}
            {a.status === 'active' ? `Working${elapsed ? ` · ${elapsed}` : ''}` : `Done${elapsed ? ` · ${elapsed}` : ''}`}
          </span>
        </div>
      </div>
      {a.prompt && <p className="sa-detail__prompt">{a.prompt}</p>}
      <div className="sa-detail__steps">
        {a.steps.length === 0 ? (
          <p className="sa-empty">{a.status === 'active' ? 'Just started — no steps yet.' : 'No steps were recorded.'}</p>
        ) : (
          a.steps.map((s, i) => <StepRow key={i} step={s} />)
        )}
      </div>
      {a.status === 'done' && (
        <div className={`sa-detail__result${a.ok === false ? ' sa-detail__result--error' : ''}`}>
          {a.summary || (a.ok === false ? 'Failed.' : 'Done.')}
        </div>
      )}
    </div>
  );
}

export function SubagentsPane({ subagents }: SubagentsPaneProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = useMemo(() => subagents.filter((a) => a.status === 'active'), [subagents]);
  const done = useMemo(() => subagents.filter((a) => a.status === 'done'), [subagents]);
  const now = useNow(active.length > 0);
  const selected = selectedId ? subagents.find((a) => a.id === selectedId) : undefined;

  if (selected) return <Detail a={selected} onBack={() => setSelectedId(null)} />;

  return (
    <div className="sa">
      <section className="sa-section">
        <h3 className="sa-section__title">Active · {active.length}</h3>
        {active.length === 0 ? (
          <p className="sa-empty">No active subagents</p>
        ) : (
          active.map((a) => <Row key={a.id} a={a} now={now} onOpen={() => setSelectedId(a.id)} />)
        )}
      </section>
      <section className="sa-section">
        <h3 className="sa-section__title">Done · {done.length}</h3>
        {done.length === 0 ? (
          <p className="sa-empty">None finished yet</p>
        ) : (
          done.map((a) => <Row key={a.id} a={a} now={now} onOpen={() => setSelectedId(a.id)} />)
        )}
      </section>
    </div>
  );
}
