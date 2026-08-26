import { randomUUID } from 'crypto';
import { DexRequest, ExecutionPlan, TaskStatus } from './events/types';
import { OwnerGate } from './owner_gate';
import { Brain } from './brain/planner';
import { Orchestrator } from './orchestrator/orchestrator';
import { Telemetry } from './memory/telemetry';
import { WorkflowStore } from './workflows/store';
import { emit } from './events/bus';

export interface GatewayResult {
  status: TaskStatus;
  summary: string;
  requestId: string;
  /** Set when the task ran from a saved workflow instead of a fresh plan. */
  workflow?: string;
  /** Set when this task looks worth saving — the UI and CLI offer it. */
  suggestSave?: { text: string; times: number };
}

export class Gateway {
  private sessionMap = new Map<string, string>();

  /** The last freshly planned task, so it can be saved as a workflow. */
  private lastPlanned?: { plan: ExecutionPlan; text: string };

  constructor(
    private ownerGate: OwnerGate,
    private brain: Brain,
    private orchestrator: Orchestrator,
    private telemetry = new Telemetry(),
    private workflows = new WorkflowStore(),
  ) {}

  async handle(
    source: DexRequest['source'],
    senderId: string,
    text: string,
  ): Promise<GatewayResult> {
    const requestId = randomUUID();
    const sessionId = this.sessionMap.get(senderId) ?? randomUUID();
    this.sessionMap.set(senderId, sessionId);

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

    // ── the free path ─────────────────────────────────────────────────────
    // An explicit `run <name>`, or a phrase that re-says something already
    // saved. Either way the steps are already known to work, so there is
    // nothing for the Brain to decide.
    const direct = this.resolveWorkflow(request.text);
    if (direct) {
      return this.runPlan(request, direct.plan, direct.name);
    }

    this.telemetry.startTask({
      requestId,
      sessionId,
      source,
      text: request.text,
      provider: this.brain.model,
    });

    let plan: ExecutionPlan;
    try {
      plan = await this.brain.plan(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('failed', `Planning error: ${msg}`, requestId);
      this.telemetry.finishTask(requestId, 'FAILED');
      return { status: 'FAILED', summary: msg, requestId };
    }

    this.telemetry.planned(requestId, plan);
    const result = await this.orchestrator.execute(plan);
    this.telemetry.finishTask(requestId, result.status);

    if (result.status === 'COMPLETED') {
      this.lastPlanned = { plan, text: request.text };
    }

    return {
      ...result,
      requestId,
      suggestSave: this.suggestion(request.text, plan, result.status),
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

  private async runPlan(
    request: DexRequest,
    plan: ExecutionPlan,
    workflow: string,
  ): Promise<GatewayResult> {
    emit('routing', `Saved workflow "${workflow}" — no planning needed`, plan.requestId);

    this.telemetry.startTask({
      requestId: plan.requestId,
      sessionId: request.sessionId,
      source: request.source,
      text: request.text,
      workflow,
    });
    this.telemetry.planned(plan.requestId, plan);

    this.workflows.markRun(workflow);
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
