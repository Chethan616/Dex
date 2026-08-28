import './support/isolate';
/**
 * Full Access semantics — the properties that make it safe to leave on.
 *
 *   npm run test:full-access
 *
 * 1. It is only on when it is real. Configured-but-not-elevated used to be the
 *    worst state available: confirmations skipped for privileged actions that
 *    then failed at the daemon anyway. It now downgrades to cards.
 *
 * 2. A RED registry path always asks, whatever tier the planner assigned and
 *    whatever Full Access says. Untrusted content reaches the planner, and
 *    these are the keys it would aim for.
 *
 * 3. A Tier 1 hand-off still reaches the owner. Full Access says "you may act
 *    without asking"; it cannot give Dex eyes that read a CAPTCHA or a password
 *    only the owner knows. That is true by construction — hand-offs go through
 *    `contextFor`, not the confirmation gate — which is exactly the sort of
 *    thing a refactor breaks silently, so it is pinned here.
 */
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { AgentRegistry } from '../core/orchestrator/registry';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import {
  AgentContext,
  AgentResult,
  ConfirmationRequest,
  ExecutionPlan,
} from '../core/events/types';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** A stand-in daemon: records what it was asked, answers plausibly. */
class FakeSystemAgent {
  name = 'FakeSystem';
  capabilities = ['can_control_os'];
  readonly calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  handoffAsked = false;

  constructor(private redPrefixes: string[] = []) {}

  async execute(
    action: string,
    params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    this.calls.push({ action, params });

    if (action === 'registry_classify') {
      const path = String(params.path ?? '').toLowerCase();
      const red = this.redPrefixes.some((p) => path.startsWith(p.toLowerCase()));
      return {
        success: true,
        data: red
          ? { band: 'red', reason: 'autostart programs' }
          : { band: 'green', reason: 'Dex-owned key' },
      };
    }

    // Stands in for a password field or a CAPTCHA: work the agent physically
    // cannot do, however much privilege it has.
    if (action === 'needs_owner' && ctx?.handoff) {
      this.handoffAsked = true;
      await ctx.handoff({
        reason: 'password field',
        instruction: 'type your password, then continue',
      });
      return { success: true, data: {} };
    }

    return { success: true, data: { ok: true } };
  }
}

function plan(
  action: string,
  params: Record<string, unknown>,
  tier: 1 | 2 | 3 | 4,
): ExecutionPlan {
  return {
    requestId: `req_${action}_${tier}_${Math.random().toString(36).slice(2, 8)}`,
    intent: `test ${action}`,
    tier: 2,
    steps: [
      { id: 'step_1', capability: 'can_control_os', action, params, confirmationTier: tier, dependsOn: [] },
    ],
  };
}

/**
 * Wire an Orchestrator to a provider that records every card and answers it.
 *
 * What was *asked* is the assertion here — these tests are about whether the
 * owner gets consulted, not about what they say.
 */
function build(fullAccess: () => boolean, agent: FakeSystemAgent) {
  const registry = new AgentRegistry();
  registry.register(agent as never);

  const confirmations = new ConfirmationManager(5_000, 5_000);
  const seen: ConfirmationRequest[] = [];

  confirmations.registerProvider({
    name: 'test',
    present(request) {
      seen.push(request);
      // Answer on the next tick, the way a person or the UI would.
      setTimeout(() => {
        confirmations.respond(
          request.requestId,
          request.stepId,
          request.stepVersion,
          request.tier === 1 ? 'handed_off' : 'approved',
        );
      }, 0);
    },
    withdraw() {},
  });

  const orchestrator = new Orchestrator(
    registry,
    new ReliabilityLayer(new EvidenceStore('data/evidence')),
    fullAccess,
    confirmations,
    new CancellationRegistry(),
  );

  return { orchestrator, seen };
}

async function main(): Promise<void> {
  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

  // 1. Full Access bypasses ordinary confirmations.
  {
    const { orchestrator, seen } = build(() => true, new FakeSystemAgent());
    const result = await orchestrator.execute(plan('set_dns', { primary: '1.1.1.1' }, 2));
    check(
      'Full Access on: a Tier 2 step runs with no card',
      seen.length === 0 && result.status === 'COMPLETED',
      `cards=${seen.length} status=${result.status}`,
    );
  }

  // 2. Downgraded, the same step asks. This is the state a removed scheduled
  //    task or a committed FULL_ACCESS=true leaves behind.
  {
    const { orchestrator, seen } = build(() => false, new FakeSystemAgent());
    const result = await orchestrator.execute(plan('set_dns', { primary: '1.1.1.1' }, 2));
    check(
      'Full Access downgraded: the same step now asks',
      seen.length === 1 && result.status === 'COMPLETED',
      `cards=${seen.length} status=${result.status}`,
    );
  }

  // 3. RED overrides both the planner's tier and Full Access.
  {
    const agent = new FakeSystemAgent([RUN_KEY]);
    const { orchestrator, seen } = build(() => true, agent);
    await orchestrator.execute(
      plan('registry_write', { path: RUN_KEY, name: 'x', value: 'y' }, 4),
    );

    check('RED asks despite Tier 4 and Full Access', seen.length === 1, `cards=${seen.length}`);
    check(
      'and the card is Tier 2, whatever the planner said',
      seen[0]?.tier === 2,
      `tier=${seen[0]?.tier}`,
    );
    check(
      'RED was classified by the daemon, not guessed in the core',
      agent.calls.some((c) => c.action === 'registry_classify'),
    );
  }

  // 4. The override is narrow — a non-RED write is still silent.
  {
    const agent = new FakeSystemAgent([RUN_KEY]);
    const { orchestrator, seen } = build(() => true, agent);
    await orchestrator.execute(
      plan('registry_write', { path: 'HKCU\\Software\\DEX', name: 'x', value: 'y' }, 4),
    );
    check('a GREEN write stays silent', seen.length === 0, `cards=${seen.length}`);
  }

  // 5. Hand-offs are not confirmations, and are never bypassed.
  {
    const agent = new FakeSystemAgent();
    const { orchestrator, seen } = build(() => true, agent);
    await orchestrator.execute(plan('needs_owner', {}, 4));
    check(
      'a Tier 1 hand-off still reaches the owner with Full Access on',
      seen.length === 1 && agent.handoffAsked,
      `cards=${seen.length} asked=${agent.handoffAsked}`,
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
