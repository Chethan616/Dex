import { emit } from '../events/bus';
import { Cron, matches, parseCron } from './cron';
import { notify } from './notify';
import { Schedule, ScheduleStore } from './store';

/** What the scheduler needs from the Gateway. Narrow, so it is easy to fake. */
export interface Submitter {
  handle(
    source: 'schedule',
    senderId: string,
    text: string,
  ): Promise<{ status: string; summary: string; requestId: string }>;
}

export interface SchedulerOptions {
  /** How often to look at the clock. Shorter than a minute so none is missed. */
  tickMs?: number;
  /** Injectable for tests. */
  now?: () => Date;
}

/**
 * Runs saved schedules.
 *
 * Two decisions shape the whole thing.
 *
 * **Missed runs are skipped, not caught up.** The engine only ever asks "does
 * anything match the minute it is now". A machine asleep from 2am to 9am wakes
 * to nothing pending, rather than to seven hours of backlog arriving at once —
 * which is how a "send me a summary hourly" job turns into seven summaries and
 * a rate limit. What was missed is recorded, not replayed.
 *
 * **A schedule cannot answer a question.** Firing at 3am there is nobody to
 * approve a confirmation card, so runs are marked `unattended` and the
 * Orchestrator refuses any step that would need one rather than hanging until
 * the card expires — or, worse, auto-approving because no UI happens to be
 * attached. What a schedule may contain is settled when it is created; see
 * `describeRisk`.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly tickMs: number;
  private readonly now: () => Date;

  /** Schedules mid-run, so a slow task cannot overlap its own next firing. */
  private running = new Set<string>();

  /** Parsed crons, keyed by expression — parsing is pure, so cache it. */
  private crons = new Map<string, Cron>();

  constructor(
    private submitter: Submitter,
    private store = new ScheduleStore(),
    options: SchedulerOptions = {},
  ) {
    this.tickMs = options.tickMs ?? 20_000;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    const due = this.store.active().length;
    if (due > 0) {
      emit('routing', `Scheduler watching ${due} schedule(s)`, 'scheduler');
    }
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    // Never hold the process open on its own account. If nothing else is
    // running there is nothing for a schedule to do anyway.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass over the clock. Exposed so tests can drive it without waiting.
   *
   * Returns the names fired, which is the only thing worth asserting on.
   */
  async tick(): Promise<string[]> {
    const at = this.now();
    const minute = floorToMinute(at);
    const fired: string[] = [];

    // Reminders first, and by wall clock rather than by cron minute.
    //
    // A reminder set for 16:32 is due at 16:32 and every moment after it: if
    // the machine was asleep then, the owner still wants to be told, which is
    // the opposite of the rule for recurring schedules. Missing a "summary
    // every hour" is a summary nobody needs any more; missing "leave for the
    // dentist" is the whole point of having set it.
    for (const reminder of this.store.dueReminders(at.getTime())) {
      if (this.running.has(reminder.name)) continue;
      fired.push(reminder.name);
      void this.ring(reminder, minute);
    }

    for (const schedule of this.store.active()) {
      // Handled above, on its own clock.
      if (schedule.kind === 'reminder') continue;
      if (this.running.has(schedule.name)) continue;
      if (!this.isDue(schedule, at, minute)) continue;

      fired.push(schedule.name);
      // Not awaited: one slow schedule must not delay another due in the same
      // minute, and `running` already prevents it overlapping itself.
      void this.fire(schedule, minute);
    }

    return fired;
  }

  private isDue(schedule: Schedule, at: Date, minute: number): boolean {
    let cron = this.crons.get(schedule.cron);
    if (!cron) {
      try {
        cron = parseCron(schedule.cron);
        this.crons.set(schedule.cron, cron);
      } catch (err) {
        emit(
          'failed',
          `Schedule "${schedule.name}" has an unreadable expression and will ` +
            `never run: ${err instanceof Error ? err.message : err}`,
          'scheduler',
        );
        this.store.setEnabled(schedule.name, false);
        return false;
      }
    }

    if (!matches(cron, at)) return false;

    // Already done this minute. The guard is what makes a sub-minute tick safe
    // and what stops a restart re-firing something that already ran.
    return (schedule.lastFiredAt ?? 0) < minute;
  }

  /**
   * A reminder comes due.
   *
   * Nothing is planned and nothing runs — that is the difference between a
   * reminder and a schedule, and it is why a reminder needs no unattended-risk
   * assessment. It says a thing to the owner and stops.
   */
  private async ring(reminder: Schedule, dueMinute: number): Promise<void> {
    this.running.add(reminder.name);
    // Claimed before the toast, so a crash between the two leaves it fired
    // rather than pending. A reminder shown twice is worse than one shown late.
    this.store.claim(reminder.name, dueMinute);

    try {
      const shown = await notify('Dex reminder', reminder.request);
      this.store.recordResult(reminder.name, shown ? 'COMPLETED' : 'NOT_SHOWN');
      emit(
        'done',
        `Reminder: ${reminder.request}`,
        'scheduler',
        undefined,
        { reminder: reminder.name, dueAt: reminder.onceAt, shown },
      );
    } catch (err) {
      this.store.recordResult(reminder.name, 'FAILED');
      emit(
        'failed',
        `Could not show the reminder "${reminder.request}": ` +
          `${err instanceof Error ? err.message : err}`,
        'scheduler',
      );
    } finally {
      this.running.delete(reminder.name);
    }
  }

  private async fire(schedule: Schedule, dueMinute: number): Promise<void> {
    this.running.add(schedule.name);

    // Claimed before the run, not after. A crash mid-task would otherwise leave
    // the schedule looking un-fired, and it would go again on the next tick.
    this.store.claim(schedule.name, dueMinute);

    emit('routing', `Scheduled: "${schedule.name}" — ${schedule.request}`, 'scheduler');

    try {
      const result = await this.submitter.handle('schedule', 'owner', schedule.request);
      this.store.recordResult(schedule.name, result.status);

      const line = `Scheduled "${schedule.name}": ${result.status} — ${result.summary}`;
      emit(result.status === 'COMPLETED' ? 'done' : 'failed', line, result.requestId);
    } catch (err) {
      this.store.recordResult(schedule.name, 'FAILED');
      emit(
        'failed',
        `Scheduled "${schedule.name}" threw: ${err instanceof Error ? err.message : err}`,
        'scheduler',
      );
    } finally {
      this.running.delete(schedule.name);
    }
  }
}

function floorToMinute(when: Date): number {
  return Math.floor(when.getTime() / 60_000) * 60_000;
}
