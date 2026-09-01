import { randomUUID } from 'crypto';
import { DexRequest, ExecutionPlan, TaskStatus } from './events/types';
import { OwnerGate } from './owner_gate';
import { Brain } from './brain/planner';
import { Orchestrator } from './orchestrator/orchestrator';
import { Telemetry } from './memory/telemetry';
import { ArtifactStore } from './memory/artifacts';
import { ReferenceResolver } from './memory/references';
import { SemanticCache } from './memory/semantic_cache';
import { SessionStore } from './memory/sessions';
import { WorkflowStore } from './workflows/store';
import { expandWorkflows } from './workflows/expand';
import { emit } from './events/bus';
import { factsForPhrasing, renderFacts, worthPhrasing } from './brain/answer';
import { DeliveryTarget, delivery } from './delivery/registry';

export interface GatewayResult {
  status: TaskStatus;
  summary: string;
  requestId: string;
  /** Set when the task ran from a saved workflow instead of a fresh plan. */
  workflow?: string;
  /** Set when this task looks worth saving — the UI and CLI offer it. */
  suggestSave?: { text: string; times: number };
  /**
   * Set when a reference like "the report" matched more than one thing. Nothing
   * was run; the owner has to say which they meant.
   */
  needsClarification?: string;
  /**
   * What Dex has to tell the owner: the reply to a question, or the phrased
   * result of a task that read something.
   *
   * Distinct from `summary`, which describes what was *done*. A read used to
   * report "Done: Retrieve the current Windows power plan" and never say what
   * the plan was — the value existed and was thrown away.
   */
  answer?: string;
}

export class Gateway {
  /** The last freshly planned task, so it can be saved as a workflow. */
  private lastPlanned?: { plan: ExecutionPlan; text: string };

  constructor(
    private ownerGate: OwnerGate,
    private brain: Brain,
    private orchestrator: Orchestrator,
    private telemetry = new Telemetry(),
    private workflows = new WorkflowStore(),
    private sessions = new SessionStore(),
    private artifacts = new ArtifactStore(),
    private references = new ReferenceResolver(artifacts),
    private cache = new SemanticCache(),
  ) {}

  /**
   * Handle one request.
   *
   * A thin wrapper so the delivery target is released on every path out —
   * success, failure, refusal, or a throw. A `DeliveryTarget` holds a live
   * connection to a chat, and one left behind is both a leaked handle and a
   * stale address a later task could deliver to.
   */
  /**
   * Swap the brain for a newly-configured one, in place.
   *
   * Called when Settings changes the provider. Without it the change would sit
   * in settings.json until the next restart, and a settings screen whose effect
   * is invisible until you restart — with nothing saying so — is worse than one
   * that refuses the change.
   *
   * The workflow callback is preserved: it is a live view of the saved
   * workflows, and rebuilding without it would silently stop the planner being
   * able to choose one.
   */
  rebuildBrain(): void {
    this.brain = new Brain(undefined, this.brain.workflowSource);
    emit('routing', `Brain is now ${this.brain.model}`, '');
  }

  async handle(
    source: DexRequest['source'],
    senderId: string,
    text: string,
    /**
     * Where to send anything this task produces.
     *
     * Supplied by the channel that received the message, so "send it to me"
     * resolves to the conversation that asked rather than to whichever adapter
     * happened to speak last. Absent for the CLI and the desktop app, where
     * the owner is already at the machine the file is on.
     */
    deliverTo?: DeliveryTarget,
  ): Promise<GatewayResult> {
    const requestId = randomUUID();
    if (deliverTo) delivery.register(requestId, deliverTo);
    try {
      return await this.dispatch(requestId, source, senderId, text);
    } finally {
      delivery.release(requestId);
    }
  }

