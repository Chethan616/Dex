/**
 * Reminders that survive the app being closed.
 *
 *     npm run test:reminders
 *
 * What this replaces: a 471-line screen backed by a list on a Dart object.
 * Reminders were lost on restart, and nothing ever fired one — the screen let
 * the owner write down a time and then quietly forgot it, which is worse than
 * not having the screen.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-reminders-'));
process.env.DEX_DB = path.join(scratch, 'dex.db');

// eslint-disable-next-line import/first
import { ScheduleStore } from '../core/scheduler/store';
// eslint-disable-next-line import/first
import { Scheduler } from '../core/scheduler/scheduler';
// eslint-disable-next-line import/first
import { closeDb, quietSqliteWarning } from '../core/memory/db';

quietSqliteWarning();

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const store = new ScheduleStore();
const MINUTE = 60_000;

section('A reminder is stored, not held in memory');

const soon = Date.now() + 5 * MINUTE;
const made = store.remind({ text: 'stand up and stretch', at: soon });

check('it comes back with what was said', made.request === 'stand up and stretch');
check('and when it is due', made.onceAt === Math.round(soon), String(made.onceAt));
check('marked as a reminder, not a task', made.kind === 'reminder');
check('with no cron expression to misread', made.cron === '');

// A fresh store object, as a restarted core would have.
const afterRestart = new ScheduleStore().reminders();
check('it survives a restart', afterRestart.length === 1, String(afterRestart.length));
check(
  'which is the whole point — the old ones lived on a Dart object',
  afterRestart[0].request === 'stand up and stretch',
);

check(
  'and it does not appear as a schedule to run',
  new ScheduleStore().list().filter((s) => s.kind === 'task').length === 0,
);

section('Due means due, not "due this minute"');

const overdue = store.remind({ text: 'take the bins out', at: Date.now() - 90 * MINUTE });

// The rule that differs from a cron schedule. A missed hourly summary is a
// summary nobody needs any more; a missed "leave for the dentist" is the
// entire reason the reminder existed.
const due = store.dueReminders(Date.now());
check(
  'a reminder missed while the machine slept is still due',
  due.some((r) => r.name === overdue.name),
  JSON.stringify(due.map((r) => r.request)),
);
check(
  'one set for later is not',
  !due.some((r) => r.name === made.name),
  JSON.stringify(due.map((r) => r.request)),
);

section('It fires once');

let toasts = 0;
const clock = { at: new Date() };
const scheduler = new Scheduler(
  { handle: async () => ({ status: 'COMPLETED', summary: '', requestId: 'x' }) },
  store,
  { now: () => clock.at, tickMs: 60_000 },
);

// The notifier is replaced rather than mocked at the module level: what is
// under test is that the scheduler rings it exactly once, not what Windows
// does with the toast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(scheduler as any).ring = async function ringForTest(reminder: { name: string }, minute: number) {
  toasts += 1;
  store.claim(reminder.name, minute);
  store.recordResult(reminder.name, 'COMPLETED');
};

void scheduler.tick();
void scheduler.tick();

check('an overdue reminder rings', toasts >= 1, String(toasts));
check(
  'and does not ring again on the next tick',
  toasts === 1,
  `${toasts} rings`,
);

section('Snooze, complete, forget');

check('snoozing moves it', store.snooze(overdue.name, Date.now() + 30 * MINUTE));
const snoozed = new ScheduleStore().reminders().find((r) => r.name === overdue.name);
check('and it is not due any more', !store.dueReminders(Date.now()).some((r) => r.name === overdue.name));
check(
  'and it can ring again, because snoozing means it has not happened yet',
  snoozed?.lastFiredAt === null,
  String(snoozed?.lastFiredAt),
);

check('completing it works', store.complete(made.name));
check(
  'and it leaves the list',
  !new ScheduleStore().reminders().some((r) => r.name === made.name),
);
check(
  'but stays on disk, so "what did I have on" can still answer',
  new ScheduleStore().reminders({ includeDone: true }).some((r) => r.name === made.name),
);

check('deleting removes it for good', store.delete(overdue.name));
check(
  'completely',
  !new ScheduleStore().reminders({ includeDone: true }).some((r) => r.name === overdue.name),
);

section('Bad input is refused, not stored');

let refused = 0;
for (const bad of [
  () => store.remind({ text: '   ', at: Date.now() }),
  () => store.remind({ text: 'ok', at: Number.NaN }),
]) {
  try {
    bad();
  } catch {
    refused += 1;
  }
}
check('an empty reminder and a reminder with no time are both refused', refused === 2);
check('snoozing something that does not exist says so', !store.snooze('nope', Date.now()));
check('so does completing it', !store.complete('nope'));

closeDb();
fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
