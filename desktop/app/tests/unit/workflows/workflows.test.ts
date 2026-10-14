/**
 * Workflows and routines (shared/workflows.ts, main/workflows/): reading what
 * agents write, when a routine runs, the store, and the scheduler.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDue, lastScheduledAt, nextRunAt, nextRunText, normalizeTime, parseWorkflowInput, parseWorkflowPatch,
  triggerText, workflowPrompt, CATCH_UP_MS, type Workflow,
} from '../../../src/shared/workflows';
import { parseWidget } from '../../../src/shared/widgets';
import { WorkflowStore } from '../../../src/main/workflows/store';
import { runDue } from '../../../src/main/workflows/scheduler';

/** A local time on a known week: Mon 12 Oct 2026 is a Monday. */
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, day, hh, mm).getTime();

function wf(over: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf_test01', name: 'Morning routine', trigger: { kind: 'daily', time: '07:30' },
    steps: [{ id: 's1', kind: 'web', title: 'Check the weather' }], enabled: true,
    createdAt: at(1, 9), updatedAt: at(1, 9), ...over,
  };
}

describe('reading a workflow spec', () => {
  it('takes the shape agents tend to write: schedule, "7:30 am", weekdays, steps as strings', () => {
    const { input, error } = parseWorkflowInput({
      title: 'Morning routine',
      schedule: { every: 'weekdays', at: '7:30 am' },
      steps: ['Check the weather', { type: 'browser', name: 'Read the news', description: 'BBC' }, { action: 'notify', title: 'Send me a summary' }],
    });
    expect(error).toBeNull();
    expect(input!.name).toBe('Morning routine');
    expect(input!.trigger).toEqual({ kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' });
    expect(input!.steps.map((s) => [s.id, s.kind, s.title])).toEqual([
      ['s1', 'task', 'Check the weather'], ['s2', 'web', 'Read the news'], ['s3', 'notify', 'Send me a summary'],
    ]);
    expect(input!.steps[1].detail).toBe('BBC');
    expect(input!.enabled).toBe(true);
  });

  it('makes every day of the week a daily routine, and no trigger a manual one', () => {
    expect(parseWorkflowInput({ name: 'A', trigger: { days: 'mon tue wed thu fri sat sun', time: '9pm' }, steps: ['x'] }).input!.trigger)
      .toEqual({ kind: 'daily', time: '21:00' });
    expect(parseWorkflowInput({ name: 'B', steps: ['x'] }).input!.trigger).toEqual({ kind: 'manual' });
  });

  it('says what is wrong and shows the shape to use', () => {
    const r = parseWorkflowInput({ name: 'C', trigger: { kind: 'daily', time: '25:00' }, steps: [] });
    expect(r.input).toBeNull();
    expect(r.error).toMatch(/steps/);
    expect(r.error).toMatch(/A workflow looks like/);
  });

  it('changes only what an update gives', () => {
    const { patch } = parseWorkflowPatch({ schedule: { kind: 'daily', time: '08:00' } });
    expect(patch).toEqual({ trigger: { kind: 'daily', time: '08:00' } });
  });

  it('reads times the way people write them', () => {
    expect(normalizeTime('7:30')).toBe('07:30');
    expect(normalizeTime('7.30 pm')).toBe('19:30');
    expect(normalizeTime('12 am')).toBe('00:00');
    expect(normalizeTime('noonish')).toBe('noonish');
  });
});

describe('when a routine runs', () => {
  it('says its schedule as a person would', () => {
    expect(triggerText({ kind: 'manual' })).toBe('When you run it');
    expect(triggerText({ kind: 'daily', time: '07:30' })).toBe('Every day at 7:30 am');
    expect(triggerText({ kind: 'weekly', days: ['fri', 'mon', 'tue', 'wed', 'thu'], time: '09:00' })).toBe('Weekdays at 9:00 am');
    expect(triggerText({ kind: 'weekly', days: ['sun', 'sat'], time: '10:15' })).toBe('Weekends at 10:15 am');
    expect(triggerText({ kind: 'weekly', days: ['fri'], time: '18:00' })).toBe('Every Fri at 6:00 pm');
    expect(triggerText({ kind: 'weekly', days: ['wed', 'mon'], time: '12:00' })).toBe('Mon, Wed at 12:00 pm');
  });

  it('finds the next and the last scheduled time', () => {
    const weekdays = { kind: 'weekly' as const, days: ['mon', 'tue', 'wed', 'thu', 'fri'] as ('mon' | 'tue' | 'wed' | 'thu' | 'fri')[], time: '07:30' };
    // Friday 16th at 8:00 → next is Monday 19th at 7:30; last was Friday 7:30.
    expect(nextRunAt(weekdays, at(16, 8))).toBe(at(19, 7, 30));
    expect(lastScheduledAt(weekdays, at(16, 8))).toBe(at(16, 7, 30));
    expect(nextRunAt({ kind: 'manual' }, at(16, 8))).toBeNull();
    expect(nextRunText(wf(), at(16, 6))).toBe('Next: today at 7:30 am');
    expect(nextRunText(wf(), at(16, 8))).toBe('Next: tomorrow at 7:30 am');
    expect(nextRunText(wf({ enabled: false }), at(16, 8))).toBe('Paused');
  });

  it('is due once its time has passed, and not again until the next time', () => {
    const w = wf();
    expect(isDue(w, at(16, 7, 29))).toBe(false);
    expect(isDue(w, at(16, 7, 30))).toBe(true);
    expect(isDue({ ...w, lastRun: { at: at(16, 7, 30), by: 'schedule' } }, at(16, 7, 31))).toBe(false);
    expect(isDue({ ...w, lastRun: { at: at(16, 7, 30), by: 'schedule' } }, at(17, 7, 30))).toBe(true);
  });

  it('still runs a routine the PC slept through, but not hours late', () => {
    const w = wf();
    expect(isDue(w, at(16, 7, 30) + CATCH_UP_MS - 1)).toBe(true);
    expect(isDue(w, at(16, 7, 30) + CATCH_UP_MS + 1)).toBe(false);
  });

  it('does not fire for a time that passed before it was made or changed', () => {
    expect(isDue(wf({ createdAt: at(16, 8), updatedAt: at(16, 8) }), at(16, 8, 1))).toBe(false);
    expect(isDue(wf({ enabled: false }), at(16, 7, 31))).toBe(false);
    expect(isDue(wf({ trigger: { kind: 'manual' } }), at(16, 7, 31))).toBe(false);
  });

  it('gives a run its steps in order, with how to do each kind', () => {
    const p = workflowPrompt(wf({ steps: [{ id: 's1', kind: 'web', title: 'Check the weather', detail: 'Hyderabad' }, { id: 's2', kind: 'ask', title: 'Book a cab?' }] }), 'schedule');
    expect(p).toMatch(/^Run my workflow “Morning routine” \(it started on its schedule: every day at 7:30 am\)/);
    expect(p).toMatch(/1\. Check the weather — Hyderabad \(the web: an MCP connector first/);
    expect(p).toMatch(/2\. Book a cab\? \(ask the user with dex-ui/);
  });
});

describe('the workflows widget', () => {
  it('carries whole workflows, so the phone can draw the graph too', () => {
    const { widget, error } = parseWidget({ type: 'workflows', items: [wf()] });
    expect(error).toBeNull();
    expect(widget!.type).toBe('workflows');
  });
});

let dir: string | null = null;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });
function freshStore(now = () => at(14, 12)): WorkflowStore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-wf-'));
  return new WorkflowStore(path.join(dir, 'workflows.json'), now);
}

describe('the workflow store', () => {
  it('keeps workflows across restarts, with the engine they were made with', () => {
    const store = freshStore();
    const { workflow } = store.create({ name: 'Morning routine', trigger: { kind: 'daily', time: '07:30' }, steps: ['Check the weather'] }, { engine: 'claude-code', model: 'haiku' });
    expect(workflow!.id).toMatch(/^wf_[a-f0-9]{10}$/);
    const again = new WorkflowStore(path.join(dir!, 'workflows.json'));
    expect(again.list()).toHaveLength(1);
    expect(again.get(workflow!.id)).toMatchObject({ name: 'Morning routine', engine: 'claude-code', model: 'haiku' });
  });

  it('finds a workflow the way people name it, and says when the name is ambiguous', () => {
    const store = freshStore();
    store.create({ name: 'Morning routine', steps: ['a'] });
    store.create({ name: 'Morning news', steps: ['b'] });
    store.create({ name: 'Friday review', steps: ['c'] });
    expect(store.find('friday').workflow?.name).toBe('Friday review');
    expect(store.find('MORNING ROUTINE').workflow?.name).toBe('Morning routine');
    expect(store.find('morning').error).toMatch(/could be “Morning routine” or “Morning news”/);
    expect(store.find('weekly').error).toMatch(/No workflow is called “weekly”/);
  });

  it('refuses a second workflow with the same name', () => {
    const store = freshStore();
    store.create({ name: 'Morning routine', steps: ['a'] });
    expect(store.create({ name: 'morning routine', steps: ['b'] }).error).toMatch(/already exists/);
  });

  it('updates only what changed, and a run is not an edit', () => {
    let now = at(14, 12);
    const store = freshStore(() => now);
    const { workflow } = store.create({ name: 'Morning routine', trigger: { kind: 'daily', time: '07:30' }, steps: ['a', 'b'] });
    now = at(14, 13);
    const { workflow: changed } = store.update(workflow!.id, { trigger: { kind: 'daily', time: '08:00' } });
    expect(changed!.steps).toHaveLength(2);
    expect(changed!.trigger).toEqual({ kind: 'daily', time: '08:00' });
    expect(changed!.updatedAt).toBe(at(14, 13));
    store.recordRun(workflow!.id, { at: at(15, 8), by: 'schedule' });
    expect(store.get(workflow!.id)!.updatedAt).toBe(at(14, 13));
    expect(store.remove(workflow!.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('skips a broken entry in the file instead of losing the rest', () => {
    const store = freshStore();
    store.create({ name: 'Good', steps: ['a'] });
    const file = path.join(dir!, 'workflows.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    raw.workflows.push({ id: 'nope', name: '' });
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(new WorkflowStore(file).list().map((w) => w.name)).toEqual(['Good']);
  });
});

describe('the scheduler', () => {
  it('starts what is due once, recording the run before it starts', async () => {
    let now = at(14, 7, 0);
    const store = freshStore(() => now);
    store.create({ name: 'Morning routine', trigger: { kind: 'daily', time: '07:30' }, steps: ['a'] });
    store.create({ name: 'By hand', steps: ['b'] });
    const startRun = vi.fn(async () => 'session-1');
    now = at(14, 7, 30);
    expect(await runDue({ store, startRun, now: () => now })).toHaveLength(1);
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ name: 'Morning routine' }), 'schedule');
    expect(store.find('Morning routine').workflow!.lastRun).toEqual({ at: now, by: 'schedule', sessionId: 'session-1' });
    now = at(14, 7, 31);
    expect(await runDue({ store, startRun, now: () => now })).toHaveLength(0);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it('does not start a run again after a start that failed', async () => {
    let now = at(14, 7, 0);
    const store = freshStore(() => now);
    store.create({ name: 'Morning routine', trigger: { kind: 'daily', time: '07:30' }, steps: ['a'] });
    now = at(14, 7, 30);
    const startRun = vi.fn(async () => { throw new Error('engine not installed'); });
    await runDue({ store, startRun, now: () => now });
    now = at(14, 7, 31);
    await runDue({ store, startRun, now: () => now });
    expect(startRun).toHaveBeenCalledTimes(1);
  });
});
