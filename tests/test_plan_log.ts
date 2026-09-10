/**
 * logApprovedPlan — a durable, greppable record of every plan the
 * Orchestrator actually starts running, kept specifically so a pattern
 * across many tasks (a redundant step the Brain keeps re-deriving, an
 * adapter's extraction that keeps missing one phrasing) survives past the
 * live session that produced it, for improving the agents themselves
 * rather than just swapping which model answers.
 *
 *     npx ts-node tests/test_plan_log.ts
 */
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-plan-log-'));

import { logApprovedPlan } from '../core/logging/plan_log';
import { ExecutionPlan } from '../core/events/types';

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const plansFile = path.join(process.env.LOCALAPPDATA, 'DEX', 'plans.log');

const plan: ExecutionPlan = {
  requestId: 'req_1',
  sessionId: 'sess_1',
  intent: 'show virat kohli latest instagram post',
  unattended: false,
  tier: 2,
  steps: [
    {
      id: 'step_1',
      capability: 'can_browse_web',
      action: 'run_task',
      params: { task: 'show virat kohli latest instagram post' },
      dependsOn: [],
      confirmationTier: 2,
    },
  ],
};

console.log('— logging one approved plan —');

logApprovedPlan(plan);

check('plans.log was created', fs.existsSync(plansFile));

const lines = fs.readFileSync(plansFile, 'utf8').trim().split('\n');
check('exactly one line written', lines.length === 1, `${lines.length} lines`);

const record = JSON.parse(lines[0]);
check('requestId recorded', record.requestId === 'req_1');
check('sessionId recorded', record.sessionId === 'sess_1');
check('intent recorded', record.intent === 'show virat kohli latest instagram post');
check('unattended recorded', record.unattended === false);
check('has an ISO timestamp', typeof record.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp)));
check('one step recorded', Array.isArray(record.steps) && record.steps.length === 1);
check('step capability recorded', record.steps[0].capability === 'can_browse_web');
check('step action recorded', record.steps[0].action === 'run_task');
check('step params recorded', record.steps[0].params.task === plan.steps[0].params.task);
check('step confirmationTier recorded', record.steps[0].confirmationTier === 2);

console.log('\n— a second plan appends, does not overwrite —');

const plan2: ExecutionPlan = { ...plan, requestId: 'req_2', intent: 'second task' };
logApprovedPlan(plan2);
const lines2 = fs.readFileSync(plansFile, 'utf8').trim().split('\n');
check('now two lines', lines2.length === 2, `${lines2.length} lines`);
check('first line unchanged', JSON.parse(lines2[0]).requestId === 'req_1');
check('second line is the new plan', JSON.parse(lines2[1]).requestId === 'req_2');

console.log('\n— a plan with an unwritable directory does not throw —');

const badLocalAppData = path.join(os.tmpdir(), 'dex-plan-log-does-not-exist', 'nested', 'deep');
const realLocalAppData = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = path.join('Z:', 'this-drive-should-not-exist-12345');
try {
  logApprovedPlan(plan);
  check('did not throw even if the directory cannot be created', true);
} catch (err) {
  check('did not throw even if the directory cannot be created', false, String(err));
} finally {
  process.env.LOCALAPPDATA = realLocalAppData;
}
void badLocalAppData;

fs.rmSync(path.dirname(plansFile), { recursive: true, force: true });

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASSED  every approved plan is durably logged for later agent improvement.');
