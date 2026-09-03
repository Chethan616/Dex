import { db } from '../memory/db';
import { Cron, describeCron, nextRun, parseCron } from './cron';

/**
 * Saved schedules. One row per named job, persisted so they survive a restart.
 */
export interface Schedule {
  name: string;
  /** The cron expression, as stored. */
  cron: string;
  /** What to ask Dex, in the owner's own words. */
  request: string;
  createdAt: number;
  enabled: boolean;
  lastFiredAt: number | null;
  lastStatus: string | null;
  runCount: number;
  failCount: number;
  /** 'task' asks Dex to do something; 'reminder' just tells the owner. */
  kind: 'task' | 'reminder';
  /** When a one-shot is due, in epoch ms. Null for anything recurring. */
  onceAt: number | null;
  /** When the owner dealt with it. Null while it is still outstanding. */
  doneAt: number | null;
}

interface Row {
  name: string;
  cron: string;
  request: string;
  created_at: number;
  enabled: number;
  last_fired_at: number | null;
  last_status: string | null;
  run_count: number;
  fail_count: number;
  kind: string | null;
  once_at: number | null;
  done_at: number | null;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ScheduleStore {
  private handle = db();

  /** Names are how a schedule is referred to later, so they are constrained. */
  static validateName(name: string): string {
    const cleaned = name.trim().toLowerCase();
    if (!NAME_RE.test(cleaned)) {
      throw new Error(
        `"${name}" is not a usable name. Use lowercase letters, digits, ` +
          '- and _, starting with a letter or digit.',
      );
    }
    return cleaned;
  }

  save(input: { name: string; cron: Cron; request: string }): Schedule {
    const name = ScheduleStore.validateName(input.name);
    const now = Date.now();

    this.handle
      .prepare(
        `INSERT INTO schedules (name, cron, request, created_at, enabled)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET
           cron = excluded.cron,
           request = excluded.request,
           enabled = 1`,
      )
      .run(name, input.cron.source, input.request.trim(), now);

    return this.get(name)!;
  }

  get(name: string): Schedule | undefined {
    const row = this.handle
      .prepare('SELECT * FROM schedules WHERE name = ?')
      .get(ScheduleStore.validateName(name)) as unknown as Row | undefined;
    return row ? toSchedule(row) : undefined;
  }

  list(): Schedule[] {
    const rows = this.handle
      .prepare('SELECT * FROM schedules ORDER BY name')
      .all() as unknown as Row[];
    return rows.map(toSchedule);
  }

  /** Only the ones the engine should be watching. */
  active(): Schedule[] {
    return this.list().filter((s) => s.enabled);
  }

  delete(name: string): boolean {
    const before = this.list().length;
    this.handle.prepare('DELETE FROM schedules WHERE name = ?').run(name.trim().toLowerCase());
    return this.list().length < before;
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const target = name.trim().toLowerCase();
    if (!this.get(target)) return false;
    this.handle
      .prepare('UPDATE schedules SET enabled = ? WHERE name = ?')
      .run(enabled ? 1 : 0, target);
    return true;
  }

  /**
   * Set a reminder.
   *
   * A schedule that happens once and asks nothing of Dex. It gets a generated
   * name because the owner does not name a reminder — they name a schedule,
   * which is a thing they will refer to again, and a reminder is a thing they
   * want to be told once and then forget.
   */
  remind(input: { text: string; at: number }): Schedule {
    const text = input.text.trim();
    if (!text) throw new Error('A reminder needs something to say');
    if (!Number.isFinite(input.at)) throw new Error('A reminder needs a time');

    const name = `reminder-${input.at}-${Math.random().toString(36).slice(2, 8)}`;
    this.handle
      .prepare(
        `INSERT INTO schedules
           (name, cron, request, created_at, enabled, kind, once_at)
         VALUES (?, '', ?, ?, 1, 'reminder', ?)`,
      )
      .run(name, text, Date.now(), Math.round(input.at));

    return this.get(name)!;
  }

  /**
   * Reminders, soonest first.
   *
   * Ones already dealt with are left out by default. They stay on disk so
   * "what did I have on this week" can still be answered, but a list of things
   * to do should not be mostly things already done.
   */
  reminders({ includeDone = false } = {}): Schedule[] {
    const rows = this.handle
      .prepare(
        `SELECT * FROM schedules
          WHERE kind = 'reminder' ${includeDone ? '' : 'AND done_at IS NULL'}
          ORDER BY once_at ASC`,
      )
      .all() as unknown as Row[];
    return rows.map(toSchedule);
  }

  /** Reminders due at or before `at` that have not fired. */
  dueReminders(at: number): Schedule[] {
    const rows = this.handle
      .prepare(
        `SELECT * FROM schedules
          WHERE kind = 'reminder'
            AND enabled = 1
            AND done_at IS NULL
            AND once_at IS NOT NULL
            AND once_at <= ?
            AND last_fired_at IS NULL
          ORDER BY once_at ASC`,
      )
      .all(Math.round(at)) as unknown as Row[];
    return rows.map(toSchedule);
  }

  /**
   * Push a reminder out.
   *
   * Clears `last_fired_at` on purpose: snoozing means it has not happened yet,
   * so the thing that stops a reminder firing twice has to be reset or the
   * snoozed one would never come back.
   */
  snooze(name: string, until: number): boolean {
    const target = name.trim();
    if (!this.get(target)) return false;
    this.handle
      .prepare(
        `UPDATE schedules
            SET once_at = ?, last_fired_at = NULL, last_status = NULL, done_at = NULL
          WHERE name = ?`,
      )
      .run(Math.round(until), target);
    return true;
  }

  /** Mark a reminder dealt with. Kept, not deleted — see `reminders`. */
  complete(name: string): boolean {
    const target = name.trim();
    if (!this.get(target)) return false;
    this.handle
      .prepare('UPDATE schedules SET done_at = ?, enabled = 0 WHERE name = ?')
      .run(Date.now(), target);
    return true;
  }

  /**
   * Claim a due minute, before the task runs.
   *
   * Split from [recordResult] deliberately. Claiming first means a crash
   * mid-task leaves the minute marked done rather than pending, so the schedule
   * does not fire again on the next tick — and counting separately means one
   * firing counts once, however many times its status is updated.
   *
   * `dueMinute` is the minute the schedule was *for*, not when the run
   * finished. A task that takes ten minutes would otherwise stamp itself past
   * the next slot and silently skip it.
   */
  claim(name: string, dueMinute: number): void {
    this.handle
      .prepare(
        `UPDATE schedules
            SET last_fired_at = ?, last_status = 'RUNNING', run_count = run_count + 1
          WHERE name = ?`,
      )
      .run(dueMinute, name.trim().toLowerCase());
  }

  /** How the run turned out. Counts a failure, never another run. */
  recordResult(name: string, status: string): void {
    this.handle
      .prepare(
        `UPDATE schedules
            SET last_status = ?, fail_count = fail_count + ?
          WHERE name = ?`,
      )
      .run(status, status === 'COMPLETED' ? 0 : 1, name.trim().toLowerCase());
  }

  /** When this next fires, or null if the expression can never match. */
  static nextFire(schedule: Schedule, after: Date = new Date()): Date | null {
    // A one-shot has a moment, not an expression. Parsing its empty cron would
    // throw, and reporting "never" would be worse: it is due at a time the
    // owner chose.
    if (schedule.kind === 'reminder' || !schedule.cron) {
      if (schedule.onceAt === null) return null;
      const due = new Date(schedule.onceAt);
      return due > after ? due : null;
    }
    return nextRun(parseCron(schedule.cron), after);
  }

  static describe(schedule: Schedule): string {
    return describeCron(parseCron(schedule.cron));
  }
}

function toSchedule(row: Row): Schedule {
  return {
    name: row.name,
    cron: row.cron,
    request: row.request,
    createdAt: row.created_at,
    enabled: row.enabled === 1,
    lastFiredAt: row.last_fired_at,
    lastStatus: row.last_status,
    runCount: row.run_count,
    failCount: row.fail_count,
    kind: row.kind === 'reminder' ? 'reminder' : 'task',
    onceAt: row.once_at ?? null,
    doneAt: row.done_at ?? null,
  };
}
