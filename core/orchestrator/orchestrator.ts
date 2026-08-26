import { AgentContext, AgentResult, ExecutionPlan, ExecutionStep, TaskStatus } from '../events/types';
import { AgentRegistry } from './registry';
import { CancellationRegistry } from './cancellation';
import { ReliabilityLayer } from '../reliability/observation_engine';
import { Telemetry } from '../memory/telemetry';
import { ConfirmationManager } from '../confirmation/confirmation_manager';
import { emit } from '../events/bus';

type StepOutcome = 'ok' | 'failed' | 'cancelled';

export class Orchestrator {
  constructor(
    private registry: AgentRegistry,
    private reliability: ReliabilityLayer,
    private fullAccess: boolean = false,
    private confirmations: ConfirmationManager = new ConfirmationManager(),
    private cancellation: CancellationRegistry = new CancellationRegistry(),
    /** Records what each step actually did, for the usage history. */
    private telemetry: Telemetry = new Telemetry(),
  ) {}

  async execute(plan: ExecutionPlan): Promise<{ status: TaskStatus; summary: string }> {
    const { requestId, steps, intent } = plan;

    emit('planning', `Plan: "${intent}" — ${steps.length} step(s)`, requestId, undefined, plan);

    const completed = new Set<string>();
    const remaining = [...steps];

    try {
      while (remaining.length > 0) {
        if (this.cancellation.isCancelled(requestId)) {
          return this.cancelledResult(requestId, intent);
        }

        const ready = remaining.filter((s) => s.dependsOn.every((dep) => completed.has(dep)));

        if (ready.length === 0) {
          emit('failed', 'No steps are ready — possible circular dependency', requestId);
          return { status: 'FAILED', summary: 'Circular dependency in plan' };
        }

        const results = await Promise.allSettled(
          ready.map((step) => this.executeStep(step, requestId, completed)),
        );

        let sawCancel = false;
        for (const result of results) {
          if (result.status === 'rejected') {
            emit('failed', `Step threw unexpectedly: ${result.reason}`, requestId);
          } else if (result.value === 'cancelled') {
            sawCancel = true;
          }
        }

        for (const step of ready) {
          remaining.splice(remaining.indexOf(step), 1);
        }

        if (sawCancel || this.cancellation.isCancelled(requestId)) {
          return this.cancelledResult(requestId, intent);
        }
      }

      const failed = steps.filter((s) => !completed.has(s.id));
      if (failed.length > 0) {
        return {
          status: 'FAILED',
          summary: `Failed steps: ${failed.map((s) => s.id).join(', ')}`,
        };
      }

      emit('done', `Done: ${intent}`, requestId);
      return { status: 'COMPLETED', summary: intent };
    } finally {
      this.cancellation.clear(requestId);
      this.confirmations.cancelAll(requestId);
    }
  }

  private cancelledResult(requestId: string, intent: string): { status: TaskStatus; summary: string } {
    emit('cancelled', `Cancelled: ${intent}`, requestId);
    return { status: 'CANCELLED', summary: `Cancelled by owner: ${intent}` };
  }

