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

  async handle(
    source: DexRequest['source'],
    senderId: string,
    text: string,
  ): Promise<GatewayResult> {
    const requestId = randomUUID();
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
    this.telemetry.planned(requestId, finalPlan);
    const result = await this.orchestrator.execute(finalPlan);
    this.telemetry.finishTask(requestId, result.status);

    if (result.status === 'COMPLETED') {
      this.lastPlanned = { plan: finalPlan, text: request.text };
      // Only successful plans are cached. Serving a known-broken plan faster is
      // not an optimisation.
      void this.cache.remember(request.text, finalPlan);
    }

    return {
      ...result,
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
    this.telemetry.planned(plan.requestId, plan);

    if (workflow) this.workflows.markRun(workflow);
    const result = await this.orchestrator.execute(plan);
    this.telemetry.finishTask(plan.requestId, result.status);

    return { ...result, requestId: plan.requestId, workflow };
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
