/**
 * "Let DEX get to know you": the optional questions (shared/aboutYou.ts) and
 * the import from another assistant — in onboarding and in Settings › About
 * you. Every answer is saved the moment it's given (main/memory/notes.ts), so
 * stopping halfway keeps what was said.
 *
 * Made to be quick: one question at a time, most a single tap (a one-choice
 * question moves on by itself), Enter for the typed ones, Skip for any.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { joinChoices, questionsFor, splitChoices, type Answers, type Question } from '../../../shared/aboutYou';
import { IMPORT_PROMPT } from '../../../shared/memoryTopics';
import './about-you.css';

const api = (): ElectronMemoryAPI | undefined => window.electronAPI?.memory;

function Check(): React.ReactElement {
  return <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Chips({ q, value, onChange, onPicked }: {
  q: Question;
  value: string;
  onChange: (v: string) => void;
  /** A one-choice question picked: move on. */
  onPicked: () => void;
}): React.ReactElement {
  const chosen = splitChoices(value);
  const typed = chosen.filter((c) => !q.options?.includes(c));
  const [otherOpen, setOtherOpen] = useState(typed.length > 0);
  const [other, setOther] = useState(typed.join(', '));
  const picked = chosen.filter((c) => q.options?.includes(c));
  const compose = (list: string[], extra: string): string => joinChoices([...list, ...splitChoices(extra)]);

  const toggle = (opt: string): void => {
    if (q.kind === 'one') {
      onChange(opt);
      setOtherOpen(false);
      onPicked();
      return;
    }
    const next = picked.includes(opt) ? picked.filter((c) => c !== opt) : [...picked, opt];
    onChange(compose(next, otherOpen ? other : ''));
  };

  return (
    <div className="ay-chips" role={q.kind === 'one' ? 'radiogroup' : 'group'} aria-label={q.ask}>
      {q.options?.map((opt) => {
        const on = picked.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            role={q.kind === 'one' ? 'radio' : 'checkbox'}
            aria-checked={on}
            className={`ay-chip${on ? ' ay-chip--on' : ''}`}
            onClick={() => toggle(opt)}
          >
            {on && q.kind === 'many' && <Check />}
            {opt}
          </button>
        );
      })}
      {q.other && (otherOpen ? (
        <input
          className="ay-chip-input"
          autoFocus
          value={other}
          placeholder={`${q.other}…`}
          onChange={(e) => {
            setOther(e.target.value);
            onChange(q.kind === 'one' ? e.target.value : compose(picked, e.target.value));
          }}
          aria-label={q.other}
        />
      ) : (
        <button type="button" className="ay-chip ay-chip--add" onClick={() => setOtherOpen(true)}>
          + {q.other}
        </button>
      ))}
    </div>
  );
}

export function AboutYouQuiz({ onFinished, finishLabel = 'Finish' }: {
  onFinished?: () => void;
  finishLabel?: string;
}): React.ReactElement | null {
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    void api()?.answers().then((a) => {
      setAnswers(a);
      // Pick up where they left off: the first question not answered yet.
      const list = questionsFor(a);
      const first = list.findIndex((q) => !a[q.id]);
      setIndex(first < 0 ? 0 : first);
      if (first < 0 && list.length > 0) setDone(Object.keys(a).length > 0);
    }).catch(() => setAnswers({}));
    return () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); };
  }, []);

  const list = useMemo(() => questionsFor(answers ?? {}), [answers]);
  const q = list[Math.min(index, list.length - 1)];

  useEffect(() => {
    if (q && answers) setDraft(answers[q.id] ?? '');
    setError(null);
  }, [q, answers]);

  const go = useCallback(async (to: number, save: boolean) => {
    if (!q || !answers) return;
    if (save) {
      const value = draft.trim();
      if (value !== (answers[q.id] ?? '')) {
        const r = await api()?.answer(q.id, value).catch(() => ({ error: 'Couldn’t save that. Try again.' }));
        if (r && 'error' in r) {
          setError(/password|key|card/i.test(r.error) ? 'That looks like a password or card number — DEX doesn’t keep those.' : r.error);
          return;
        }
        const next = { ...answers };
        if (value) next[q.id] = value; else delete next[q.id];
        setAnswers(next);
      }
    }
    const nextList = questionsFor(save && draft.trim() ? { ...answers, [q.id]: draft.trim() } : answers);
    if (to >= nextList.length) {
      setDone(true);
      onFinished?.();
      return;
    }
    setIndex(Math.max(0, to));
  }, [q, answers, draft, onFinished]);
  // The auto-advance after a chip fires a beat later, after the render with
  // the new choice: it must call that render's `go`, not the one it was set in.
  const goRef = useRef(go);
  goRef.current = go;

  if (!api()) return null;
  if (!answers || !q) return <div className="ay-card ay-card--loading" aria-busy="true" />;

  const answered = list.filter((x) => answers[x.id]).length;

  if (done) {
    return (
      <div className="ay-card ay-done">
        <div className="ay-done__mark" aria-hidden="true"><Check /></div>
        <div>
          <div className="ay-done__title">{answered > 0 ? `DEX knows ${answered} thing${answered === 1 ? '' : 's'} about you` : 'Nothing saved yet'}</div>
          <div className="ay-done__sub">Every task on every engine starts with these. Change an answer any time.</div>
        </div>
        <button type="button" className="ay-btn ay-btn--quiet" onClick={() => { setDone(false); setIndex(0); }}>Go through again</button>
      </div>
    );
  }

  const position = list.indexOf(q);
  const last = position === list.length - 1;
  const onPicked = (): void => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    // A beat to see the choice land, then on.
    advanceTimer.current = window.setTimeout(() => { void goRef.current(position + 1, true); }, 220);
  };

  return (
    <div className="ay-card" onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void go(position + 1, true); }
    }}>
      <div className="ay-progress" aria-label={`Question ${position + 1} of ${list.length}`}>
        <span className="ay-progress__count">{position + 1} of {list.length}</span>
        <span className="ay-progress__bar"><i style={{ width: `${((position + 1) / list.length) * 100}%` }} /></span>
      </div>
      <div className="ay-q" key={q.id}>
        <h3 className="ay-q__ask">{q.ask}</h3>
        {q.hint && <p className="ay-q__hint">{q.hint}</p>}
        {q.kind === 'text' ? (
          <input
            className="ay-input"
            autoFocus
            value={draft}
            maxLength={400}
            placeholder={q.placeholder}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            aria-label={q.ask}
          />
        ) : (
          <Chips q={q} value={draft} onChange={(v) => { setDraft(v); setError(null); }} onPicked={onPicked} />
        )}
        {error && <div className="ay-error" role="alert">{error}</div>}
      </div>
      <div className="ay-foot">
        <button type="button" className="ay-btn ay-btn--quiet" disabled={position === 0} onClick={() => { void go(position - 1, true); }}>Back</button>
        <span className="ay-foot__space" />
        <button type="button" className="ay-btn ay-btn--quiet" onClick={() => { void go(position + 1, false); }}>Skip</button>
        <button type="button" className="ay-btn ay-btn--primary" onClick={() => { void go(position + 1, true); }}>
          {last ? finishLabel : 'Next'}
        </button>
      </div>
    </div>
  );
}

