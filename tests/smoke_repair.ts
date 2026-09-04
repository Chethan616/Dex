import './support/isolate';
/**
 * A failed step repairs the plan instead of killing the task.
 *
 *     npm run test:repair
 *
 * The Orchestrator already retried one class of failure: a step that ran but
 * did not verify, where doing it again might genuinely go differently. This is
 * the other class — a step that failed because the plan was wrong, where
 * running it again produces the identical error forever.
 *
 * The case it was built from, verbatim from the screenshots:
 *
 *     step_1  run_command   measure every DNS resolver, print the winner
 *     step_2  set_dns       primary: "{{step_1.output.best_primary}}"
 *
 * with nothing resolving the reference, so `set_dns` answered "Invalid IP:
 * {{step_1.output.best_primary}}" and the task stopped. Retrying passes the
 * same twenty-nine characters again. What was needed was to look at what step_1
 * actually returned and fix step_2 — which is what a repair is.
 *
 * The four boundaries below are the ones that keep this from being worse than
 * the failure it replaces. A repair that loops, redoes a change, or slips a
 * step past its confirmation is not a recovery.
 */
import assert from 'assert';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import {
  AgentResult,
  ConfirmationRequest,
  ExecutionPlan,
  ExecutionStep,
} from '../core/events/types';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Stands in for the daemon. Records every call, in order. */
class FakeAgent {
  name = 'FakeSystem';
  capabilities = ['can_control_os'];
  readonly calls: Array<{ action: string; params: Record<string, unknown> }> = [];

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<AgentResult> {
    this.calls.push({ action, params: JSON.parse(JSON.stringify(params)) });

    if (action === 'classify_command') {
      return { success: true, data: { band: 'green', reason: 'read' } };
    }

    // The winner, as a command that prints JSON would report it.
    if (action === 'run_command') {
      return {
        success: true,
        data: {
          exitCode: 0,
          stdout: '{"best_primary":"1.1.1.1"}',
          best_primary: '1.1.1.1',
          best_secondary: '1.0.0.1',
        },
      };
    }

    // The real daemon's check, and the real error text.
    if (action === 'set_dns') {
      const primary = String(params.primary ?? '');
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(primary)) {
        return { success: false, error: `Invalid IP: ${primary}` };
      }
      return { success: true, data: { primary, applied: true } };
    }

    return { success: true, data: { ok: true } };
  }
}

/** A planner that hands back one fixed repair, and counts how often it is asked. */
class FakeBrain {
  asked = 0;
  constructor(private steps: ExecutionStep[] | null) {}

  async repair(input: {
    outputs: ReadonlyMap<string, unknown>;
    remaining: ExecutionStep[];
  }) {
    this.asked += 1;
    // A real repair reads the evidence. Prove it is actually being given.
    const seen = input.outputs.get('step_1') as { best_primary?: string } | undefined;
    if (!seen?.best_primary) return null;
    if (!this.steps) return null;
    return { steps: this.steps, reason: 'used the winner step_1 actually found' };
  }
}

function build(brain: FakeBrain | null, fullAccess = true) {
  const agent = new FakeAgent();
  const registry = new AgentRegistry();
  registry.register(agent as never);

  const confirmations = new ConfirmationManager(5_000, 5_000);
  const cards: ConfirmationRequest[] = [];
  confirmations.registerProvider({
    name: 'test',
    present(request) {
      cards.push(request);
      setTimeout(() => {
        confirmations.respond(
          request.requestId, request.stepId, request.stepVersion, 'approved',
        );
      }, 0);
    },
    withdraw() {},
  });

  const orchestrator = new Orchestrator(
    registry,
    new ReliabilityLayer(new EvidenceStore('data/test-evidence')),
    () => fullAccess,
    confirmations,
    new CancellationRegistry(),
  );
  if (brain) orchestrator.usePlanner(brain as never);

  return { agent, orchestrator, cards };
}

/** The plan from the screenshot: measure, then switch using what was measured. */
function dnsPlan(primary: string): ExecutionPlan {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    intent: 'Test DNS servers and switch to the fastest',
    tier: 2,
    steps: [
      {
        id: 'step_1',
        capability: 'can_control_os',
        action: 'run_command',
        params: { command: ['powershell', '-Command', 'measure'] },
        confirmationTier: 4,
        dependsOn: [],
      },
      {
        id: 'step_2',
        capability: 'can_control_os',
        action: 'set_dns',
        params: { primary, secondary: '1.0.0.1' },
        confirmationTier: 4,
        dependsOn: ['step_1'],
      },
    ],
  };
}

const goodStep2: ExecutionStep = {
  id: 'step_2',
  capability: 'can_control_os',
  action: 'set_dns',
  params: { primary: '1.1.1.1', secondary: '1.0.0.1' },
  confirmationTier: 4,
  dependsOn: [],
};

