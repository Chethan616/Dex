import './support/isolate';
/**
 * Every task that works is remembered as a script with parameters.
 *
 *     npm run test:autosave
 *
 * Saving used to be reachable only from the CLI, and only after the identical
 * request had succeeded three times (`Telemetry.SUGGEST_AFTER`). The app never
 * sent `save_workflow` at all. So in practice nothing was ever saved — one
 * workflow existed on the owner's machine after weeks of use — and every
 * request paid for a planning call however many times it had been asked.
 *
 * The templating underneath was already right and had nothing feeding it: given
 * "set the volume to 35 percent" and a plan containing `{ level: 35 }`, it works
 * out that 35 is a value the owner chose and turns it into `{{level}}`.
 *
 * What this file pins is the saving, and the two things that keep automatic
 * saving from being worse than none:
 *
 *   - a replay is not new knowledge, so it does not re-save;
 *   - a saved plan that stops working is **forgotten**, because a saved plan
 *     skips the Brain entirely and nothing gets a second look at it.
 */
import assert from 'assert';
import { WorkflowStore } from '../core/workflows/store';
import { ExecutionPlan } from '../core/events/types';

let failures = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${err instanceof Error ? err.message : err}`);
  }
}

function volumePlan(level: number): ExecutionPlan {
  return {
    requestId: 'r1',
    intent: 'Set the system volume',
    tier: 1,
    steps: [{
      id: 'step_1',
      capability: 'can_control_os',
      action: 'set_volume',
      params: { level },
      confirmationTier: 4,
      dependsOn: [],
    }],
  };
}

const store = new WorkflowStore();

console.log('— a task that worked is remembered —');

check('autoSave stores it without being asked for a name', () => {
  const saved = store.autoSave({
    plan: volumePlan(35),
    requestText: 'set the volume to 35 percent',
  });
  assert.ok(saved, 'nothing was saved');
  assert.strictEqual(saved.origin, 'learned');
});

check('the name reads like the task, not like a hash', () => {
  const saved = store.list().find((w) => w.origin === 'learned');
  assert.ok(saved, 'no learned workflow');
  assert.ok(/^[a-z0-9][a-z0-9_-]*$/.test(saved.name), saved.name);
  assert.ok(saved.name.includes('volume'), `unhelpful name: ${saved.name}`);
});

check('the value the owner chose became a parameter', () => {
  const saved = store.list().find((w) => w.origin === 'learned')!;
  assert.deepStrictEqual(saved.params, ['level']);
  assert.strictEqual(saved.template[0].params.level, '{{level}}');
});

console.log('\n— and replayed with different values, for no model call —');

check('the same request in different words re-binds the parameter', () => {
  const matched = store.matchRequest('set the volume to 70 percent');
  assert.ok(matched, 'the saved workflow did not match');
  assert.strictEqual(matched.args.level, '70');

  const plan = store.bind(matched.workflow, matched.args, 'r2');
  assert.strictEqual(plan.steps[0].params.level, 70,
    'bound as a string rather than the number the action needs');
});

check('a different value again, same script', () => {
  const matched = store.matchRequest('set the volume to 20 percent')!;
  const plan = store.bind(matched.workflow, matched.args, 'r3');
  assert.strictEqual(plan.steps[0].params.level, 20);
});

console.log('\n— saving twice does not grow a twin —');

check('the same shape updates in place', () => {
  const countBefore = store.list().length;
  store.autoSave({
    plan: volumePlan(80),
    requestText: 'set the volume to 80 percent',
  });
  assert.strictEqual(store.list().length, countBefore,
    'a second run of the same shape created a second workflow');
});

check('a genuinely different task is saved separately', () => {
  const countBefore = store.list().length;
  store.autoSave({
    plan: {
      requestId: 'r4',
      intent: 'Set the screen brightness',
      tier: 1,
      steps: [{
        id: 'step_1',
        capability: 'can_control_os',
        action: 'set_brightness',
        params: { level: 40 },
        confirmationTier: 4,
        dependsOn: [],
      }],
    },
    requestText: 'set the brightness to 40 percent',
  });
  assert.strictEqual(store.list().length, countBefore + 1);
});

console.log('\n— a workflow the owner named is theirs —');

check('naming one claims it', () => {
  const learned = store.list().find((w) => w.origin === 'learned' && w.name.includes('volume'))!;
  const renamed = store.rename(learned.name, 'vol');
  assert.strictEqual(renamed.name, 'vol');
  assert.strictEqual(renamed.origin, 'named');
  assert.strictEqual(store.get('vol')?.origin, 'named');
});

check('and auto-save will not quietly rewrite it', () => {
  const before = store.get('vol')!;
  const result = store.autoSave({
    plan: volumePlan(5),
    requestText: 'set the volume to 5 percent',
  });
  assert.strictEqual(result, undefined, 'a named workflow was overwritten');
  assert.strictEqual(store.get('vol')!.createdAt, before.createdAt);
});

console.log('\n— a saved plan that stops working is forgotten —');

check('one failure is not enough — a bad night is not a bad plan', () => {
  const learned = store.list().find((w) => w.origin === 'learned')!;
  store.markFailed(learned.name);
  assert.ok(store.get(learned.name), 'forgotten after a single failure');
  assert.strictEqual(store.get(learned.name)!.failCount, 1);
});

check('two in a row and it is gone', () => {
  const learned = store.list().find((w) => w.origin === 'learned' && w.failCount === 1)!;
  store.markFailed(learned.name);
  assert.strictEqual(store.get(learned.name), undefined, 'still remembered after two failures');
});

check('a success in between resets the count', () => {
  const trigger = 'dim the keyboard light to 11';
  store.autoSave({ plan: volumePlan(11), requestText: trigger });
  const w = store.list().find((x) => x.triggerText === trigger);
  assert.ok(w, 'the new task was not saved');

  store.markFailed(w.name);
  store.markRun(w.name);            // it worked again
  store.markFailed(w.name);
  assert.ok(store.get(w.name), 'forgotten despite a success between the failures');
  assert.strictEqual(store.get(w.name)!.failCount, 1, 'the count did not reset');
});

check('a named workflow is never deleted out from under the owner', () => {
  store.markFailed('vol');
  store.markFailed('vol');
  store.markFailed('vol');
  const kept = store.get('vol');
  assert.ok(kept, 'a named workflow was deleted');
  assert.ok(kept.failCount >= 3, 'the failures were not recorded');
});

console.log('\n— nothing worth saving is not saved —');

check('an empty plan is skipped', () => {
  const result = store.autoSave({
    plan: { requestId: 'r9', intent: 'nothing', tier: 1, steps: [] },
    requestText: 'who are you',
  });
  assert.strictEqual(result, undefined);
});

check('an empty request is skipped', () => {
  assert.strictEqual(
    store.autoSave({ plan: volumePlan(1), requestText: '   ' }),
    undefined,
  );
});

console.log('\n— named workflows outrank learned ones —');

check('list puts named first', () => {
  const list = store.list();
  const firstLearned = list.findIndex((w) => w.origin === 'learned');
  const lastNamed = list.map((w) => w.origin).lastIndexOf('named');
  assert.ok(firstLearned === -1 || lastNamed < firstLearned,
    'a learned workflow sorted above a named one');
});

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASSED  a task that works is remembered, re-parameterised, and dropped when it stops working.');
