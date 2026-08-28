/**
 * Remove rows the test suite wrote into the real history.
 *
 *   npx ts-node scripts/prune-test-rows.ts          show what would go
 *   npx ts-node scripts/prune-test-rows.ts --apply  delete it
 *
 * Eight of eleven test files used to write to `data/dex.db`. The result was not
 * just noise in `/stats`: the task table held two `set_dns` runs marked
 * COMPLETED, from a suite running against a mocked agent, for an action that
 * had never once reached the daemon. Anyone reading the history to find out
 * what actually worked got a confident wrong answer.
 *
 * `tests/support/isolate.ts` stops it happening again. This clears what is
 * already there.
 *
 * Deliberately conservative — two rules, both of which mean "this cannot be a
 * real run", and nothing that merely looks like one:
 *
 *   1. a request_id that is not a UUID. Real runs get `crypto.randomUUID()`;
 *      fixtures hard-code `req_slice4`, `req_slice45`, `req-smoke-0001`.
 *
 *   2. a task marked COMPLETED that recorded no steps at all. A task cannot
 *      complete without executing anything, so the row is describing work that
 *      did not happen.
 *
 * An ABORTED task with no steps is left alone: aborting before planning is
 * exactly what the ambiguity gate does, and those are real.
 */
import { db } from '../core/memory/db';

const APPLY = process.argv.includes('--apply');

const UUID = "request_id LIKE '________-____-____-____-____________'";

interface Row {
  request_id: string;
  text?: string;
  status?: string;
  source?: string;
  reason: string;
}

function main(): void {
  const handle = db();

  const fixtures = handle
    .prepare(
      `SELECT request_id, text, status, source, 'non-UUID request id' AS reason
         FROM tasks WHERE NOT (${UUID})`,
    )
    .all() as unknown as Row[];

  const phantom = handle
    .prepare(
      `SELECT t.request_id, t.text, t.status, t.source,
              'COMPLETED but recorded no steps' AS reason
         FROM tasks t
         LEFT JOIN steps s ON s.request_id = t.request_id
        WHERE s.request_id IS NULL
          AND t.status = 'COMPLETED'`,
    )
    .all() as unknown as Row[];

  const orphanSteps = handle
    .prepare(`SELECT request_id, COUNT(*) AS n FROM steps WHERE NOT (${UUID}) GROUP BY request_id`)
    .all() as unknown as Array<{ request_id: string; n: number }>;

  const tasks = [...fixtures, ...phantom];

  if (tasks.length === 0 && orphanSteps.length === 0) {
    console.log('Nothing to prune — the history is clean.');
    return;
  }

  console.log(`\n${APPLY ? 'Deleting' : 'Would delete'}:\n`);
  for (const row of tasks) {
    console.log(
      `  task  ${row.request_id.slice(0, 20).padEnd(20)} ` +
        `${String(row.status).padEnd(9)} ${String(row.source).padEnd(7)} ` +
        `${String(row.text).slice(0, 34).padEnd(34)}  ${row.reason}`,
    );
  }
  for (const row of orphanSteps) {
    console.log(`  steps ${row.request_id.padEnd(20)} ${row.n} row(s)  fixture request id`);
  }

  if (!APPLY) {
    console.log('\nNothing changed. Re-run with --apply to delete.\n');
    return;
  }

  handle.exec('BEGIN');
  try {
    for (const row of tasks) {
      handle.prepare('DELETE FROM steps WHERE request_id = ?').run(row.request_id);
      handle.prepare('DELETE FROM tasks WHERE request_id = ?').run(row.request_id);
    }
    handle.prepare(`DELETE FROM steps WHERE NOT (${UUID})`).run();
    handle.exec('COMMIT');
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }

  const tasksLeft = (
    handle.prepare('SELECT COUNT(*) AS n FROM tasks').get() as unknown as { n: number }
  ).n;
  const stepsLeft = (
    handle.prepare('SELECT COUNT(*) AS n FROM steps').get() as unknown as { n: number }
  ).n;
  console.log(`\nDone. ${tasksLeft} task(s) and ${stepsLeft} step(s) remain.\n`);
}

main();
