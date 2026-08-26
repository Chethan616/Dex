import { ExecutionPlan, ExecutionStep } from '../events/types';
import { emit } from '../events/bus';
import { WorkflowStore } from './store';

/**
 * Turning a plan's `run_workflow` steps into the real steps they stand for.
 *
 * Shape matching (see shape.ts) only fires when the owner phrases a request the
 * same way twice. "sound increase", "make it louder" and "bump the volume" are
 * the same intent as "set volume to 30" and match none of it — so the Brain is
 * shown the saved workflows as tools it can call, and it does the understanding
 * that string comparison cannot.
 *
 * The Brain does NOT get to invent the steps. It picks a workflow and supplies
 * arguments; the steps come from what was already verified working. That split
 * is the point: language understanding where it is needed, and no model in the
 * path of what actually runs.
 *
 * Expansion happens before execution, so the workflow's steps carry their own
 * confirmation tiers and are verified exactly as if they had been planned
 * directly. There is no second execution path to keep in sync.
 */

export const RUN_WORKFLOW = 'run_workflow';
export const WORKFLOW_CAPABILITY = 'can_run_workflow';

/** A workflow calling a workflow calling a workflow is a loop waiting to happen. */
const MAX_DEPTH = 3;

export function expandWorkflows(
  plan: ExecutionPlan,
  store: WorkflowStore,
  depth = 0,
): { plan: ExecutionPlan; expanded: string[] } {
  const hasWorkflowStep = plan.steps.some((s) => s.capability === WORKFLOW_CAPABILITY);
  if (!hasWorkflowStep) return { plan, expanded: [] };

  if (depth >= MAX_DEPTH) {
    emit(
      'failed',
      `Workflow nesting is too deep (${MAX_DEPTH}) — refusing to expand further`,
      plan.requestId,
    );
    return { plan, expanded: [] };
  }

  const expanded: string[] = [];
  const steps: ExecutionStep[] = [];

  // A step that depended on the workflow step must now depend on the last step
  // the workflow expanded into, or it would start before the workflow finished.
  const rewrite = new Map<string, string>();

  for (const step of plan.steps) {
    if (step.capability !== WORKFLOW_CAPABILITY) {
      steps.push(step);
      continue;
    }

    // The workflow's name is the action, so a plan reads `can_run_workflow:vol`
    // in the step stream rather than an opaque identifier.
    const name = String(step.params.workflow ?? step.action ?? '');
    const workflow = store.get(name);

    if (!workflow) {
      emit(
        'failed',
        `Plan referenced workflow "${name}", which no longer exists`,
        plan.requestId,
        step.id,
      );
      // Keep the step so the Orchestrator fails it visibly, rather than
      // silently dropping something the owner asked for.
      steps.push(step);
      continue;
    }

    const args: Record<string, string> = {};
    for (const param of workflow.params) {
      const supplied = step.params[param] ?? (step.params.args as Record<string, unknown>)?.[param];
      if (supplied !== undefined) args[param] = String(supplied);
    }

    let bound: ExecutionPlan;
    try {
      bound = store.bind(workflow, args, plan.requestId);
    } catch (err) {
      emit(
        'failed',
        err instanceof Error ? err.message : String(err),
        plan.requestId,
        step.id,
      );
      steps.push(step);
      continue;
    }

    // Namespace the ids. Two workflows in one plan, or a workflow beside a
    // hand-written step, would otherwise collide on `step_1`.
    const inner = bound.steps.map((s) => ({
      ...s,
      id: `${step.id}_${s.id}`,
      dependsOn: s.dependsOn.map((d) => `${step.id}_${d}`),
    }));

    // The workflow as a whole inherits the dependencies of the step it replaces.
    if (inner.length > 0) {
      inner[0] = { ...inner[0], dependsOn: [...step.dependsOn, ...inner[0].dependsOn] };
      rewrite.set(step.id, inner[inner.length - 1].id);
    }

    steps.push(...inner);
    expanded.push(workflow.name);
    store.markRun(workflow.name);
  }

  const rewired = steps.map((s) => ({
    ...s,
    dependsOn: s.dependsOn.map((d) => rewrite.get(d) ?? d),
  }));

  const next: ExecutionPlan = { ...plan, steps: rewired };

  // A workflow may itself contain a run_workflow step. Bounded by MAX_DEPTH.
  const deeper = expandWorkflows(next, store, depth + 1);
  return { plan: deeper.plan, expanded: [...expanded, ...deeper.expanded] };
}
