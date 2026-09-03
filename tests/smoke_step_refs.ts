/**
 * Passing a value from one step to the next.
 *
 *     npm run test:step-refs
 *
 * The failure this exists for, in full: asked to test several DNS resolvers and
 * switch to the fastest, the model planned
 *
 *     step_1  run_command   measure every resolver, print the winner
 *     step_2  set_dns       primary: "{{step_1.output.best_primary}}"
 *
 * which is exactly right. Nothing resolved it, so `set_dns` was handed those
 * twenty-nine characters and answered "Invalid IP:
 * {{step_1.output.best_primary}}". A plan was a dependency graph along which
 * only control flowed, never data.
 *
 * The property that matters most here is the last group: an unresolvable
 * reference must **fail**, never pass through. Passing it through is precisely
 * how a placeholder reaches a real action, which is the bug.
 */
import assert from 'assert';
import {
  describeUnresolved,
  findRefs,
  hasStepRefs,
  renameStepRefs,
  resolveStepRefs,
} from '../core/orchestrator/step_refs';

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

const outputs = new Map<string, unknown>([
  ['step_1', {
    best_primary: '1.1.1.1',
    best_secondary: '1.0.0.1',
    latency_ms: 34,
    healthy: true,
    servers: ['1.1.1.1', '8.8.8.8'],
    adapters: { 'Wi-Fi': { source: 'static' } },
    modes: [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }],
  }],
  ['step_2', { plan: 'Balanced' }],
]);

console.log('— the reference the model actually wrote —');

check('a lone reference resolves to the real value', () => {
  const { params, unresolved } = resolveStepRefs(
    { primary: '{{step_1.output.best_primary}}', secondary: '{{step_1.output.best_secondary}}' },
    outputs,
  );
  assert.deepStrictEqual(unresolved, []);
  assert.strictEqual(params.primary, '1.1.1.1');
  assert.strictEqual(params.secondary, '1.0.0.1');
});

check('and the whole step_2 of that plan now works', () => {
  // The literal shape from the screenshot.
  const { params, unresolved } = resolveStepRefs(
    { primary: '{{step_1.output.best_primary}}', secondary: '{{step_1.output.best_secondary}}' },
    outputs,
  );
  assert.strictEqual(unresolved.length, 0, 'still unresolved');
  assert.ok(/^\d+\.\d+\.\d+\.\d+$/.test(String(params.primary)), 'not an IP');
});

console.log('\n— a lone reference keeps its type —');

check('a number stays a number', () => {
  const { params } = resolveStepRefs({ level: '{{step_1.output.latency_ms}}' }, outputs);
  assert.strictEqual(params.level, 34);
  assert.strictEqual(typeof params.level, 'number');
});

check('a boolean stays a boolean', () => {
  const { params } = resolveStepRefs({ ok: '{{step_1.output.healthy}}' }, outputs);
  assert.strictEqual(params.ok, true);
});

check('a list stays a list', () => {
  const { params } = resolveStepRefs({ servers: '{{step_1.output.servers}}' }, outputs);
  assert.deepStrictEqual(params.servers, ['1.1.1.1', '8.8.8.8']);
});

check('the whole output is reachable', () => {
  const { params } = resolveStepRefs({ all: '{{step_2.output}}' }, outputs);
  assert.deepStrictEqual(params.all, { plan: 'Balanced' });
});

console.log('\n— paths —');

check('nested, including a key with a hyphen', () => {
  const { params, unresolved } = resolveStepRefs(
    { source: '{{step_1.output.adapters.Wi-Fi.source}}' },
    outputs,
  );
  assert.deepStrictEqual(unresolved, []);
  assert.strictEqual(params.source, 'static');
});

check('array indices', () => {
  const { params } = resolveStepRefs({ w: '{{step_1.output.modes[0].width}}' }, outputs);
  assert.strictEqual(params.w, 2560);
});

check('references inside a nested structure are found', () => {
  const { params } = resolveStepRefs(
    { command: ['netsh', 'dns', '{{step_1.output.best_primary}}'], opts: { n: '{{step_1.output.latency_ms}}' } },
    outputs,
  );
  assert.deepStrictEqual(params.command, ['netsh', 'dns', '1.1.1.1']);
  assert.deepStrictEqual(params.opts, { n: 34 });
});

