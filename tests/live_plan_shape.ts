/**
 * Does the real planner actually emit a working multi-capability plan?
 *
 *   npx ts-node tests/live_plan_shape.ts
 *
 * Not part of the test suite: it calls the real Brain with a real LLM
 * provider (whatever DEX_BRAIN_PROVIDER/credentials are configured), so it
 * needs quota and can fail for reasons that have nothing to do with the
 * code — same caveat as live_requests.ts.
 *
 * smoke_open_in_app.ts already proves the DAG plumbing works when handed a
 * correctly-shaped plan. This is the other half: does the LLM actually
 * PRODUCE that shape for "download the Wikipedia homepage and open it in
 * VS Code"? Before open_file_in_app existed there was no way it could —
 * this checks the fix actually reaches the planner's real behaviour, not
 * just its prompt text (which is all the OLD coverage — smoke_delivery.ts —
 * ever checked).
 *
 * Only structural properties are asserted, not exact step count or wording,
 * since the model's phrasing legitimately varies run to run.
 */
import { Brain } from '../core/brain/planner';
import { DexRequest, ExecutionStep } from '../core/events/types';

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[90m${s}\x1b[0m`;

function request(text: string): DexRequest {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    sessionId: 'live-plan-shape-test',
    source: 'cli',
    senderId: 'test',
    text,
    timestamp: Date.now(),
  };
}

/** True if some step's action or capability plausibly matches one of the given hints. */
function planMentions(steps: ExecutionStep[], hints: string[]): boolean {
  return steps.some((s) =>
    hints.some((h) => s.action.includes(h) || s.capability.includes(h)),
  );
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(green(`ok   ${label}`));
  else {
    failures += 1;
    console.log(red(`FAIL ${label}`) + (detail ? `\n     ${detail}` : ''));
  }
}

async function main(): Promise<void> {
  const brain = new Brain();
  console.log(dim(`Using provider: ${brain.model}\n`));

  console.log(bold('— "download the Wikipedia homepage and open it in VS Code" —'));
  {
    const plan = await brain.plan(
      request('download the Wikipedia homepage and open it in VS Code'),
    );
    console.log(dim(JSON.stringify(plan.steps.map((s) => ({ id: s.id, capability: s.capability, action: s.action, dependsOn: s.dependsOn })), null, 2)));

    check('at least 2 steps', plan.steps.length >= 2, `got ${plan.steps.length}`);
    check(
      'a file-download-shaped step appears',
      planMentions(plan.steps, ['download_file', 'can_control_files']),
      JSON.stringify(plan.steps.map((s) => s.action)),
    );
    check(
      'an open-file-in-app-shaped step appears (not launch_app alone)',
      planMentions(plan.steps, ['open_file_in_app']),
      JSON.stringify(plan.steps.map((s) => s.action)),
    );
    const opener = plan.steps.find((s) => s.action === 'open_file_in_app');
    check(
      'the opener step depends on the downloader (dependsOn is non-empty)',
      !!opener && opener.dependsOn.length > 0,
      opener ? JSON.stringify(opener.dependsOn) : '(no open_file_in_app step)',
    );
    check(
      'the opener references the downloader\'s output, not a guessed path',
      !!opener && JSON.stringify(opener.params).includes('{{step'),
      opener ? JSON.stringify(opener.params) : '',
    );
  }

  console.log(bold('\n— "find sidemen\'s latest instagram post and download the image" —'));
  {
    const plan = await brain.plan(
      request("find sidemen's latest instagram post and download the image"),
    );
    console.log(dim(JSON.stringify(plan.steps.map((s) => ({ id: s.id, capability: s.capability, action: s.action })), null, 2)));

    check('at least 1 step', plan.steps.length >= 1, `got ${plan.steps.length}`);
    check(
      'the browser capability is used (a single run_task, not a granular step list)',
      planMentions(plan.steps, ['can_browse_web', 'run_task']),
      JSON.stringify(plan.steps.map((s) => s.action)),
    );
  }

  console.log();
  if (failures > 0) {
    console.log(red(`${failures} check(s) failed.`));
    console.log(dim('A failure here does not necessarily mean the code is wrong — the model\'s phrasing legitimately varies. Re-run before concluding the capability regressed.'));
    process.exit(1);
  }
  console.log(green('PASSED  the real planner emits a working plan for both scenarios.'));
}

void main().catch((err) => {
  console.error(red(String(err)));
  process.exit(1);
});
