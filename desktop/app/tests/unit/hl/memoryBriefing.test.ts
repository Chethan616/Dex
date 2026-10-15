import { describe, expect, it } from 'vitest';
import { briefingLines } from '../../../src/main/hl/engines/memory';

describe('what DEX remembers, told to every engine', () => {
  const vtop = { host: 'vtop.vit.ac.in', aliases: ['university portal', 'vtop'], hasUsername: true, username: 'someone', hasPassword: true };

  it('names the sites the user gave, with whether a login is saved, and never the login', () => {
    const text = briefingLines([vtop], []).join('\n');
    expect(text).toContain('vtop.vit.ac.in — they call it “university portal”, “vtop”; login saved');
    expect(text).toContain('"my attendance"');
    expect(text).not.toContain('someone');
  });

  it('lists the saved routines and keeps routines to dex-workflow', () => {
    const text = briefingLines([], [
      { name: 'Order 66', trigger: { kind: 'manual' }, enabled: true },
      { name: 'Fasten my PC', trigger: { kind: 'daily', time: '08:00' }, enabled: true },
      { name: 'Paused one', trigger: { kind: 'manual' }, enabled: false },
    ]).join('\n');
    expect(text).toContain('“Order 66” (when you run it)');
    expect(text).toContain('“Fasten my PC” (every day at 8:00 am)');
    expect(text).not.toContain('Paused one');
    expect(text).toMatch(/Never Windows Task Scheduler, a cron job, a cloud or remote routine/);
    expect(text).toMatch(/never ask the user to paste a command into an admin PowerShell/);
  });

  it('always tells the agent to record what the user gives it', () => {
    expect(briefingLines([], []).join('\n')).toContain('record it straight away with `dex-remember`');
  });
});