  private async executeStep(
    step: ExecutionStep,
    requestId: string,
    completed: Set<string>,
    escalated = false,
  ): Promise<StepOutcome> {
    emit('selecting', `${step.id} → ${step.capability}:${step.action}`, requestId, step.id);

    const agent = this.registry.resolve(step.capability);
    if (!agent) {
      emit(
        'failed',
        `No agent for capability "${step.capability}" — is it registered?`,
        requestId,
        step.id,
      );
      return 'failed';
    }

    const gate = await this.gateStep(step, requestId);
    if (gate !== 'ok') return gate;

    const beforeState = await this.reliability.observe(step, requestId);

    emit('executing', `${step.action}(${JSON.stringify(step.params)})`, requestId, step.id);

    const ctx = this.contextFor(step, requestId);
    let result = await agent.execute(step.action, step.params, requestId, step.id, ctx);

    // The agent hit the edge of its mechanism rather than failing. Hand the
    // same step to the tier that can actually do it. Once only — see `escalate`
    // in AgentResult for why this must not chain.
    if (!result.success && result.escalate && !escalated) {
      const escalation = await this.escalate(step, result.escalate, requestId, ctx);
      if (escalation) result = escalation;
    }

    if (!result.success) {
      // A step the owner declined mid-flight is a decision, not a failure to
      // report as one — the cancel path already told them what happened.
      if (this.cancellation.isCancelled(requestId)) return 'cancelled';
      emit('failed', `${step.id} failed: ${result.error ?? 'unknown error'}`, requestId, step.id);
      return 'failed';
    }

    const verification = await this.reliability.verify(step, beforeState, requestId, result);

    this.telemetry.step({
      requestId,
      stepId: step.id,
      capability: step.capability,
      action: step.action,
      tier: step.confirmationTier,
      status: verification.status === 'FAILED' ? 'failed' : 'ok',
      verification: verification.status,
      escalatedTo: result.escalate,
    });

    if (verification.status === 'VERIFIED') {
      emit('done', `${step.id} verified ✓ — ${verification.reason}`, requestId, step.id);
      completed.add(step.id);
      return 'ok';
    }

    if (verification.status === 'UNVERIFIABLE') {
      emit(
        'done',
        `${step.id} completed (unverifiable — ${verification.reason})`,
        requestId,
        step.id,
      );
      completed.add(step.id);
      return 'ok';
    }

    // FAILED verification. One retry — but only if running it again could
    // plausibly go differently. A CAPTCHA the owner already declined, or a tool
    // the server does not have, will fail identically and cost the owner
    // another wait for the privilege.
    if (result.retryable === false) {
      emit(
        'failed',
        `${step.id} failed and cannot be retried — ${verification.reason}`,
        requestId,
        step.id,
      );
      return 'failed';
    }

    emit(
      'retrying',
      `${step.id} verification failed (${verification.reason}) — retrying`,
      requestId,
      step.id,
    );

    const retry = await agent.execute(step.action, step.params, requestId, step.id, ctx);
    const retryVerification = await this.reliability.verify(step, beforeState, requestId, retry);

    if (retry.success && retryVerification.status !== 'FAILED') {
      emit('done', `${step.id} verified on retry ✓`, requestId, step.id);
      completed.add(step.id);
      return 'ok';
    }

    emit('failed', `${step.id} failed after retry`, requestId, step.id);
    return 'failed';
  }

  /**
   * Re-dispatch a step to a more capable tier.
   *
   * The Brain plans against what it can know at planning time; it cannot know
   * whether a particular application exposes an accessibility tree. So the
   * cheap deterministic tier tries first, and when it reports that the target
   * is genuinely unreachable by its mechanism, execution moves outward here.
   *
   * The step keeps its confirmation tier and its id — this is the same step
   * being done a different way, not a new one, so nothing gets re-approved and
   * the evidence trail stays continuous.
   */
  private async escalate(
    step: ExecutionStep,
    capability: string,
    requestId: string,
    ctx: AgentContext,
  ): Promise<AgentResult | undefined> {
    if (capability === step.capability) return undefined;

    const agent = this.registry.resolve(capability);
    if (!agent) {
      emit(
        'failed',
        `${step.id} wanted to escalate to "${capability}" but no agent provides it`,
        requestId,
        step.id,
      );
      return undefined;
    }

    if (this.cancellation.isCancelled(requestId)) return undefined;

    emit(
      'selecting',
      `${step.id} → escalating ${step.capability} → ${capability}`,
      requestId,
      step.id,
    );

    return agent.execute(step.action, step.params, requestId, step.id, ctx);
  }

  /**
   * What an agent can reach back for while a step is in flight.
   *
   * `handoff` is not gated on Full Access, and that is the whole point of
   * keeping it separate from the confirmation gate below. Full Access says the
   * owner already trusts DEX to act without asking. It does not, and cannot,
   * give DEX eyes that can read a CAPTCHA or a password only the owner knows.
   */
  private contextFor(step: ExecutionStep, requestId: string): AgentContext {
    return {
      handoff: (handoff) =>
        this.confirmations.requestHandoff(
          requestId,
          step.id,
          step.capability,
          step.action,
          handoff,
        ),
      isCancelled: () => this.cancellation.isCancelled(requestId),
    };
  }

  /**
   * Tier 4 runs silently. Tier 1–3 need the owner unless Full Access is on, in
   * which case the daemon already runs as LocalSystem and no prompt is possible.
   */
  private async gateStep(step: ExecutionStep, requestId: string): Promise<StepOutcome> {
    if (step.confirmationTier >= 4) return 'ok';

    if (this.fullAccess) {
      emit(
        'executing',
        `[Full Access] Bypassing Tier ${step.confirmationTier} confirmation`,
        requestId,
        step.id,
      );
      return 'ok';
    }

    const verdict = await this.confirmations.request(step, requestId);

    if (verdict === 'approved') return 'ok';

    if (verdict === 'rejected') {
      emit('cancelled', `${step.id} rejected by owner`, requestId, step.id);
      return 'cancelled';
    }
    if (verdict === 'expired') {
      emit('failed', `${step.id} approval timed out — no answer from owner`, requestId, step.id);
      return 'cancelled';
    }
    return 'cancelled';
  }
}
