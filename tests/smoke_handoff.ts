/**
 * A browser step handing its work to a file step.
 *
 * The task that prompted this: "find aadhar.pdf, compress it on a website, save
 * the result to D:, open it in Acrobat." Four tiers, one plan, and it could not
 * be written — `run_task` returned `{ result, url, steps, verification }` and no
 * file path, so there was nothing for `move_file` to point at. The browser could
 * do the work and Dex could not pick it up.
 *
 * What this fixes is small and specific: `downloads[]` on the way out, and a
 * reference resolving into the next step. The chaining machinery itself is
 * older than this file — see smoke_step_refs.ts — so what is checked here is
 * that a browser result is the right *shape* to be chained, and that a step
 * which only succeeded on its second attempt is chainable too, which it was not.
 */
import { findRefs, resolveStepRefs } from '../core/orchestrator/step_refs';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

console.log('\nwhat a browser run returns');

// The shape browser_agent.ts builds from a bridge_agent result.
const browserOutput = {
  result: 'Compressed the PDF and downloaded it.',
  url: 'https://www.ilovepdf.com/download/xyz',
  downloads: [
    { path: 'C:\\Users\\me\\Downloads\\dex\\aadhar-compressed.pdf', name: 'aadhar_compressed.pdf', bytes: 184320 },
  ],
  steps: [{ step: 1, tool: 'page_navigate', action: 'page_navigate', url: 'https://www.ilovepdf.com/compress_pdf' }],
  verification: null,
};

check(
  'downloads is always an array, so the reference shape does not change',
  Array.isArray(browserOutput.downloads),
);

const outputs = new Map<string, unknown>([['step_3', browserOutput]]);

console.log('\nchaining it into a file step');

const moveParams = {
  from: '{{step_3.output.downloads[0].path}}',
  to: 'D:\\Documents\\aadhar-compressed.pdf',
};

check('the reference is found', findRefs(moveParams).length === 1, JSON.stringify(findRefs(moveParams)));

const moved = resolveStepRefs(moveParams, outputs);
check('it resolves', moved.unresolved.length === 0, moved.unresolved.join(', '));
check(
  'and it resolves to the real path, not a stringified object',
  moved.params.from === 'C:\\Users\\me\\Downloads\\dex\\aadhar-compressed.pdf',
  String(moved.params.from),
);

// The last leg: open it in an app. `to` came from the file step, not the
// browser one, which is the point — the value walks the whole plan.
const openParams = { path: 'C:\\Acrobat.exe', args: ['{{step_4.output.to}}'] };
const withMove = new Map<string, unknown>([
  ...outputs,
  ['step_4', { from: moved.params.from, to: moveParams.to }],
]);
const opened = resolveStepRefs(openParams, withMove);
check(
  'a reference inside an array resolves too',
  opened.unresolved.length === 0 && (opened.params.args as string[])[0] === 'D:\\Documents\\aadhar-compressed.pdf',
  JSON.stringify(opened.params.args),
);

console.log('\nwhen nothing downloaded');

const nothing = new Map<string, unknown>([['step_3', { ...browserOutput, downloads: [] }]]);
const missed = resolveStepRefs(moveParams, nothing);
check(
  'the reference fails rather than passing a placeholder through',
  missed.unresolved.length === 1,
  JSON.stringify(missed.params),
);
check(
  'and the failure names what was actually there',
  missed.unresolved[0].includes('downloads[0].path'),
  missed.unresolved[0],
);

console.log('\na run that failed after downloading');

// A browser task can fail on its last step having already produced the file.
// Reporting it anyway is how the owner keeps what did work.
const failedRun = { url: browserOutput.url, steps: browserOutput.steps, downloads: browserOutput.downloads };
check(
  'a failed run still carries the file it produced',
  Array.isArray(failedRun.downloads) && failedRun.downloads.length === 1,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('PASSED  a browser step can hand a file to a file step.');
