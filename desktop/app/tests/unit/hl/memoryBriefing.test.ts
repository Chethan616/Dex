/**
 * What every engine is told about the user at the top of a task: the core
 * facts, what the task's words reach, and a line about the rest — not the
 * whole memory every time.
 */
import { describe, expect, it } from 'vitest';
import { briefingLines } from '../../../src/main/hl/engines/memory';
import type { Topic } from '../../../src/shared/memoryTopics';

const portal = { host: 'portal.someuni.edu', url: 'https://portal.someuni.edu', aliases: ['student portal', 'attendance', 'timetable'], hasUsername: true, username: 'someone', hasPassword: true };
const note = (id: string, text: string, topic: Topic, core = false) => ({ id, text, topic, core });

describe('what DEX tells every engine about the user', () => {
  it('always gives the core facts, with ids to replace them by', () => {
    const text = briefingLines([], [], [note('m1', 'Call them Sam', 'about', true), note('m2', 'They are: student', 'about', true)], 'write a poem').join('\n');
    expect(text).toContain('About them: Call them Sam [m1] · They are: student [m2]');
  });

  it('reaches the student portal from "attendance", though no site or university is named', () => {
    const notes = [note('m3', 'Studies at Some University', 'study', true), note('m4', 'Prefers aisle seats when travelling', 'travel')];
    const text = briefingLines([portal], [], notes, 'fetch my attendance').join('\n');
    expect(text).toContain('portal.someuni.edu — they call it “student portal”, “attendance”, “timetable”; login saved');
    expect(text).not.toContain('someone');
    // Not the travel note: nothing in the request reaches it.
    expect(text).not.toContain('aisle');
    expect(text).toMatch(/DEX also remembers 2 notes \(.*\) and 1 site in all.*dex-recall/);
  });

  it('keeps a long memory out of a task it has nothing to do with', () => {
    const many = Array.from({ length: 120 }, (_, i) => note(`m${i}`, `Fact number ${i} about cooking ${'x'.repeat(60)}`, 'food'));
    const text = briefingLines([], [], many, 'rename the files in my downloads folder').join('\n');
    expect(text).not.toContain('Fact number');
    expect(text).toContain('DEX also remembers 120 notes (food)');
    expect(text.length).toBeLessThan(2000);
  });

  it('brings in the routines, and the rule that they are DEX’s own, only when the task is about routines', () => {
    const routines = [
      { name: 'Order 66', trigger: { kind: 'manual' as const }, enabled: true },
      { name: 'Fasten my PC', trigger: { kind: 'daily' as const, time: '08:00' }, enabled: true },
      { name: 'Paused one', trigger: { kind: 'manual' as const }, enabled: false },
    ];
    const about = briefingLines([], routines, [], 'make a routine that cleans my PC every morning').join('\n');
    expect(about).toContain('Their routines: “Order 66”, “Fasten my PC”.');
    expect(about).not.toContain('Paused one');
    expect(about).toMatch(/Never Windows Task Scheduler, a cron job, a cloud or remote routine/);
    expect(about).toContain('dex-workflow create "<name>" --when "<schedule>" --step "<step>"');

    const byName = briefingLines([], routines, [], 'execute order 66').join('\n');
    expect(byName).toContain('Routine “Order 66” (when you run it)');

    const other = briefingLines([], routines, [], 'summarise this pdf').join('\n');
    expect(other).not.toMatch(/Task Scheduler/);
  });

  it('sends a batch of messages to the triage card, whatever needs a reply', () => {
    for (const ask of ['Reply to my unread emails from the last 3 days', 'go through my WhatsApp messages', 'answer today’s Slack DMs']) {
      expect(briefingLines([], [], [], ask).join('\n')).toContain('ONE `dex-ui triage` card');
    }
    expect(briefingLines([], [], [], 'write a poem about rain').join('\n')).not.toContain('dex-ui triage');
  });

  it('always tells the agent to save what the user gives it, in DEX’s memory and not its own', () => {
    const text = briefingLines([], [], [], 'hi').join('\n');
    expect(text).toContain('save it at once: `dex-remember note "<one fact>"`');
    expect(text).toMatch(/not your own memory files/);
  });
});
