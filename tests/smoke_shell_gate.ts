import './support/isolate';
/**
 * Who decides whether a shell command needs asking.
 *
 *     npm run test:shell-gate
 *
 * The planner writes a `confirmationTier` from the words of the request. The
 * daemon classifies the command itself, with the rules it will apply when it
 * runs it. Those two disagreed constantly, in both directions, and the
 * screenshots of it are the reason this file exists:
 *
 *   too high  "Create a custom power plan" is thirteen `powercfg` calls,
 *             because that is how powercfg works — one per setting. The
 *             planner marked each Tier 2. The owner answered the first card,
 *             watched eleven queue behind it, and cancelled. Eleven of the
 *             twelve then expired at exactly 120s. The task failed on the
 *             interface, not on anything it was doing.
 *
 *   too low   `powercfg /list` is a read the daemon runs silently, and it was
 *             also being planned Tier 2 — so reads raised cards too, which is
 *             how an owner learns to click Approve without reading it.
 *
 * So: the band decides, and one approval covers the rest of that plan.
 */
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

/**
 * Stands in for the daemon, banding commands the way command_policy.py does.
 *
 * Only the three cases these tests turn on — the real classifier has its own
 * suite (`npm run test:policy`) and duplicating it here would test the copy.
 */
class BandingAgent {
  name = 'FakeSystem';
  capabilities = ['can_control_os'];
  readonly ran: string[] = [];

  async execute(
    action: string,
    params: Record<string, unknown>,
  ): Promise<AgentResult> {
    const command = Array.isArray(params.command)
      ? (params.command as string[]).join(' ')
      : String(params.command ?? '');

    if (action === 'classify_command') {
      if (/\/setacvalueindex|\/setdcvalueindex|\/setactive|\/duplicatescheme/.test(command)) {
        return { success: true, data: { band: 'amber', reason: 'change a Windows power setting' } };
      }
      if (/\bdel\b|\brm\b/.test(command)) {
        return { success: true, data: { band: 'amber', reason: 'delete files' } };
      }
      return { success: true, data: { band: 'green', reason: 'run powercfg' } };
    }

    this.ran.push(command);
    return { success: true, data: { stdout: '', exitCode: 0 } };
  }
}

function shellStep(id: string, command: string[], tier: 1 | 2 | 3 | 4): ExecutionStep {
  return {
    id,
    capability: 'can_control_os',
    action: 'run_command',
    params: { command },
    confirmationTier: tier,
    dependsOn: [],
  };
}

function build() {
  const agent = new BandingAgent();
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
    () => false,
    confirmations,
    new CancellationRegistry(),
  );

  return { agent, orchestrator, cards };
}

function planOf(steps: ExecutionStep[]): ExecutionPlan {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    intent: 'shell gate test',
    tier: 2,
    steps,
  };
}

async function main(): Promise<void> {
  console.log('— the daemon decides, not the planner —');

  {
    // The planner's own screenshot: `powercfg /list` planned Tier 2.
    const { orchestrator, cards, agent } = build();
    await orchestrator.execute(planOf([
      shellStep('step_1', ['powercfg', '/list'], 2),
    ]));
    check('a GREEN read planned Tier 2 runs with no card', cards.length === 0,
      `${cards.length} card(s)`);
    check('and it actually ran', agent.ran.length === 1);
  }

  {
    // The reverse: the daemon says AMBER, the planner said silent.
    const { orchestrator, cards } = build();
    await orchestrator.execute(planOf([
      shellStep('step_1', ['powercfg', '/setactive', 'de5c0de0'], 4),
    ]));
    check('an AMBER change planned Tier 4 still asks', cards.length === 1,
      `${cards.length} card(s)`);
  }

  console.log('\n— one plan, one approval —');

  {
    // The failure in the screenshot, thirteen steps and all of it.
    const { orchestrator, cards, agent } = build();
    const steps: ExecutionStep[] = [
      shellStep('step_1', ['powercfg', '/duplicatescheme', '381b4222'], 2),
    ];
    for (let i = 2; i <= 13; i += 1) {
      steps.push({
        ...shellStep('x', ['powercfg', '/setacvalueindex', 'de5c0de0', 'SUB_PROCESSOR', 'PROCTHROTTLEMAX', String(i)], 2),
        id: `step_${i}`,
        dependsOn: ['step_1'],
      });
    }

    await orchestrator.execute(planOf(steps));

    check('thirteen power-setting steps raise ONE card, not thirteen',
      cards.length === 1, `${cards.length} card(s)`);
    check('and all thirteen still ran', agent.ran.length === 13,
      `${agent.ran.length} ran`);
  }

  {
    // The property that keeps the above from being a hole: the scope is the
    // daemon's description of the effect, so approving a power setting does
    // not approve a deletion standing next to it in the same plan.
    const { orchestrator, cards } = build();
    await orchestrator.execute(planOf([
      shellStep('step_1', ['powercfg', '/setactive', 'a'], 2),
      { ...shellStep('step_2', ['powercfg', '/setactive', 'b'], 2), dependsOn: ['step_1'] },
      { ...shellStep('step_3', ['del', 'notes.txt'], 2), dependsOn: ['step_1'] },
    ]));

    check('a different effect in the same plan asks separately',
      cards.length === 2, `${cards.length} card(s)`);
    const reasons = cards.map((c) => c.action).join(',');
    check('and both cards describe a command', reasons === 'run_command,run_command', reasons);
  }

  {
    // And it does not leak into the next task.
    const { orchestrator, cards } = build();
    const one = planOf([shellStep('step_1', ['powercfg', '/setactive', 'a'], 2)]);
    const two = planOf([shellStep('step_1', ['powercfg', '/setactive', 'b'], 2)]);
    await orchestrator.execute(one);
    await orchestrator.execute(two);
    check('the next task asks again', cards.length === 2, `${cards.length} card(s)`);
  }

  console.log();
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('PASSED  the band decides, and one plan costs one approval.');
}

void main();