async function main(): Promise<void> {
  console.log('— the reference now resolves on its own —');

  {
    // With Part A in place the placeholder is filled before dispatch and the
    // repair is never needed. This is the path a healthy task takes.
    const brain = new FakeBrain([goodStep2]);
    const { orchestrator, agent } = build(brain);
    const result = await orchestrator.execute(
      dnsPlan('{{step_1.output.best_primary}}'),
    );

    check('the task completes', result.status === 'COMPLETED', result.summary);
    const dns = agent.calls.find((c) => c.action === 'set_dns');
    check('set_dns received the measured IP, not the placeholder',
      dns?.params.primary === '1.1.1.1', String(dns?.params.primary));
    check('no repair was needed', brain.asked === 0, `asked ${brain.asked}×`);
  }

  console.log('\n— and when a step fails anyway, the plan is repaired —');

  {
    // A wrong literal that no reference resolution can save: only looking at
    // what step_1 returned fixes it.
    const brain = new FakeBrain([goodStep2]);
    const { orchestrator, agent } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));

    check('the task completes after the repair',
      result.status === 'COMPLETED', result.summary);
    check('the Brain was asked exactly once', brain.asked === 1, `${brain.asked}×`);

    const dnsCalls = agent.calls.filter((c) => c.action === 'set_dns');
    check('set_dns was retried with the real value',
      dnsCalls.length === 2 && dnsCalls[1].params.primary === '1.1.1.1',
      JSON.stringify(dnsCalls.map((c) => c.params.primary)));

    // The whole point: the repair reads the evidence rather than guessing.
    check('the measurement step was NOT run again',
      agent.calls.filter((c) => c.action === 'run_command').length === 1,
      'a completed step was repeated');
  }

  console.log('\n— the boundaries —');

  {
    // A planner that cannot fix it must not be asked forever.
    const brain = new FakeBrain(null);
    const { orchestrator } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));
    check('an unfixable failure still fails', result.status === 'FAILED', result.summary);
    check('and the Brain was asked once, not repeatedly',
      brain.asked === 1, `${brain.asked}×`);
  }

  {
    // A repair that keeps failing must stop, not loop.
    const brain = new FakeBrain([
      { ...goodStep2, id: 'step_2b', params: { primary: 'still-wrong' } },
    ]);
    const { orchestrator } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));
    check('a repair that also fails ends the task',
      result.status === 'FAILED', result.summary);
    check('capped at one repair', brain.asked === 1, `${brain.asked}×`);
  }

  {
    // A repair is not a way to make a step quieter than it was.
    const brain = new FakeBrain([
      { ...goodStep2, confirmationTier: 2 },
    ]);
    const { orchestrator, cards } = build(brain, /* fullAccess */ false);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));
    check('a repaired Tier 2 step still raises a card',
      cards.length === 1, `${cards.length} card(s)`);
    check('and the task completes once approved',
      result.status === 'COMPLETED', result.summary);
  }

  {
    // Without a planner attached, behaviour is exactly what it was before.
    const { orchestrator } = build(null);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));
    check('no planner attached: the step just fails',
      result.status === 'FAILED', result.summary);
  }

  console.log('\n— an unresolvable reference fails loudly —');

  {
    const brain = new FakeBrain(null);
    const { orchestrator, agent } = build(brain);
    const result = await orchestrator.execute(
      dnsPlan('{{step_1.output.nonexistent}}'),
    );
    check('the task fails', result.status === 'FAILED', result.summary);
    check('and set_dns was never called with a placeholder',
      !agent.calls.some(
        (c) => c.action === 'set_dns' && String(c.params.primary).includes('{{'),
      ),
      'a placeholder reached the action');
  }

  console.log('\n— a repair that is the failed step again is refused —');

  {
    // The model, handed "this step failed", answering with the same step. The
    // old behaviour ran it, failed identically, and spent a model call and the
    // owner's patience to get there.
    const same: ExecutionStep[] = [{
      id: 'step_2',
      capability: 'can_control_os',
      action: 'set_dns',
      params: { primary: 'not-an-ip', secondary: '1.0.0.1' },
      confirmationTier: 4,
      dependsOn: [],
    }];
    const brain = new FakeBrain(same);
    const { orchestrator, agent } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));

    check('the task fails rather than repeating itself', result.status === 'FAILED', result.summary);
    check('the Brain was still asked once', brain.asked === 1, String(brain.asked));
    check('and set_dns was not run a third time',
      agent.calls.filter((c) => c.action === 'set_dns').length <= 2,
      String(agent.calls.filter((c) => c.action === 'set_dns').length));
  }

  console.log('\n— a repair may not reach for a browser through the app tier —');

  {
    // The improvisation that ended the GitHub run: run_task refused, and the
    // repair answered with "open Chrome" as a window action. Two windows were
    // called "New Tab - Google Chrome", there was no name that told them
    // apart, and the task stopped on a question the owner could not answer.
    const viaWindow: ExecutionStep[] = [{
      id: 'step_2b',
      capability: 'can_control_app',
      action: 'wait_for',
      params: { window: 'Chrome' },
      confirmationTier: 4,
      dependsOn: [],
    }];
    const brain = new FakeBrain(viaWindow);
    const { orchestrator, agent } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));

    check('the task fails rather than improvising', result.status === 'FAILED', result.summary);
    check('and the window step was never run',
      !agent.calls.some((c) => c.action === 'wait_for'),
      'a browser was opened through the app tier');
  }

  console.log('\n— what did work is still reported —');

  {
    const brain = new FakeBrain(null);
    const { orchestrator } = build(brain);
    const result = await orchestrator.execute(dnsPlan('not-an-ip'));
    check('a failed task carries the facts its earlier steps found',
      Array.isArray(result.facts),
      JSON.stringify(result.facts));
  }

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  a failed step is repaired from evidence, once, and gated like any other.');
}

void main();
