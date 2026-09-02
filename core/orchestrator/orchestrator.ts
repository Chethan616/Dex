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
import { describeUnresolved, findRefs, resolveStepRefs } from './step_refs';
import { emit } from '../events/bus';

type StepOutcome = 'ok' | 'failed' | 'cancelled';

/**
 * The one thing the Orchestrator needs from the Brain.
 *
 * Narrowed to a single method rather than importing the Brain itself. The
 * Orchestrator's job is to run a plan; knowing how plans are made is the
 * Gateway's business, and a dependency on the whole planner here would be one
 * more edge in a graph that is already busy.
 */
export interface PlanRepairer {
  repair(
    input: {
      intent: string;
      failedStep: ExecutionStep;
      failure: string;
      outputs: ReadonlyMap<string, unknown>;
      remaining: ExecutionStep[];
    },
    signal?: AbortSignal,
  ): Promise<{ steps: ExecutionStep[]; reason: string } | null>;
}

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

  /**
   * The cancellation registry this Orchestrator runs against.
   *
   * Exposed so the Gateway can take the same AbortSignal for the planning call.
   * Planning happens before the Orchestrator is involved at all, and it is the
   * longest and most expensive part of a task — Stop has to reach it, and this
   * is the one registry both halves have to agree on.
   */
  get cancellations(): CancellationRegistry {
    return this.cancellation;
  }

  private sessionId = '';

  /** True while running a plan nobody is watching. See gateStep. */
  private unattended = false;

  /**
   * What each completed step actually returned, keyed by step id.
   *
   * The reason a plan can now pass a value along its own edges. Held as
   * per-plan state beside sessionId rather than threaded through executeStep,
   * which already takes nine arguments.
   *
   * This is `AgentResult.data` unchanged — not the prose summary the agents
   * see, and not the flattened `facts` the closing answer is built from. A
   * reference like `{{step_1.output.best_primary}}` reads from here.
   */
  private outputs = new Map<string, unknown>();

  /** Plan repairs spent on the current task. See `repairPlan`. */
  private repairs = 0;

  /** One. A repair loop is a worse outcome than a clean failure. */
  private static readonly MAX_REPAIRS = 1;

  private brain?: PlanRepairer;

  /**
   * Lend the Orchestrator a planner, so a failed step can be repaired.
   *
   * Set by the Gateway rather than passed to the constructor, and re-set when
   * the Gateway swaps providers — the Orchestrator is built first, and a
   * snapshot taken then would go stale the moment Settings changed the model.
   * Absent is a supported state: without it, a failed step fails, which is
   * exactly what happened before repairs existed.
   */
  usePlanner(brain: PlanRepairer): void {
    this.brain = brain;
  }

  async execute(
    plan: ExecutionPlan,
  ): Promise<{ status: TaskStatus; summary: string; facts?: Record<string, unknown>[] }> {
    const { requestId, steps, intent } = plan;

    emit('planning', `Plan: "${intent}" — ${steps.length} step(s)`, requestId, undefined, plan);

    const completed = new Set<string>();
    const remaining = [...steps];
    // Which step ids this task is waiting on. Starts as the plan's, and is
    // rewritten when a repair replaces some of them — see repairPlan.
    const expected = new Set(steps.map((s) => s.id));
    // What the steps found, for the answer the owner is given.
    const facts: Record<string, unknown>[] = [];
    const stepReports = new Map<string, AgentStepSummary>();
    this.sessionId = plan.sessionId ?? '';
    this.unattended = plan.unattended === true;
    this.outputs.clear();
    this.repairs = 0;

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
            facts,
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
          const failed = ready.filter(
            (step) => stepReports.get(step.id)?.status === 'failed',
          );

          // Before giving up: show the Brain what actually happened and let it
          // fix what is left. See repairPlan.
          const repaired = await this.repairPlan(
            failed[0],
            stepReports,
            remaining,
            intent,
            requestId,
          );
          if (repaired) {
            remaining.length = 0;
            remaining.push(...repaired);
            // The plan is no longer the plan. Without this, the completeness
            // check below still looks for the step that was replaced, never
            // finds it in `completed`, and reports a repaired task as failed.
            for (const step of failed) expected.delete(step.id);
            for (const step of repaired) expected.add(step.id);
            continue;
          }

          const detail = failed.length > 0 ? `: ${failed.map((s) => s.id).join(', ')}` : '';
          emit('failed', `Stopped because an agent could not complete${detail}`, requestId);
          return { status: 'FAILED', summary: `Agent could not complete${detail}` };
        }
      }

      const missing = [...expected].filter((id) => !completed.has(id));
      if (missing.length > 0) {
        return {
          status: 'FAILED',
          summary: `Failed steps: ${missing.join(', ')}`,
        };
      }

      // Deliberately no terminal event here.
      //
      // This used to emit "Done: Retrieve the current Windows power plan" — the
      // plan's restatement of the question — and the Gateway then emitted the
      // actual answer underneath it. Two closing lines, the first of which
      // said nothing, and the first is the one that reads as the conclusion.
      //
      // The Gateway emits exactly one, because only the Gateway knows whether
      // there is an answer to give. See Gateway.finish.
      return { status: 'COMPLETED', summary: intent, facts };
    } finally {
      this.cancellation.clear(requestId);
      this.confirmations.cancelAll(requestId);
    }
  }

  /**
   * A step failed. Ask the Brain to fix the rest of the plan, once.
   *
   * The Orchestrator already retries one class of failure: a step that ran but
   * did not verify, where doing it again might genuinely go differently. This
   * is the other class — a step that failed because the plan was wrong, where
   * running it again produces the identical error forever. `set_dns` handed
   * `{{step_1.output.best_primary}}` will answer "Invalid IP" every time.
   *
   * What makes this a repair rather than a guess is the evidence: the Brain is
   * given what the completed steps actually returned, so it can see the value
   * the failed step should have had.
   *
   * Four boundaries, and each of them is load-bearing:
   *
   *   - **Once.** A repair loop is a worse outcome than a clean failure: it
   *     spends the owner's tokens and their time to arrive at the same place.
   *   - **Completed steps are never replaced.** They have already changed the
   *     machine. Only the failed step and what had not run yet are up for
   *     replanning, so nothing is done twice.
   *   - **Repaired steps are gated like any others.** They go back through the
   *     same loop, so `gateStep` still runs and a Tier 2 step still raises a
   *     card. A repair cannot launder a step past a confirmation.
   *   - **Never after a stop.** Cancelling is a decision, not a fault.
   *
   * Returns the replacement steps, or null to let the task fail as it was
   * going to.
   */
  private async repairPlan(
    failedStep: ExecutionStep | undefined,
    stepReports: Map<string, AgentStepSummary>,
    remaining: readonly ExecutionStep[],
    intent: string,
    requestId: string,
  ): Promise<ExecutionStep[] | null> {
    if (!failedStep || !this.brain) return null;
    if (this.repairs >= Orchestrator.MAX_REPAIRS) return null;
    if (this.cancellation.isCancelled(requestId)) return null;

    // Nobody is watching an unattended run, and a repair is a fresh model call
    // whose steps may need approving. Failing at 3am is the honest outcome.
    if (this.unattended) return null;

    this.repairs += 1;
    const failure = stepReports.get(failedStep.id)?.message ?? 'the step failed';

    emit(
      'routing',
      `${failedStep.id} failed — looking at what the earlier steps returned and replanning the rest`,
      requestId,
      failedStep.id,
    );

    const repaired = await this.brain.repair(
      {
        intent,
        failedStep,
        failure,
        outputs: this.outputs,
        // The failed step is offered for replacement alongside the ones that
        // never ran: it is the one most likely to be what was wrong.
        remaining: [failedStep, ...remaining],
      },
      this.cancellation.signal(requestId),
    );

    if (!repaired || repaired.steps.length === 0) {
      emit(
        'failed',
        'That could not be fixed by replanning.',
        requestId,
        failedStep.id,
      );
      return null;
    }

    // The repaired steps start from a clean slate: anything they depended on
    // has either completed (and is in `outputs`) or is being replaced. A
    // dependency on a step that no longer exists would deadlock the loop.
    const ids = new Set(repaired.steps.map((s) => s.id));
    const steps = repaired.steps.map((s) => ({
      ...s,
      dependsOn: s.dependsOn.filter((d) => ids.has(d)),
    }));

    emit(
      'planning',
      `Replanned: ${repaired.reason} — ${steps.length} step(s) to go`,
      requestId,
      undefined,
      { requestId, intent, tier: 2, steps },
    );
    return steps;
  }

  private cancelledResult(requestId: string, intent: string): { status: TaskStatus; summary: string } {
    emit('cancelled', `Cancelled: ${intent}`, requestId);
    return { status: 'CANCELLED', summary: `Cancelled by owner: ${intent}` };
  }

  private async executeStep(
    step: ExecutionStep,
    requestId: string,
    completed: Set<string>,
    facts: Record<string, unknown>[],
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
    // Fill in whatever an earlier step produced.
    //
    // Deliberately after gateStep, so the confirmation card and the daemon's
    // band classification both see the real command rather than a template.
    // Approving `{{step_1.output.command}}` would be approving nothing.
    const refs = findRefs(step.params);
    if (refs.length > 0) {
      const resolution = resolveStepRefs(step.params, this.outputs);
      if (resolution.unresolved.length > 0) {
        // Never pass an unresolved reference through. `set_dns` was handed the
        // literal string `{{step_1.output.best_primary}}` and answered
        // "Invalid IP" — the placeholder reaching a real action is the whole
        // bug, and passing it through is how it happens.
        const message = describeUnresolved(resolution.unresolved, this.outputs);
        stepReports.set(step.id, {
          stepId: step.id,
          action: step.action,
          agent: agentName,
          status: 'failed',
          message,
        });
        emit('failed', `${step.id}: ${message}`, requestId, step.id);
        return 'failed';
      }
      step = { ...step, params: resolution.params };
      emit(
        'executing',
        `Filled in from earlier steps: ${refs.join(', ')}`,
        requestId,
        step.id,
      );
    }

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
      this.captureCompletionDetail(step, result, facts);
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
      // What it returned, kept so a later step can use it. See `outputs`.
      this.outputs.set(step.id, result.data);
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
      // Unverifiable is not untrue — the step ran and returned something, there
      // was simply no independent way to confirm it. A later step may still
      // need the value, and withholding it would be its own kind of lie.
      this.outputs.set(step.id, result.data);
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
      this.captureCompletionDetail(step, result, facts);
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
  /**
   * Keep what a step actually found, so the owner can be told.
   *
   * This used to be an allow-list of four actions carrying the *verification
   * reason* — which for a read is the string "Read-only action — no state to
   * verify". So "what's my power plan" finished with the plan's restatement of
   * the question and never the answer, while `result.data` sat unused two lines
   * away. Both halves were wrong: the wrong actions, and the wrong field.
   *
   * Now any step that read something contributes its data. The test is the
   * shape of the action name rather than a list, so an action added later is
   * included without anyone remembering to come back here — which is exactly
   * how the previous list went stale.
   */
  private captureCompletionDetail(
    step: ExecutionStep,
    result: AgentResult,
    facts: Record<string, unknown>[],
  ): void {
    if (!isReadShaped(step.action)) return;
    if (result.data === undefined || result.data === null) return;

    facts.push({
      action: step.action,
      // Objects pass through as they are; a bare string or number is wrapped so
      // the phrasing pass always receives the same shape.
      ...(typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : { value: result.data }),
    });
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
   * What the daemon says a shell command actually does.
   *
   * The planner guesses a confirmation tier from the words of the request. The
   * daemon classifies the command itself, with the same rules it will apply
   * when it runs it. When those two disagree the daemon is right, and it was
   * disagreeing constantly in both directions:
   *
   *   too high  `powercfg /list` and `git status` are reads the daemon runs
   *             silently, planned as Tier 2 because "power" sounded serious.
   *             Every read raised a card.
   *   too low   a command the planner thought harmless is AMBER at the daemon,
   *             and ran with no card at all.
   *
   * So for shell steps the band decides. Cheap enough to ask per step — it is a
   * local pipe call against a pure function, no process is started.
   *
   * Returns null when there is nothing to classify or the daemon cannot be
   * reached, and the planner's tier stands: an unreachable daemon must not
   * quietly turn a confirmation off.
   */
  private async commandBand(
    step: ExecutionStep,
    requestId: string,
  ): Promise<{ band: string; reason: string } | null> {
    if (step.action !== 'run_command' && step.action !== 'run_shell') return null;

    const params = step.params as { command?: unknown; args?: unknown };
    const command = params.command;
    if (command === undefined || command === null || command === '') return null;

    const agent = this.registry.resolve('can_control_os');
    if (!agent) return null;

    try {
      const verdict = await agent.execute(
        'classify_command', { command }, requestId, step.id,
      );
      if (!verdict.success) return null;
      const data = verdict.data as { band?: string; reason?: string } | undefined;
      if (!data?.band) return null;
      return { band: data.band, reason: data.reason ?? 'run a command' };
    } catch {
      return null;
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

    // A shell command is judged by the daemon that will run it, not by the
    // planner's guess. See commandBand.
    const shell = red ? null : await this.commandBand(step, requestId);
    let planScope: string | undefined;

    if (shell?.band === 'green') {
      // GREEN is the daemon's promise that nothing changes. Asking about a read
      // teaches the owner to click through cards without reading them, which is
      // how the cards that matter stop working.
      if (step.confirmationTier < 4) {
        emit(
          'executing',
          `${step.action} is a read (${shell.reason}) — running it without asking`,
          requestId,
          step.id,
        );
      }
      return 'ok';
    }

    if (shell && shell.band !== 'green') {
      // AMBER, or RED that the daemon will refuse on its own terms. Either way
      // the owner is asked, whatever tier the planner wrote down.
      step = { ...step, confirmationTier: step.confirmationTier < 2 ? step.confirmationTier : 2 };
      planScope = shell.reason;
    }

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
      // A RED registry key always asks, so it never carries a plan scope.
      red ? undefined : planScope,
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
    case 'window_state':
      return `check that ${quoted('window', 'the target window')} is open and ready`;
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

/**
 * Did this step read something, rather than change something?
 *
 * Shape, not a list. The previous version named four actions explicitly and
 * went stale the moment a fifth was added — which is how every `get_*` action
 * came to complete without telling the owner anything. A naming convention the
 * whole codebase already follows is a better test than a list somebody has to
 * remember to update.
 */
export function isReadShaped(action: string): boolean {
  return (
    // Verb first: get_dns, list_processes, read_file, hash_file.
    /^(get|list|read|find|search|query|describe|check|hash)_/.test(action) ||
    // Verb last: registry_read, get_wifi_status, window_state. Dex names a few
    // actions noun-first, and the first version of this missed every one of
    // them — registry_read was found by the test, not by review.
    /_(read|status|state|classify|info)$/.test(action) ||
    // Names that follow neither convention.
    action === 'run_shell' ||
    action === 'run_command' ||
    action === 'extract' ||
    action === 'read_page' ||
    action === 'screenshot'
  );
}