console.log('\n— embedded in a longer string —');

check('stringified, because a command line needs characters', () => {
  const { params } = resolveStepRefs(
    { command: 'ping {{step_1.output.best_primary}} -n 4' },
    outputs,
  );
  assert.strictEqual(params.command, 'ping 1.1.1.1 -n 4');
});

check('a non-string value embedded is JSON, not [object Object]', () => {
  const { params } = resolveStepRefs({ note: 'took {{step_1.output.latency_ms}}ms' }, outputs);
  assert.strictEqual(params.note, 'took 34ms');
});

check('two references in one string', () => {
  const { params } = resolveStepRefs(
    { text: '{{step_1.output.best_primary}} then {{step_1.output.best_secondary}}' },
    outputs,
  );
  assert.strictEqual(params.text, '1.1.1.1 then 1.0.0.1');
});

console.log('\n— an unresolvable reference fails, and never passes through —');

check('an unknown step is reported, not substituted', () => {
  const { unresolved } = resolveStepRefs({ primary: '{{step_9.output.x}}' }, outputs);
  assert.deepStrictEqual(unresolved, ['{{step_9.output.x}}']);
});

check('a missing field is reported', () => {
  const { unresolved } = resolveStepRefs({ primary: '{{step_1.output.nope}}' }, outputs);
  assert.strictEqual(unresolved.length, 1);
});

check('an out-of-range index is reported', () => {
  const { unresolved } = resolveStepRefs({ w: '{{step_1.output.modes[9].width}}' }, outputs);
  assert.strictEqual(unresolved.length, 1);
});

check('the message names the steps that did run and what they returned', () => {
  const { unresolved } = resolveStepRefs({ primary: '{{step_1.output.nope}}' }, outputs);
  const message = describeUnresolved(unresolved, outputs);
  assert.ok(message.includes('step_1.output'), message);
  assert.ok(message.includes('best_primary'), 'the available fields are not named');
});

check('with no outputs at all it says so, and points at dependsOn', () => {
  const empty = new Map<string, unknown>();
  const { unresolved } = resolveStepRefs({ primary: '{{step_1.output.x}}' }, empty);
  const message = describeUnresolved(unresolved, empty);
  assert.ok(message.includes('dependsOn'), message);
});

console.log('\n— a command that printed JSON is pointed at directly —');

// What `run_command` really returns: an envelope, with the command's own output
// parsed underneath. This is the shape the live DNS run actually produced, and
// the reason it still failed after references were implemented — the model
// pointed at `best_primary`, and the envelope has no such field.
const shellOutputs = new Map<string, unknown>([
  ['step_1', {
    command: 'powershell -Command …',
    band: 'green',
    stdout: '{"best_primary":"1.1.1.1","best_secondary":"1.0.0.1","avg_ms":34}',
    stderr: '',
    returncode: 0,
    ok: true,
    json: { best_primary: '1.1.1.1', best_secondary: '1.0.0.1', avg_ms: 34 },
  }],
]);

check('a field of the printed JSON resolves without naming `json`', () => {
  const { params, unresolved } = resolveStepRefs(
    { primary: '{{step_1.output.best_primary}}' },
    shellOutputs,
  );
  assert.deepStrictEqual(unresolved, []);
  assert.strictEqual(params.primary, '1.1.1.1');
});

check('and keeps its type there too', () => {
  const { params } = resolveStepRefs({ ms: '{{step_1.output.avg_ms}}' }, shellOutputs);
  assert.strictEqual(params.ms, 34);
});

check('naming it explicitly also works', () => {
  const { params } = resolveStepRefs(
    { primary: '{{step_1.output.json.best_primary}}' },
    shellOutputs,
  );
  assert.strictEqual(params.primary, '1.1.1.1');
});

