import './support/isolate';
/**
 * Slice 7 — the scheduler.
 *
 *   npm run test:scheduler
 *
 * The interesting cases are all about *not* running: a schedule that fires
 * twice for one minute, an hour of missed slots arriving at once after a
 * suspend, and — the one that matters most — a task firing at 3am into a
 * confirmation card nobody can answer.
 *
 * The clock is injected, so a week passes in milliseconds and nothing here
 * depends on wall time.
 */
import { Scheduler } from '../core/scheduler/scheduler';
import { ScheduleStore } from '../core/scheduler/store';
import {
  CronError,
  describeCron,
  matches,
  nextRun,
  parseCron,
  parseSchedule,
} from '../core/scheduler/cron';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { AgentResult, ExecutionPlan } from '../core/events/types';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Local time, so the assertions read the way a person would say them. */
function at(iso: string): Date {
  const [date, time] = iso.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function main(): Promise<void> {
  // ── reading what people type ─────────────────────────────────────────────

  const phrases: Array<[string, string]> = [
    ['every day at 8', '0 8 * * *'],
    ['every day at 8:30', '30 8 * * *'],
    ['every day at 9pm', '0 21 * * *'],
    ['every day at 12am', '0 0 * * *'],
    ['every weekday at 07:30', '30 7 * * 1-5'],
    ['every monday at 9', '0 9 * * 1'],
    ['every 30 minutes', '*/30 * * * *'],
    ['every 2 hours', '0 */2 * * *'],
    ['every hour', '0 * * * *'],
    ['0 8 * * 1-5', '0 8 * * 1-5'],
  ];
  const misread = phrases.filter(([text, want]) => parseSchedule(text).source !== want);
  check(
    'reads the phrases people actually type',
    misread.length === 0,
    misread.map(([t, w]) => `"${t}" -> ${parseSchedule(t).source}, want ${w}`).join('; '),
  );

  let rejected = 0;
  for (const bad of ['every day at 99', 'every blursday at 9', 'sometimes', '* * *', '5-1 * * * *']) {
    try {
      parseSchedule(bad);
    } catch (err) {
      if (err instanceof CronError) rejected += 1;
    }
  }
  check('nonsense is refused with a CronError', rejected === 5, `${rejected}/5`);

  // ── when it fires ────────────────────────────────────────────────────────

  const daily8 = parseCron('0 8 * * *');
  check('matches the minute it should', matches(daily8, at('2026-09-01 08:00')));
  check('and not the minute after', !matches(daily8, at('2026-09-01 08:01')));

  const next = nextRun(daily8, at('2026-09-01 09:00'));
  check(
    'next run rolls to tomorrow',
    next?.getDate() === 2 && next?.getHours() === 8,
    String(next),
  );

  // The standard cron quirk: with both day fields restricted, either matching
  // is enough. Deviating from it would surprise anyone who has written one.
  const firstOrMonday = parseCron('0 0 1 * 1');
  check(
    'day-of-month OR day-of-week when both are restricted',
    matches(firstOrMonday, at('2026-09-01 00:00')) &&
      matches(firstOrMonday, at('2026-09-07 00:00')),
  );

  const weekdays = parseCron('30 7 * * 1-5');
  check(
    'weekdays only',
    matches(weekdays, at('2026-08-28 07:30')) && !matches(weekdays, at('2026-08-29 07:30')),
  );

  check('describes itself readably', describeCron(daily8) === 'every day at 08:00',
    describeCron(daily8));

  // ── the engine ───────────────────────────────────────────────────────────

  const store = new ScheduleStore();
  const submitted: string[] = [];
  let clock = at('2026-09-01 07:59');

  const submitter = {
    async handle(_source: 'schedule', _sender: string, text: string) {
      submitted.push(text);
      return { status: 'COMPLETED', summary: 'done', requestId: `r${submitted.length}` };
    },
  };

  store.save({ name: 'morning', cron: parseCron('0 8 * * *'), request: 'check my unread email' });
  const scheduler = new Scheduler(submitter, store, { now: () => clock });

  check('nothing fires before it is due', (await scheduler.tick()).length === 0);

  clock = at('2026-09-01 08:00');
  const fired = await scheduler.tick();
  check('fires on the minute', fired.includes('morning'), fired.join(','));

  // Ticks are sub-minute, so the same minute is seen repeatedly. Firing once is
  // the whole point of claiming the due minute up front.
  const again = await scheduler.tick();
  check('does not fire twice in the same minute', again.length === 0, again.join(','));

  await new Promise((r) => setTimeout(r, 30));
  check('the task was actually submitted', submitted.length === 1, `${submitted.length}`);
  check('submitted the owner’s own words', submitted[0] === 'check my unread email');

  // Suspend for seven hours. An "hourly" job must not deliver seven at once.
  //
  // Note this is a second *handle* on the same table — db() is a singleton — so
  // both schedulers see both schedules. That is how it works in production too,
  // which is why the assertions below name the schedule they care about instead
  // of counting everything that fired.
  const hourly = new ScheduleStore();
  const hourlySubmitted: string[] = [];
  let hourlyClock = at('2026-09-01 01:00');
  hourly.save({ name: 'hourly', cron: parseCron('0 * * * *'), request: 'ping' });
  const napper = new Scheduler(
    {
      async handle(_s: 'schedule', _i: string, text: string) {
        hourlySubmitted.push(text);
        return { status: 'COMPLETED', summary: 'ok', requestId: 'x' };
      },
    },
    hourly,
    { now: () => hourlyClock },
  );

  await napper.tick();
  hourlyClock = at('2026-09-01 09:00'); // machine was asleep 02:00–08:00
  await napper.tick();
  await new Promise((r) => setTimeout(r, 30));
  check(
    'a suspended machine does not wake to a backlog',
    hourlySubmitted.length === 2,
    `${hourlySubmitted.length} runs — catching up would have sent 8`,
  );

  // Restart: the same schedule, a fresh engine, the same minute already done.
  const restarted = new Scheduler(submitter, store, { now: () => clock });
  check(
    'a restart does not re-run what already ran',
    (await restarted.tick()).length === 0,
  );

  const record = store.get('morning');
  check('one firing counts once', record?.runCount === 1, `runCount=${record?.runCount}`);
  check('and is recorded as completed', record?.lastStatus === 'COMPLETED', String(record?.lastStatus));

  // Pausing is not deleting.
  store.setEnabled('morning', false);
  clock = at('2026-09-02 08:00');
  const whilePaused = await scheduler.tick();
  check(
    'a paused schedule does not fire',
    !whilePaused.includes('morning'),
    `fired=${whilePaused.join(',')}`,
  );
  check('paused is not deleted', store.get('morning') !== undefined);

  store.setEnabled('morning', true);
  clock = at('2026-09-03 08:00');
  check(
    'and resuming brings it back',
    (await scheduler.tick()).includes('morning'),
  );

  // ── the one that matters: nobody is there to approve ─────────────────────

  {
    const registry = new AgentRegistry();
    registry.register({
      name: 'Fake',
      capabilities: ['can_control_os'],
      async execute(): Promise<AgentResult> {
        return { success: true, data: {} };
      },
    } as never);

    // No provider attached — exactly the 3am case, where the
    // ConfirmationManager would otherwise auto-approve as a headless
    // convenience.
    const confirmations = new ConfirmationManager(2_000, 2_000);
    const orchestrator = new Orchestrator(
      registry,
      new ReliabilityLayer(new EvidenceStore('data/evidence')),
      false,
      confirmations,
      new CancellationRegistry(),
    );

    const risky = (unattended: boolean): ExecutionPlan => ({
      requestId: `req_${unattended}`,
      intent: 'delete something',
      tier: 2,
      unattended,
      steps: [
        {
          id: 'step_1',
          capability: 'can_control_os',
          action: 'set_dns',
          params: { primary: '1.1.1.1' },
          confirmationTier: 2,
          dependsOn: [],
        },
      ],
    });

    const attended = await orchestrator.execute(risky(false));
    check(
      'interactively, a headless run still auto-approves (unchanged)',
      attended.status === 'COMPLETED',
      attended.status,
    );

    const unattended = await orchestrator.execute(risky(true));
    check(
      'unattended, a Tier 2 step is refused rather than auto-approved',
      unattended.status !== 'COMPLETED',
      `status=${unattended.status} — a schedule must not approve on the owner's behalf`,
    );
  }

  console.log();
  console.log(`${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(2);
});
