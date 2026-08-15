import { ExecutionPlan, ExecutionStep, TaskStatus } from '../events/types';
import { AgentRegistry } from './registry';
import { ReliabilityLayer } from '../reliability/observation_engine';
import { emit } from '../events/bus';

export class Orchestrator {
  constructor(
    private registry: AgentRegistry,
    private reliability: ReliabilityLayer,
    private fullAccess: boolean = false,
  ) {}

  async execute(plan: ExecutionPlan): Promise<{ status: TaskStatus; summary: string }> {
    const { requestId, steps, intent } = plan;

    emit('planning', `Plan: "${intent}" — ${steps.length} step(s)`, requestId);

    const completed = new Set<string>();
    const remaining = [...steps];

    while (remaining.length > 0) {
      const ready = remaining.filter((s) => s.dependsOn.every((dep) => completed.has(dep)));

      if (ready.length === 0) {
        emit('failed', 'No steps are ready — possible circular dependency', requestId);
        return { status: 'FAILED', summary: 'Circular dependency in plan' };
      }

      const results = await Promise.allSettled(
        ready.map((step) => this.executeStep(step, requestId, completed)),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          emit('failed', `Step threw unexpectedly: ${result.reason}`, requestId);
        }
      }

      for (const step of ready) {
        remaining.splice(remaining.indexOf(step), 1);
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
  }

  private async executeStep(
    step: ExecutionStep,
    requestId: string,
    completed: Set<string>,
  ): Promise<void> {
    emit('selecting', `${step.id} → ${step.capability}:${step.action}`, requestId, step.id);

    const agent = this.registry.resolve(step.capability);
    if (!agent) {
      emit(
        'failed',
        `No agent for capability "${step.capability}" — is it registered?`,
        requestId,
        step.id,
      );
      return;
    }

    if (step.confirmationTier <= 2) {
      if (this.fullAccess) {
        // Full Access mode: daemon runs as LocalSystem — no prompts, ever.
        emit('executing', `[Full Access] Bypassing Tier ${step.confirmationTier} confirmation`, requestId, step.id);
      } else {
        // Slice 1: auto-approve in CLI dev mode. Slice 3 adds real confirmation cards.
        emit('executing', `[Tier ${step.confirmationTier}] Confirmation required — auto-approved (CLI dev mode)`, requestId, step.id);
      }
    }

    const beforeState = await this.reliability.observe(step, requestId);

    emit('executing', `${step.action}(${JSON.stringify(step.params)})`, requestId, step.id);

    const result = await agent.execute(step.action, step.params, requestId, step.id);

    if (!result.success) {
      emit('failed', `${step.id} failed: ${result.error ?? 'unknown error'}`, requestId, step.id);
      return;
    }

    const verification = await this.reliability.verify(step, beforeState, requestId);

    if (verification.status === 'VERIFIED') {
      emit('done', `${step.id} verified ✓ — ${verification.reason}`, requestId, step.id);
      completed.add(step.id);
    } else if (verification.status === 'UNVERIFIABLE') {
      emit(
        'done',
        `${step.id} completed (unverifiable — ${verification.reason})`,
        requestId,
        step.id,
      );
      completed.add(step.id);
    } else {
      // FAILED verification — one retry
      emit(
        'retrying',
        `${step.id} verification failed (${verification.reason}) — retrying`,
        requestId,
        step.id,
      );

      const retry = await agent.execute(step.action, step.params, requestId, step.id);
      const retryVerification = await this.reliability.verify(step, beforeState, requestId);

      if (retry.success && retryVerification.status !== 'FAILED') {
        emit('done', `${step.id} verified on retry ✓`, requestId, step.id);
        completed.add(step.id);
      } else {
        emit('failed', `${step.id} failed after retry`, requestId, step.id);
      }
    }
  }
}