/** "Bring what ChatGPT or Claude knows about you": copy a prompt, paste the answer, keep what's right. */
export function ImportMemory(): React.ReactElement | null {
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState('');
  const [facts, setFacts] = useState<string[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  if (!api()) return null;

  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(IMPORT_PROMPT); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard refused */ }
  };
  const read = async (): Promise<void> => {
    const parsed = await api()!.parseImport(raw);
    setFacts(parsed.facts);
    setKeep(new Set(parsed.facts.map((_, i) => i)));
    setSkipped(parsed.skipped);
    setResult(null);
  };
  const save = async (): Promise<void> => {
    if (!facts) return;
    const r = await api()!.importFacts(facts.filter((_, i) => keep.has(i)));
    setResult(`Saved ${r.saved} fact${r.saved === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} left out)` : ''}. They’re in Memory, and every task can use them.`);
    setFacts(null);
    setRaw('');
  };

  return (
    <div className="ay-card ay-import">
      <ol className="ay-steps">
        <li>
          <span className="ay-steps__n">1</span>
          <div className="ay-steps__body">
            <div className="ay-steps__title">Ask ChatGPT or Claude what it knows about you</div>
            <p className="ay-prompt"><span>{IMPORT_PROMPT}</span></p>
            <div className="ay-row">
              <button type="button" className="ay-btn ay-btn--primary" onClick={() => { void copy(); }}>{copied ? 'Copied' : 'Copy the prompt'}</button>
              <button type="button" className="ay-btn ay-btn--ghost" onClick={() => { void api()!.openAssistant('chatgpt'); }}>Open ChatGPT</button>
              <button type="button" className="ay-btn ay-btn--ghost" onClick={() => { void api()!.openAssistant('claude'); }}>Open Claude</button>
            </div>
          </div>
        </li>
        <li>
          <span className="ay-steps__n">2</span>
          <div className="ay-steps__body">
            <div className="ay-steps__title">Paste its answer here</div>
            {facts === null ? (
              <>
                <textarea
                  className="ay-textarea"
                  value={raw}
                  rows={5}
                  placeholder={'- Works as a designer in Bengaluru\n- Prefers short answers\n- …'}
                  onChange={(e) => setRaw(e.target.value)}
                  aria-label="What the other assistant said"
                />
                <div className="ay-row">
                  <button type="button" className="ay-btn ay-btn--primary" disabled={!raw.trim()} onClick={() => { void read(); }}>Read it</button>
                  {result && <span className="ay-note">{result}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="ay-note">
                  {facts.length === 0 ? 'No facts found in that. Paste the list of bullet points it gave.' : `Found ${facts.length}. Untick anything that’s wrong.`}
                  {skipped > 0 && ` ${skipped} looked like a password or card number and were left out.`}
                </div>
                <ul className="ay-facts">
                  {facts.map((f, i) => (
                    <li key={i}>
                      <label className="ay-fact">
                        <input type="checkbox" checked={keep.has(i)} onChange={() => {
                          const next = new Set(keep);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          setKeep(next);
                        }} />
                        <span>{f}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="ay-row">
                  <button type="button" className="ay-btn ay-btn--quiet" onClick={() => setFacts(null)}>Back</button>
                  <button type="button" className="ay-btn ay-btn--primary" disabled={keep.size === 0} onClick={() => { void save(); }}>
                    Save {keep.size} fact{keep.size === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
