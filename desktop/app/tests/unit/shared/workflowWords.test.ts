/**
 * Workflows from the shapes agents actually write: a schedule in words or as
 * cron, steps that name an action instead of a title — what Haiku sent, over
 * and over, in the chat where no workflow could be made.
 */
import { describe, expect, it } from 'vitest';
import { parseWorkflowInput, triggerFromText } from '../../../src/shared/workflows';

describe('a schedule in words', () => {
  it('reads the ways people say when', () => {
    expect(triggerFromText('on demand')).toEqual({ kind: 'manual' });
    expect(triggerFromText('only when I ask')).toEqual({ kind: 'manual' });
    expect(triggerFromText('every day at 8am')).toEqual({ kind: 'daily', time: '08:00' });
    expect(triggerFromText('daily 21:30')).toEqual({ kind: 'daily', time: '21:30' });
    expect(triggerFromText('every morning')).toEqual({ kind: 'daily', time: '08:00' });
    expect(triggerFromText('weekdays at 7:30')).toEqual({ kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' });
    expect(triggerFromText('mon and fri at 9 pm')).toEqual({ kind: 'weekly', days: ['mon', 'fri'], time: '21:00' });
    expect(triggerFromText('every sunday at 6')).toEqual({ kind: 'weekly', days: ['sun'], time: '06:00' });
    expect(triggerFromText('whenever')).toBeNull();
  });

  it('reads a cron line', () => {
    expect(triggerFromText('0 8 * * *')).toEqual({ kind: 'daily', time: '08:00' });
    expect(triggerFromText('30 18 * * 1-5')).toEqual({ kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '18:30' });
    expect(triggerFromText('0 9 * * 0,6')).toEqual({ kind: 'weekly', days: ['sat', 'sun'], time: '09:00' });
  });
});

describe('a spec the way agents write it', () => {
  it('takes a schedule string and action-named steps', () => {
    const r = parseWorkflowInput({
      name: 'Fasten my PC',
      schedule: '0 8 * * *',
      steps: [
        { action: 'system_change', params: { command: 'temp_clean' }, description: 'Clear temporary files' },
        { action: 'system_change', command: 'startup_disable' },
      ],
    });
    expect(r.error).toBeNull();
    expect(r.input?.trigger).toEqual({ kind: 'daily', time: '08:00' });
    expect(r.input?.steps.map((s) => [s.kind, s.title])).toEqual([['pc', 'Clear temporary files'], ['pc', 'Startup disable']]);
  });

  it('takes the plain form dex-workflow builds from --when and --step', () => {
    const r = parseWorkflowInput({ name: 'Mail summary', trigger: 'on demand', steps: [{ kind: 'task', title: 'Summarise today’s mail' }, { kind: 'notify', title: 'Send it to me' }] });
    expect(r.error).toBeNull();
    expect(r.input?.trigger).toEqual({ kind: 'manual' });
  });
});
