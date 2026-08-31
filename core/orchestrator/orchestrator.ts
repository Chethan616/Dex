import {
  AgentContext,
  AgentResult,
  AgentSignal,
  AgentStepSummary,
  ExecutionPlan,
  ExecutionStep,
  TaskStatus,
} from '../events/types';
import { AgentRegistry } from './registry';
import { CancellationRegistry } from './cancellation';
import { ReliabilityLayer } from '../reliability/observation_engine';
import { Telemetry } from '../memory/telemetry';
import { ArtifactStore } from '../memory/artifacts';
import { ConfirmationManager } from '../confirmation/confirmation_manager';
import { emit } from '../events/bus';

type StepOutcome = 'ok' | 'failed' | 'cancelled';

export class Orchestrator {
  constructor(
    private registry: AgentRegistry,
    private reliability: ReliabilityLayer,
    /**
     * Boolean, or a function evaluated per step.
     *
     * A function, because Full Access is not a fact about the config — it is a
     * fact about the daemon. Configured-on but not actually elevated used to be
     * the worst state available: confirmations skipped for actions that then
     * failed at the daemon anyway. `src/main.ts` passes a getter that reports
     * on only once the daemon has said `elevated: true`.
     */
    private fullAccess: boolean | (() => boolean) = false,
    private confirmations: ConfirmationManager = new ConfirmationManager(),
    private cancellation: CancellationRegistry = new CancellationRegistry(),
    /** Records what each step actually did, for the usage history. */
    private telemetry: Telemetry = new Telemetry(),
    /** Records what steps actually produced, so later requests can refer to it. */
    private artifacts: ArtifactStore = new ArtifactStore(),
  ) {}

  private sessionId = '';

  /** True while running a plan nobody is watching. See gateStep. */
  private unattended = false;

  async execute(plan: ExecutionPlan): Promise<{ status: TaskStatus; summary: string }> {
    const { requestId, steps, intent } = plan;

    emit('planning', `Plan: "${intent}" — ${steps.length} step(s)`, requestId, undefined, plan);

    const completed = new Set<string>();
    const remaining = [...steps];
    const completionDetails: string[] = [];
    const stepReports = new Map<string, AgentStepSummary>();
    this.sessionId = plan.sessionId ?? '';
    this.unattended = plan.unattended === true;

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
          ready.map((step) => this.executeStep(
            step,
            requestId,
            completed,
            completionDetails,
            stepReports,
            intent,
          )),
        );

        let sawCancel = false;
        let sawFailure = false;
        for (const result of results) {
          if (result.status === 'rejected') {
            emit('failed', `Step threw unexpectedly: ${result.reason}`, requestId);
            sawFailure = true;
          } else if (result.value === 'cancelled') {
            sawCancel = true;
          } else if (result.value === 'failed') {
            sawFailure = true;
          }
        }

        for (const step of ready) {
          remaining.splice(remaining.indexOf(step), 1);
        }

