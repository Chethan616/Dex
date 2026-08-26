/**
 * Usage history and saved workflows.
 *
 * The two behaviours worth protecting here are both about *not* being clever:
 *
 *   * A saved workflow matches on exact shape only. Fuzzy matching would mean
 *     running the wrong recipe with the owner's numbers substituted into it —
 *     far worse than falling through to the Brain and paying for one call.
 *   * A value that was never in the plan is not a parameter. It was phrasing.
 *
 * Runs against a temporary database so it never touches data/dex.db.
 *
 * Run: npm run test:workflows
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { closeDb, db, quietSqliteWarning } from '../core/memory/db';

const TEMP_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'dex-wf-')),
  'test.db',
);

quietSqliteWarning();
db(TEMP_DB);   // must happen before anything else touches the singleton

// eslint-disable-next-line import/first
import { ExecutionPlan } from '../core/events/types';
// eslint-disable-next-line import/first
import { Telemetry } from '../core/memory/telemetry';
// eslint-disable-next-line import/first
import { matchShape, shapeOf } from '../core/workflows/shape';
// eslint-disable-next-line import/first
import { WorkflowStore } from '../core/workflows/store';

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

function planFor(steps: ExecutionPlan['steps'], intent = 'test'): ExecutionPlan {
  return { requestId: 'r', intent, tier: 1, steps };
}

const volumePlan = planFor([
  {
    id: 'step_1',
    capability: 'can_control_os',
    action: 'set_volume',
    params: { level: 30 },
    confirmationTier: 4,
    dependsOn: [],
  },
]);

// ── shape ────────────────────────────────────────────────────────────────────

function testShape(): void {
  section('Shape — the same request said two ways');

  check(
    'filler words do not change the shape',
    shapeOf('set my volume to 30').shape === shapeOf('please set volume to 30').shape,
    `${shapeOf('set my volume to 30').shape} vs ${shapeOf('please set volume to 30').shape}`,
  );
  check(
    'numbers are masked, so the values can vary',
    shapeOf('set volume to 30').shape === shapeOf('set volume to 80').shape,
  );
  check(
    'a different request has a different shape',
    shapeOf('set volume to 30').shape !== shapeOf('set dns to 30').shape,
  );
  check(
    'IPs, paths and quoted strings keep their original case',
    shapeOf('set dns to 1.1.1.1').literals[0] === '1.1.1.1' &&
      shapeOf('back up C:\\Work now').literals[0] === 'C:\\Work' &&
      shapeOf('save as "Report Q3"').literals[0] === 'Report Q3',
    JSON.stringify([
      shapeOf('set dns to 1.1.1.1').literals,
      shapeOf('back up C:\\Work now').literals,
      shapeOf('save as "Report Q3"').literals,
    ]),
  );
  check(
    'matchShape returns the differing values',
    JSON.stringify(matchShape('set volume to 80', shapeOf('set volume to 30').shape)) ===
      JSON.stringify(['80']),
  );
  check(
    'and null when the shape differs',
    matchShape('set dns to 1.1.1.1', shapeOf('set volume to 30').shape) === null,
  );
}

// ── saving and replaying ─────────────────────────────────────────────────────

function testWorkflows(): void {
  section('Workflows — save once, replay with different values');

  const store = new WorkflowStore();
  const saved = store.save({ name: 'vol', requestText: 'set my volume to 30', plan: volumePlan });

  check('a value the plan used becomes a parameter', saved.params.join() === 'level', saved.params.join());
  check(
    'and is templated out of the steps',
    saved.template[0].params.level === '{{level}}',
    JSON.stringify(saved.template[0].params),
  );

  const matched = store.matchRequest('set volume to 80');
  check('a re-phrased request matches the saved workflow', matched?.workflow.name === 'vol');
  check('with the new value extracted', matched?.args.level === '80', JSON.stringify(matched?.args));

  const bound = store.bind(saved, { level: '80' }, 'r2');
  check(
    'binding restores the number type the handler expects',
    bound.steps[0].params.level === 80 && typeof bound.steps[0].params.level === 'number',
    `${JSON.stringify(bound.steps[0].params)} (${typeof bound.steps[0].params.level})`,
  );

  const positional = store.bind(saved, store.bindPositional(saved, ['55']), 'r3');
  check('positional arguments work for `run vol 55`', positional.steps[0].params.level === 55);

  let missingReported = '';
  try {
    store.bind(saved, {}, 'r4');
  } catch (err) {
    missingReported = err instanceof Error ? err.message : String(err);
  }
  check(
    'a missing argument is reported, never guessed',
    missingReported.includes('level') && missingReported.includes('run vol'),
    missingReported,
  );

  check(
    'an unrelated request does NOT match',
    store.matchRequest('open notepad') === undefined,
  );

  // A literal that never appears in the plan is phrasing, not data — turning it
  // into a parameter would invent an argument the owner has to supply.
  const phrasing = store.save({
    name: 'dns2',
    requestText: 'set dns to 1.1.1.1 within 5 seconds',
    plan: planFor([{
      id: 'step_1', capability: 'can_control_os', action: 'set_dns',
      params: { primary: '1.1.1.1' }, confirmationTier: 4, dependsOn: [],
    }]),
  });
  check(
    'a literal the plan never used is not a parameter',
    phrasing.params.join() === 'primary',
    `params were ${JSON.stringify(phrasing.params)}`,
  );

  check('workflows are listed', store.list().some((w) => w.name === 'vol'));
  check('and can be forgotten', store.delete('dns2') && store.get('dns2') === undefined);

  let badName = '';
  try {
    store.save({ name: 'Not A Name!', requestText: 'x', plan: volumePlan });
  } catch (err) {
    badName = err instanceof Error ? err.message : String(err);
  }
  check('an unusable name is rejected', badName.includes('lowercase'), badName);
}

// ── history ──────────────────────────────────────────────────────────────────

function testTelemetry(): void {
  section('History — what you actually ask for');

  const telemetry = new Telemetry();

  const record = (text: string, workflow?: string) => {
    const id = `req_${Math.random().toString(36).slice(2)}`;
    telemetry.startTask({
      requestId: id, sessionId: 's1', source: 'cli', text, workflow,
    });
    telemetry.planned(id, planFor(volumePlan.steps, 'Set volume'));
    telemetry.step({
      requestId: id, stepId: 'step_1', capability: 'can_control_os',
      action: 'set_volume', tier: 4, status: 'ok', verification: 'VERIFIED',
    });
    telemetry.finishTask(id, 'COMPLETED');
    return id;
  };

  record('set volume to 10');
  record('set volume to 20');
  check(
    'repeats are counted by shape, not exact text',
    telemetry.timesRepeated('set volume to 99') === 2,
    String(telemetry.timesRepeated('set volume to 99')),
  );

  record('set volume to 30');
  check(
    `three repeats reaches the suggest threshold (${Telemetry.SUGGEST_AFTER})`,
    telemetry.timesRepeated('set volume to 99') >= Telemetry.SUGGEST_AFTER,
  );

  // A replay must not inflate the count, or Dex would keep offering to save
  // something already saved.
  record('set volume to 40', 'vol');
  check(
    'a workflow run does not count as a fresh repeat',
    telemetry.timesRepeated('set volume to 99') === 3,
    String(telemetry.timesRepeated('set volume to 99')),
  );

  const summary = telemetry.summary(7);
  check('summary counts tasks', summary.totalTasks === 4, String(summary.totalTasks));
  check('summary counts completions', summary.completed === 4, String(summary.completed));
  check(
    'summary separates planned from replayed',
    summary.brainCalls === 3 && summary.workflowRuns === 1,
    `brain=${summary.brainCalls} workflow=${summary.workflowRuns}`,
  );
  check(
    'summary surfaces the most-used action',
    summary.topActions[0]?.action === 'set_volume' && summary.topActions[0].runs === 4,
    JSON.stringify(summary.topActions[0]),
  );
  check('summary has a per-day breakdown', summary.byDay.length >= 1);
  check(
    'and flags what is repeated but unsaved',
    summary.repeated.some((r) => r.times >= 2),
    JSON.stringify(summary.repeated),
  );

  check('search finds a past task', telemetry.search('volume').length > 0);
  check('recent returns newest first',
    telemetry.recent(2).length === 2 &&
    telemetry.recent(2)[0].startedAt >= telemetry.recent(2)[1].startedAt);
}

function main(): void {
  console.log('\x1b[1mDEX — usage history and saved workflows\x1b[0m');
  testShape();
  testWorkflows();
  testTelemetry();

  console.log(`\n${passed} passed, ${failed} failed`);
  // Close before deleting: SQLite in WAL mode holds the file open, and Windows
  // refuses to remove a directory that still contains one.
  closeDb();
  try {
    fs.rmSync(path.dirname(TEMP_DB), { recursive: true, force: true });
  } catch {
    /* a leftover temp file is not worth failing an otherwise green run */
  }
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

main();