  private async dispatch(
    requestId: string,
    source: DexRequest['source'],
    senderId: string,
    text: string,
  ): Promise<GatewayResult> {
    // Keyed by time rather than by sender: Dex has one owner, so a task begun
    // on a phone and followed up at the desk is the same conversation.
    const sessionId = this.sessions.current(source).id;

    const request: DexRequest = {
      requestId,
      sessionId,
      source,
      senderId,
      text: text.trim(),
      timestamp: Date.now(),
    };

    if (!this.ownerGate.verify(request)) {
      // Silent ignore — no response to non-owners, and nothing recorded about
      // them beyond the fact that something was ignored.
      return { status: 'ABORTED', summary: 'Unauthorized sender', requestId };
    }

    emit('thinking', `"${request.text}"`, requestId);

    // ── what does "the report" mean? ──────────────────────────────────────
    // Resolved before anything runs. An unresolvable reference has to stop the
    // task rather than be passed through: an agent handed the literal words
    // "the report" will either fail confusingly or act on the wrong thing.
    const refs = this.references.resolve(request.text);
    if (refs.ambiguous.length > 0) {
      const question = ReferenceResolver.question(refs.ambiguous[0]);
      emit('awaiting', question, requestId);
      this.telemetry.startTask({ requestId, sessionId, source, text: request.text });
      this.telemetry.finishTask(requestId, 'ABORTED');
      return {
        status: 'ABORTED',
        summary: 'Need to know which one you meant',
        requestId,
        needsClarification: question,
      };
    }

    if (refs.resolved.length > 0) {
      request.text = this.references.substitute(request.text, refs.resolved);
      for (const r of refs.resolved) {
        emit('thinking', `"${r.phrase}" → ${r.match.name} (${r.reason})`, requestId);
      }
    }

    // ── the free path ─────────────────────────────────────────────────────
    // An explicit `run <name>`, or a phrase that re-says something already
    // saved. Either way the steps are already known to work, so there is
    // nothing for the Brain to decide.
    const direct = this.resolveWorkflow(request.text);
    if (direct) {
      return this.runPlan(request, direct.plan, direct.name, sessionId);
    }

    this.telemetry.startTask({
      requestId,
      sessionId,
      source,
      text: request.text,
      provider: this.brain.model,
    });

    // A request Dex has already planned, asked in different words. Cheaper
    // than the Brain and, being a plan that completed once, no less reliable.
    const cached = await this.cache.lookup(request.text, requestId);
    if (cached) {
      emit(
        'routing',
        `Reusing the plan for "${cached.originalText}" (${(cached.similarity * 100).toFixed(0)}% match)`,
        requestId,
      );
      return this.runPlan(request, cached.plan, undefined, sessionId);
    }

    let plan: ExecutionPlan;
    try {
      plan = await this.brain.plan(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('failed', `Planning error: ${msg}`, requestId);
      this.telemetry.finishTask(requestId, 'FAILED');
      return { status: 'FAILED', summary: msg, requestId };
    }

    // A question rather than a task. Nothing to execute, nothing to verify,
    // nothing to cache — the answer is the whole result.
    //
    // Deliberately before workflow expansion and before the Orchestrator: an
    // empty plan reaching either of those is a plan that "completed" without
    // doing anything, which reports as success and teaches the owner to trust
    // a green tick that means nothing.
    if (plan.steps.length === 0 && plan.reply) {
      emit('done', plan.reply, requestId);
      this.telemetry.finishTask(requestId, 'ANSWERED');
      return { status: 'ANSWERED', summary: plan.reply, requestId, answer: plan.reply };
    }

    // The Brain may have chosen a saved workflow rather than planning from
    // scratch. Swap those steps for the ones already known to work, before
    // anything runs — so they carry their own confirmation tiers and are
    // verified like any other step.
    const { plan: finalPlan, expanded } = expandWorkflows(plan, this.workflows);
    if (expanded.length > 0) {
      emit(
        'routing',
        `Using saved workflow${expanded.length > 1 ? 's' : ''}: ${expanded.join(', ')}`,
        requestId,
      );
    }

    finalPlan.sessionId = sessionId;
    // A schedule fires whether or not anyone is at the machine, so the plan
    // carries that fact to the Orchestrator rather than the Orchestrator
    // guessing from the source.
    finalPlan.unattended = request.source === 'schedule';
    this.telemetry.planned(requestId, finalPlan);
    const result = await this.orchestrator.execute(finalPlan);
    this.telemetry.finishTask(requestId, result.status);

    if (result.status === 'COMPLETED') {
      this.lastPlanned = { plan: finalPlan, text: request.text };
      // Only successful plans are cached. Serving a known-broken plan faster is
      // not an optimisation.
      void this.cache.remember(request.text, finalPlan);
    }

    const answer = await this.finish(request, result);

    return {
      ...result,
      answer,
      requestId,
      // A task that reused a workflow is not a fresh one to offer saving.
      workflow: expanded[0],
      suggestSave:
        expanded.length > 0
          ? undefined
          : this.suggestion(request.text, finalPlan, result.status),
    };
  }

  /**
   * Close the task with exactly one line, and make it the useful one.
   *
   * A completed task used to end with two: the Orchestrator's
   * "Done: Retrieve the current Windows power plan", then the answer beneath
   * it. The first is the plan restating the question, it arrives first, and it
   * is the one that reads as the conclusion — so the thing the owner actually
   * asked for was the runner-up on its own screen.
   *
   * Now there is one closing line. It is the answer when there is one, and
   * what was done when there is not, because "Opened a web browser" is the
   * right way to finish an action and there is nothing to answer.
   */
  private async finish(
    request: DexRequest,
    result: { status: TaskStatus; summary: string; facts?: Record<string, unknown>[] },
  ): Promise<string | undefined> {
    if (result.status !== 'COMPLETED') return undefined;

    const answer = await this.answerFor(request, result.facts ?? []);
    emit('done', answer ?? `Done: ${result.summary}`, request.requestId);
    return answer;
  }

  /**
   * What to tell the owner about what was found.
   *
   * The Brain phrases it; if that call cannot be made, the facts are rendered
   * directly. The fallback is not a degraded mode to be embarrassed about — it
   * is the guarantee that asking Dex a question always produces an answer, even
   * when the free tier says no.
   *
   * An unattended run never phrases: there is nobody reading it, and a schedule
   * firing hourly would spend a model call each time to prettify a log line.
   */
  private async answerFor(
    request: DexRequest,
    facts: Record<string, unknown>[],
  ): Promise<string | undefined> {
    if (!worthPhrasing(facts)) return undefined;

    const rendered = renderFacts(facts);

    if (request.source === 'schedule') return rendered || undefined;

    const phrased = await this.brain.phrase(request.text, factsForPhrasing(facts));
    return phrased ?? rendered ?? undefined;
  }

  /**
   * Run a saved workflow by name with explicit arguments, or by recognising the
   * request as one already saved.
   *
   * Returns undefined for anything else, so the caller falls through to the
   * Brain. Failing to match is never an error — it just costs a planning call.
   */
  private resolveWorkflow(text: string): { plan: ExecutionPlan; name: string } | undefined {
    const requestId = randomUUID();

    // `run backup D:\` — the form for when you know exactly what you want.
    const explicit = text.match(/^\s*(?:run|do)\s+([a-z0-9][a-z0-9_-]*)\s*(.*)$/i);
    if (explicit) {
      const workflow = this.workflows.get(explicit[1]);
      if (workflow) {
        const values = (explicit[2].match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((v) =>
          v.replace(/^["']|["']$/g, ''),
        );
        const plan = this.workflows.bind(
          workflow,
          this.workflows.bindPositional(workflow, values),
          requestId,
        );
        return { plan, name: workflow.name };
      }
    }

    const matched = this.workflows.matchRequest(text);
    if (matched) {
      return {
        plan: this.workflows.bind(matched.workflow, matched.args, requestId),
        name: matched.workflow.name,
      };
    }

    return undefined;
  }

  /** Run a plan that did not come from the Brain — a workflow, or a cache hit. */
  private async runPlan(
    request: DexRequest,
    plan: ExecutionPlan,
    workflow: string | undefined,
    sessionId: string,
  ): Promise<GatewayResult> {
    if (workflow) {
      emit('routing', `Saved workflow "${workflow}" — no planning needed`, plan.requestId);
    }

    this.telemetry.startTask({
      requestId: plan.requestId,
      sessionId,
      source: request.source,
      text: request.text,
      workflow,
    });
    plan.sessionId = sessionId;
    plan.unattended = request.source === 'schedule';
    this.telemetry.planned(plan.requestId, plan);

    if (workflow) this.workflows.markRun(workflow);
    const result = await this.orchestrator.execute(plan);
    this.telemetry.finishTask(plan.requestId, result.status);

    // A replayed workflow answers too. "run dns" should report the servers,
    // not just that it ran — the whole point of saving a read as a workflow.
    const answer = await this.finish(request, result);

    return { ...result, answer, requestId: plan.requestId, workflow };
  }

  /**
   * Offer to save a task the owner keeps doing.
   *
   * Only for plans worth replaying — a single silent step is not a workflow,
   * it is a sentence — and only once the same shape has succeeded enough times
   * to be a habit rather than a coincidence.
   */
  private suggestion(
    text: string,
    plan: ExecutionPlan,
    status: TaskStatus,
  ): GatewayResult['suggestSave'] {
    if (status !== 'COMPLETED') return undefined;
    if (plan.steps.length < 1) return undefined;
    if (this.workflows.matchRequest(text)) return undefined;

    const times = this.telemetry.timesRepeated(text);
    return times >= Telemetry.SUGGEST_AFTER ? { text, times } : undefined;
  }

  /**
   * Save the task that just finished under a name.
   *
   * Only a freshly planned task is remembered, never a workflow run — saving a
   * replay would just clone an existing workflow under a second name.
   */
  saveLast(name: string, description?: string) {
    if (!this.lastPlanned) {
      throw new Error('Nothing to save yet — run a task first, then save it.');
    }
    return this.workflows.save({
      name,
      plan: this.lastPlanned.plan,
      requestText: this.lastPlanned.text,
      description,
    });
  }

  get lastSaveable(): { text: string; steps: number } | undefined {
    return this.lastPlanned
      ? { text: this.lastPlanned.text, steps: this.lastPlanned.plan.steps.length }
      : undefined;
  }

  /** Exposed so the CLI and UI can offer "save that as ...". */
  get workflowStore(): WorkflowStore {
    return this.workflows;
  }

  get telemetryStore(): Telemetry {
    return this.telemetry;
  }
}