check('the envelope wins, so a payload field cannot shadow the exit status', () => {
  const shadowed = new Map<string, unknown>([
    ['step_1', { ok: true, stdout: '', json: { ok: 'not the exit status' } }],
  ]);
  const { params } = resolveStepRefs({ ok: '{{step_1.output.ok}}' }, shadowed);
  assert.strictEqual(params.ok, true);
});

check('a field in neither place still fails', () => {
  const { unresolved } = resolveStepRefs({ x: '{{step_1.output.nope}}' }, shellOutputs);
  assert.strictEqual(unresolved.length, 1);
});

console.log('\n— ordinary values are left alone —');

check('a plain string is untouched', () => {
  const { params, unresolved } = resolveStepRefs({ name: 'Calculator' }, outputs);
  assert.strictEqual(params.name, 'Calculator');
  assert.deepStrictEqual(unresolved, []);
});

check('braces that are not a step reference survive', () => {
  // A PowerShell hashtable is full of braces and must not be touched.
  const script = '$x = @{ Name = 1 }; ${env:PATH}';
  const { params, unresolved } = resolveStepRefs({ command: script }, outputs);
  assert.strictEqual(params.command, script);
  assert.deepStrictEqual(unresolved, []);
});

check('a workflow placeholder is not a step reference', () => {
  // `{{level}}` belongs to WorkflowStore and is bound long before this runs.
  const { params, unresolved } = resolveStepRefs({ level: '{{level}}' }, outputs);
  assert.strictEqual(params.level, '{{level}}');
  assert.deepStrictEqual(unresolved, []);
});

check('hasStepRefs is honest in both directions', () => {
  assert.strictEqual(hasStepRefs({ a: '{{step_1.output.x}}' }), true);
  assert.strictEqual(hasStepRefs({ a: '{{level}}', b: 'plain' }), false);
});

check('findRefs lists them in order, for the event line', () => {
  assert.deepStrictEqual(
    findRefs({ a: '{{step_1.output.best_primary}}', b: ['{{step_2.output.plan}}'] }),
    ['{{step_1.output.best_primary}}', '{{step_2.output.plan}}'],
  );
});

check('a renamed step takes its references with it', () => {
  // Expanding a workflow renames its steps so two workflows in one plan do
  // not collide on `step_1`. The references live in params, as text, and were
  // left pointing at the old name:
  //
  //   step_2: {{step_1.output}} could not be resolved.
  //           Available: step_1_step_1.output {root, query, count, matches...}
  //
  // The value was right there, under a name nothing had told step_2 about.
  const rename = new Map([['step_1', 'step_1_step_1']]);
  const renamed = renameStepRefs(
    {
      command: ['start', '{{step_1.output}}'],
      path: '{{step_1.output.matches[0].path}}',
      nested: { deep: 'see {{step_1.output.count}} results' },
    },
    rename,
  );

  assert.deepStrictEqual(renamed.command, ['start', '{{step_1_step_1.output}}']);
  assert.strictEqual(renamed.path, '{{step_1_step_1.output.matches[0].path}}');
  assert.strictEqual(
    (renamed.nested as Record<string, unknown>).deep,
    'see {{step_1_step_1.output.count}} results',
  );
});

check('a reference to a step that was not renamed is left alone', () => {
  const renamed = renameStepRefs(
    { a: '{{step_2.output}}', b: '{{level}}', c: 'plain text' },
    new Map([['step_1', 'step_1_step_1']]),
  );
  assert.strictEqual(renamed.a, '{{step_2.output}}');
  assert.strictEqual(renamed.b, '{{level}}');
  assert.strictEqual(renamed.c, 'plain text');
});

check('renaming and resolving agree on what a reference is', () => {
  // The two halves share one regex on purpose: a second definition somewhere
  // else is how they drift apart and a rename stops covering a form that
  // resolution still accepts.
  const renamed = renameStepRefs(
    { p: '{{ step_1.output.a }}' },
    new Map([['step_1', 'step_1_step_1']]),
  );
  const { unresolved } = resolveStepRefs(
    renamed,
    new Map([['step_1_step_1', { a: 'value' }]]),
  );
  assert.deepStrictEqual(unresolved, []);
});

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASSED  a plan can pass values along its own edges.');