        if (sawCancel || this.cancellation.isCancelled(requestId)) {
          return this.cancelledResult(requestId, intent);
        }
        if (sawFailure) {
          const failedSteps = ready
            .filter((step) => stepReports.get(step.id)?.status === 'failed')
            .map((step) => step.id);
          const detail = failedSteps.length > 0 ? `: ${failedSteps.join(', ')}` : '';
          emit('failed', `Stopped because an agent could not complete${detail}`, requestId);
          return { status: 'FAILED', summary: `Agent could not complete${detail}` };
        }
      }

      const failed = steps.filter((s) => !completed.has(s.id));
      if (failed.length > 0) {
        return {
          status: 'FAILED',
          summary: `Failed steps: ${failed.map((s) => s.id).join(', ')}`,
        };
      }

      const detail = completionDetails.length > 0
        ? ` — ${completionDetails.join('; ')}`
        : '';
      const summary = `${intent}${detail}`;
      emit('done', `Done: ${summary}`, requestId, undefined, completionDetails);
      return { status: 'COMPLETED', summary };
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
    completionDetails: string[],
    stepReports: Map<string, AgentStepSummary>,
    intent: string,
    escalated = false,
    attempt = 1,
    retryReason = '',
  ): Promise<StepOutcome> {
    emit(
      'selecting',
      `Planner selected ${step.id}: ${describeStep(step)}`,
      requestId,
      step.id,
      { capability: step.capability, action: step.action },
    );

    const agent = this.registry.resolve(step.capability);
    if (!agent) {
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: 'none',
        status: 'failed',
        message: `No agent is registered for ${step.capability}.`,
      });
      emit(
        'failed',
        `No agent is registered for ${step.capability}.`,
        requestId,
        step.id,
      );
      return 'failed';
    }

    let agentName = agent.name;
    const previousSteps = step.dependsOn
      .map((dependency) => stepReports.get(dependency))
      .filter((report): report is AgentStepSummary => report !== undefined);
    const instruction = buildAgentInstruction(intent, step, previousSteps, retryReason);
    const ctx = this.contextFor(step, requestId, {
      agent: agentName,
      instruction,
      previousSteps,
      attempt,
      shouldRetry: attempt > 1,
      signalMessage: retryReason || `Continue with ${describeStep(step)}.`,
    });

    const gate = await this.gateStep(step, requestId);
    if (gate !== 'ok') {
      const cancelled = gate === 'cancelled';
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'The owner stopped this task.' : 'The step was not approved.',
      });
      return gate;
    }

    const beforeState = await this.reliability.observe(step, requestId);

    emit(
      'dispatching',
      `Sent to ${agentName}: ${instruction}`,
      requestId,
      step.id,
      this.agentEventData(agentName, ctx.signal?.(), previousSteps),
    );
    emit(
      'executing',
      `${agentName} is working on it.`,
      requestId,
      step.id,
      this.agentEventData(agentName, ctx.signal?.(), previousSteps),
    );
    let result = await agent.execute(step.action, step.params, requestId, step.id, ctx);

    // The agent hit the edge of its mechanism rather than failing. Hand the
    // same step to the tier that can actually do it. Once only — see `escalate`
    // in AgentResult for why this must not chain.
    if (!result.success && result.escalate && !escalated) {
      const escalation = await this.escalate(
        step,
        result.escalate,
        requestId,
        intent,
        previousSteps,
        result.error ?? 'the first agent could not reach it',
      );
      if (escalation) {
        result = escalation.result;
        agentName = escalation.agentName;
      }
    }

    if (!result.success) {
      // A step the owner declined mid-flight is a decision, not a failure to
      // report as one — the cancel path already told them what happened.
      if (this.cancellation.isCancelled(requestId)) return 'cancelled';
      const message = `${agentName} could not complete the step: ${result.error ?? 'unknown error'}`;
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: 'failed',
        message,
      });
      emit('failed', message, requestId, step.id, {
        ...this.agentEventData(agentName, ctx.signal?.(), previousSteps),
        signal: this.signalFor(requestId, false, false, message, attempt),
      });
      return 'failed';
    }

    if (this.cancellation.isCancelled(requestId)) return 'cancelled';

    const verification = await this.reliability.verify(step, beforeState, requestId, result);

    // Only from a step that verified. An artifact recorded for something that
    // did not happen makes "the report" resolve to a file that was never
    // written, and the owner has no reason to doubt it.
    if (verification.status !== 'FAILED') {
      this.artifacts.recordFromStep(step, result, requestId, this.sessionId);
    }

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
      this.captureCompletionDetail(step, verification.reason, completionDetails);
      const message = `${agentName} verified it: ${verification.reason}. The plan can continue.`;
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: 'succeeded',
        message,
      });
      emit('done', message, requestId, step.id, {
        ...this.agentEventData(agentName, ctx.signal?.(), previousSteps),
        verification: verification.status,
      });
      completed.add(step.id);
      return 'ok';
    }

    if (verification.status === 'UNVERIFIABLE') {
      const message = `${agentName} completed it, but verification was unavailable: ${verification.reason}. The plan can continue.`;
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: 'completed',
        message,
      });
      emit('done', message, requestId, step.id, {
        ...this.agentEventData(agentName, ctx.signal?.(), previousSteps),
        verification: verification.status,
      });
      completed.add(step.id);
      return 'ok';
    }

    // FAILED verification. One retry — but only if running it again could
    // plausibly go differently. A CAPTCHA the owner already declined, or a tool
    // the server does not have, will fail identically and cost the owner
    // another wait for the privilege.
    if (result.retryable === false) {
      const message = `${agentName} could not verify the step and will not repeat it: ${verification.reason}`;
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: 'failed',
        message,
      });
      emit(
        'failed',
        message,
        requestId,
        step.id,
        this.agentEventData(agentName, ctx.signal?.(), previousSteps),
      );
      return 'failed';
    }

    const recheckOnly = this.recheckWithoutRepeating(step);
    const retryMessage = recheckOnly
      ? `The previous attempt by ${agentName} did not verify: ${verification.reason}. I will check the result again without repeating the action.`
      : `The previous attempt by ${agentName} did not verify: ${verification.reason}. I am asking the agent to try again.`;
    stepReports.set(step.id, {
      stepId: step.id,
      action: step.action,
      agent: agentName,
      status: 'retrying',
      message: retryMessage,
    });
    emit(
      'retrying',
      retryMessage,
      requestId,
      step.id,
      {
        ...this.agentEventData(agentName, ctx.signal?.(), previousSteps),
        signal: this.signalFor(requestId, false, !recheckOnly, retryMessage, attempt + 1),
      },
    );

    // Launching a window, starting a program, or opening a location is not a
    // safe retry: the first invocation may have succeeded while verification
    // was still catching up. Re-read the state instead of creating a second
    // Notepad, Explorer window, or game process.
    const retryCtx = this.contextFor(step, requestId, {
      agent: agentName,
      instruction: buildAgentInstruction(intent, step, previousSteps, retryMessage),
      previousSteps,
      attempt: attempt + 1,
      shouldRetry: !recheckOnly,
      signalMessage: retryMessage,
    });
    const retry = recheckOnly
      ? result
      : await agent.execute(step.action, step.params, requestId, step.id, retryCtx);
    if (this.cancellation.isCancelled(requestId)) return 'cancelled';
    const retryVerification = await this.reliability.verify(step, beforeState, requestId, retry);

    if (retry.success && retryVerification.status !== 'FAILED') {
      this.captureCompletionDetail(step, retryVerification.reason, completionDetails);
      const message = `${agentName} ${recheckOnly ? 'confirmed the result after a recheck' : 'succeeded on the second attempt'}: ${retryVerification.reason}. The plan can continue.`;
      stepReports.set(step.id, {
        stepId: step.id,
        action: step.action,
        agent: agentName,
        status: 'succeeded',
        message,
      });
      emit('done', message, requestId, step.id, {
        ...this.agentEventData(agentName, retryCtx.signal?.(), previousSteps),
        verification: retryVerification.status,
      });
      completed.add(step.id);
      return 'ok';
    }

    const message = `${agentName} still could not verify the step after trying again.`;
    stepReports.set(step.id, {
      stepId: step.id,
      action: step.action,
      agent: agentName,
      status: 'failed',
      message,
    });
    emit('failed', message, requestId, step.id, {
      ...this.agentEventData(agentName, retryCtx.signal?.(), previousSteps),
      signal: this.signalFor(requestId, false, false, message, attempt + 1),
    });
    return 'failed';
  }

  private recheckWithoutRepeating(step: ExecutionStep): boolean {
    if (step.action === 'launch_app' || step.action === 'run_program') return true;
    return step.action === 'find_files' && step.params.open_location === true;
  }

  /** Keep live file/code results in the task's final answer. */
  private captureCompletionDetail(
    step: ExecutionStep,
    reason: string,
    details: string[],
  ): void {
    const isUsefulResult =
      (step.capability === 'can_control_app' && step.action === 'read_element') ||
      (step.capability === 'can_control_files' &&
        ['find_files', 'write_file', 'run_program'].includes(step.action));
    if (!isUsefulResult || details.includes(reason)) return;
    details.push(reason);
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
    intent: string,
    previousSteps: readonly AgentStepSummary[],
    reason: string,
  ): Promise<{ result: AgentResult; agentName: string } | undefined> {
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

    const instruction = buildAgentInstruction(
      intent,
      step,
      previousSteps,
      `The first agent could not reach this step: ${reason}. Continue with your mechanism.`,
    );
    const ctx = this.contextFor(step, requestId, {
      agent: agent.name,
      instruction,
      previousSteps,
      attempt: 1,
      shouldRetry: false,
      signalMessage: instruction,
    });
    emit(
      'dispatching',
      `The first agent could not reach it, so the planner sent it to ${agent.name}: ${instruction}`,
      requestId,
      step.id,
      this.agentEventData(agent.name, ctx.signal?.(), previousSteps),
    );

    return {
      result: await agent.execute(step.action, step.params, requestId, step.id, ctx),
      agentName: agent.name,
    };
  }

  /**
   * What an agent can reach back for while a step is in flight.
   *
   * `handoff` is not gated on Full Access, and that is the whole point of
   * keeping it separate from the confirmation gate below. Full Access says the
   * owner already trusts DEX to act without asking. It does not, and cannot,
   * give DEX eyes that can read a CAPTCHA or a password only the owner knows.
   */
  private contextFor(
    step: ExecutionStep,
    requestId: string,
    options: {
      agent: string;
      instruction: string;
      previousSteps: readonly AgentStepSummary[];
      attempt: number;
      shouldRetry: boolean;
      signalMessage: string;
    },
  ): AgentContext {
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
      instruction: options.instruction,
      previousSteps: options.previousSteps,
      signal: () => this.signalFor(
        requestId,
        false,
        options.shouldRetry,
        options.signalMessage,
        options.attempt,
      ),
      report: (message: string) => {
        const clean = message.trim();
        if (!clean) return;
        emit(
          'executing',
          `${options.agent}: ${clean}`,
          requestId,
          step.id,
          this.agentEventData(options.agent, undefined, options.previousSteps),
        );
      },
    };
  }

  private signalFor(
    requestId: string,
    interrupted: boolean,
    shouldRetry: boolean,
    message: string,
    attempt: number,
  ): AgentSignal {
    const cancelled = interrupted || this.cancellation.isCancelled(requestId);
    return {
      shouldContinue: !cancelled,
      shouldRetry: !cancelled && shouldRetry,
      interrupted: cancelled,
      message: cancelled ? 'The owner interrupted this task. Stop safely now.' : message,
      attempt,
    };
  }

  private agentEventData(
    agent: string,
    signal: AgentSignal | undefined,
    previousSteps: readonly AgentStepSummary[],
  ): Record<string, unknown> {
    return {
      agent,
      signal,
      previous_steps: previousSteps,
    };
  }

  private hasFullAccess(): boolean {
    return typeof this.fullAccess === 'function' ? this.fullAccess() : this.fullAccess;
  }

  /**
   * The consequence of a RED registry path, or null if this step is not one.
   *
   * Asks the daemon's own classifier rather than reimplementing the pattern
   * list here — one policy, in one place, and the daemon enforces it again
   * independently when the write arrives. Two gates, because untrusted content
   * reaches the planner: a web page Dex reads can propose steps, and these are
   * the keys it would aim for. A gate outside the process the model talks to is
   * the one that cannot be argued past.
   *
   * Classification failure is treated as RED. Not knowing whether a key is
   * dangerous is not a reason to assume it is safe.
   */
  private async redBandReason(
    step: ExecutionStep,
    requestId: string,
  ): Promise<string | null> {
    if (step.action !== 'registry_write') return null;
    const path = String((step.params as { path?: unknown }).path ?? '');
    if (!path) return null;

    const agent = this.registry.resolve('can_control_os');
    if (!agent) return null;

    try {
      const verdict = await agent.execute(
        'registry_classify', { path }, requestId, step.id,
      );
      const data = verdict.data as { band?: string; reason?: string } | undefined;
      if (!verdict.success) return 'could not be classified';
      return data?.band === 'red' ? (data.reason ?? 'a Windows security setting') : null;
    } catch {
      return 'could not be classified';
    }
  }

  /**
   * Tier 4 runs silently. Tier 1–3 need the owner unless Full Access is on —
   * which means the daemon is running elevated in the owner's session, so a
   * prompt would be asking permission the owner already granted.
   *
   * RED registry paths are the exception and always ask. See `redBandReason`.
   */
  private async gateStep(step: ExecutionStep, requestId: string): Promise<StepOutcome> {
    // RED registry paths are decided here, before anything else, because this
    // is the one class of step whose tier the planner is not allowed to choose
    // and Full Access is not allowed to skip.
    const red = await this.redBandReason(step, requestId);

    if (!red && step.confirmationTier >= 4) return 'ok';

    // Nobody is watching, so nobody can answer. Refuse rather than wait for a
    // card that will expire — and rather than fall through to the
    // ConfirmationManager's headless auto-approve, which is a reasonable
    // convenience for someone sitting at a CLI and a hole in a job that fires
    // at 3am with the UI closed.
    //
    // Full Access does not rescue a RED path: it is the one thing that always
    // asks, and a schedule cannot.
    if (this.unattended && (red || !this.hasFullAccess())) {
      emit(
        'failed',
        `${step.id} needs approval (Tier ${step.confirmationTier}` +
          `${red ? `, RED — ${red}` : ''}) and this run is unattended. ` +
          'Scheduled tasks cannot answer a confirmation. Either run it yourself, ' +
          'or enable Full Access for the tiers it needs.',
        requestId,
        step.id,
      );
      return 'cancelled';
    }

    if (!red && this.hasFullAccess()) {
      emit(
        'executing',
        `[Full Access] Bypassing Tier ${step.confirmationTier} confirmation`,
        requestId,
        step.id,
      );
      return 'ok';
    }

    if (red) {
      emit(
        'awaiting',
        `${step.action} touches a RED registry key — ${red}. ` +
          'This always asks, even with Full Access on.',
        requestId,
        step.id,
      );
    }

    const verdict = await this.confirmations.request(
      red ? { ...step, confirmationTier: 2 } : step,
      requestId,
    );

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

function buildAgentInstruction(
  intent: string,
  step: ExecutionStep,
  previousSteps: readonly AgentStepSummary[],
  retryReason = '',
): string {
  const previous = previousSteps.length > 0
    ? `Previous steps: ${previousSteps.map((report) => report.message).join(' ')} `
    : '';
  const recovery = retryReason ? `${retryReason} ` : '';
  return `${recovery}Task: "${intent}". ${previous}Now ${describeStep(step)}.`;
}

function describeStep(step: ExecutionStep): string {
  const params = step.params;
  const value = (name: string): string => String(params[name] ?? '').trim();
  const quoted = (name: string, fallback: string): string => {
    const text = value(name) || fallback;
    return `"${text}"`;
  };

  switch (step.action) {
    case 'launch_app':
      return `open ${quoted('name', 'the requested application')}`;
    case 'close_app':
      return `close ${quoted('name', 'the requested application')}`;
    case 'click_element':
      return `click ${quoted('name', 'the requested control')} in ${quoted('window', 'the target window')}`;
    case 'set_text':
      return `set the requested text in ${quoted('name', 'the target field')} in ${quoted('window', 'the target window')}`;
    case 'read_element':
      return `read ${quoted('name', 'the requested value')} from ${quoted('window', 'the target window')}`;
    case 'find_files':
      return `search ${quoted('root', 'the requested folder')} for filenames related to ${quoted('query', 'the request')}`;
    case 'write_file':
      return `write the requested source file ${quoted('path', 'inside the Dex workspace')}`;
    case 'run_program':
      return `run ${quoted('path', 'the requested program')} with the installed ${quoted('runtime', 'runtime')}`;
    default:
      return `perform ${step.action.replace(/_/g, ' ')}`;
  }
}
