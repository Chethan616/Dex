import { ExecutionPlan, ExecutionStep } from '../events/types';
import { db } from '../memory/db';
import { matchShape, nameParameters, shapeOf } from './shape';

/**
 * Saved workflows — a plan Dex worked out once, kept so it never has to work it
 * out again.
 *
 * The value is not just speed. A replayed workflow runs the *exact steps that
 * were verified working*, so it cannot drift the way a fresh planning call can:
 * no chance of a different capability being chosen, a tier being mislabelled,
 * or a model having an off day. Re-planning a solved problem is a chance to get
 * it wrong.
 *
 * Values the owner varied become parameters, so one saved workflow covers
 * "set volume to 30" and "set volume to 80" rather than needing two.
 */

export interface Workflow {
  name: string;
  description: string;
  /** What the owner said the first time — shown in the UI and used to re-match. */
  triggerText: string;
  shape: string;
  params: string[];
  /** The plan with parameter placeholders in place of the varying values. */
  template: ExecutionStep[];
  createdAt: number;
  lastRunAt?: number;
  runCount: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** `{{level}}` — deliberately unlike anything a real parameter value contains. */
function placeholder(name: string): string {
  return `{{${name}}}`;
}

export class WorkflowStore {
  /**
   * Turn a completed plan into a reusable template.
   *
   * Parameters are found by looking for the request's literals inside the
   * plan's own step parameters. If the owner said "set volume to 30" and the
   * plan contains `{ level: 30 }`, then 30 is a value they chose rather than
   * one Dex derived, and it becomes `{{level}}`. A literal that appears nowhere
   * in the plan is left alone — it was phrasing, not data.
   */
  save(input: {
    name: string;
    plan: ExecutionPlan;
    requestText: string;
    description?: string;
  }): Workflow {
    const name = input.name.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      throw new Error(
        `"${input.name}" is not a usable workflow name — use lowercase letters, digits, - or _`,
      );
    }

    const { shape, literals } = shapeOf(input.requestText);
    const bindings: Array<string | undefined> = [];
    const template: ExecutionStep[] = JSON.parse(JSON.stringify(input.plan.steps));

    // Which step parameter did each literal fill? That name becomes the
    // parameter name, because it is the one the owner will recognise.
    for (const literal of literals) {
      let boundTo: string | undefined;
      for (const step of template) {
        for (const [key, value] of Object.entries(step.params)) {
          if (String(value).toLowerCase() === literal.toLowerCase()) {
            boundTo = key;
            break;
          }
        }
        if (boundTo) break;
      }
      bindings.push(boundTo);
    }

    const names = nameParameters(literals, bindings);
    const params: string[] = [];

    literals.forEach((literal, i) => {
      if (bindings[i] === undefined) return;   // phrasing, not data
      const paramName = names[i];
      params.push(paramName);
      for (const step of template) {
        for (const [key, value] of Object.entries(step.params)) {
          if (String(value).toLowerCase() === literal.toLowerCase()) {
            step.params[key] = placeholder(paramName);
          }
        }
      }
    });

    const workflow: Workflow = {
      name,
      description: input.description ?? input.plan.intent,
      triggerText: input.requestText.trim(),
      shape,
      params,
      template,
      createdAt: Date.now(),
      runCount: 0,
    };

    db()
      .prepare(
        `INSERT OR REPLACE INTO workflows
         (name, description, trigger_text, shape, params, plan, created_at, run_count)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT run_count FROM workflows WHERE name = ?), 0))`,
      )
      .run(
        workflow.name,
        workflow.description,
        workflow.triggerText,
        workflow.shape,
        JSON.stringify(workflow.params),
        JSON.stringify(workflow.template),
        workflow.createdAt,
        workflow.name,
      );

    return workflow;
  }

  get(name: string): Workflow | undefined {
    const row = db()
      .prepare('SELECT * FROM workflows WHERE name = ?')
      .get(name.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return row ? hydrate(row) : undefined;
  }

  list(): Workflow[] {
    return (db()
      .prepare('SELECT * FROM workflows ORDER BY run_count DESC, created_at DESC')
      .all() as Array<Record<string, unknown>>).map(hydrate);
  }

  delete(name: string): boolean {
    return (
      db().prepare('DELETE FROM workflows WHERE name = ?').run(name.trim().toLowerCase())
        .changes > 0
    );
  }

  markRun(name: string): void {
    db()
      .prepare('UPDATE workflows SET run_count = run_count + 1, last_run_at = ? WHERE name = ?')
      .run(Date.now(), name.trim().toLowerCase());
  }

  /**
   * The zero-cost path: does this request re-say something already saved?
   *
   * Shape equality only — no fuzzy matching. Running the wrong saved workflow
   * with the owner's numbers substituted in is a far worse outcome than falling
   * through to the Brain and paying for one call.
   */
  matchRequest(text: string): { workflow: Workflow; args: Record<string, string> } | undefined {
    for (const workflow of this.list()) {
      const literals = matchShape(text, workflow.shape);
      if (!literals) continue;

      // Re-derive which literals are parameters using the saved order.
      const { literals: savedLiterals } = shapeOf(workflow.triggerText);
      if (literals.length !== savedLiterals.length) continue;

      const args: Record<string, string> = {};
      let cursor = 0;
      savedLiterals.forEach((_, i) => {
        if (cursor >= workflow.params.length) return;
        // Parameters were pushed in literal order, skipping non-data literals.
        args[workflow.params[cursor]] = literals[i];
        cursor += 1;
      });

      if (Object.keys(args).length === workflow.params.length) {
        return { workflow, args };
      }
    }
    return undefined;
  }

  /** Fill a template's placeholders. Missing arguments are reported, not guessed. */
  bind(workflow: Workflow, args: Record<string, string>, requestId: string): ExecutionPlan {
    const missing = workflow.params.filter((p) => args[p] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `"${workflow.name}" needs ${missing.join(', ')} — try: run ${workflow.name} ` +
          workflow.params.map((p) => `<${p}>`).join(' '),
      );
    }

    const steps: ExecutionStep[] = JSON.parse(JSON.stringify(workflow.template));
    for (const step of steps) {
      for (const [key, value] of Object.entries(step.params)) {
        if (typeof value !== 'string') continue;
        let filled = value;
        for (const [param, given] of Object.entries(args)) {
          filled = filled.split(placeholder(param)).join(given);
        }
        // Restore numbers that were numbers before templating, so a handler
        // expecting `level: 30` does not receive the string "30".
        step.params[key] = /^-?\d+(\.\d+)?$/.test(filled) ? Number(filled) : filled;
      }
    }

    // The saved description was written for the values it was saved with, so
    // reusing it verbatim reads as a lie: replaying at 55 while announcing
    // "set volume to 35 percent" is worse than saying less. State the workflow
    // and the arguments actually in use.
    const shown = workflow.params.map((p) => `${p}=${args[p]}`).join(', ');

    return {
      requestId,
      intent: shown ? `${workflow.name} (${shown})` : workflow.name,
      tier: 2,
      steps,
    };
  }

  /** Positional arguments from `run <name> 30 1.1.1.1`. */
  bindPositional(workflow: Workflow, values: string[]): Record<string, string> {
    const args: Record<string, string> = {};
    workflow.params.forEach((param, i) => {
      if (values[i] !== undefined) args[param] = values[i];
    });
    return args;
  }
}

function hydrate(row: Record<string, unknown>): Workflow {
  return {
    name: String(row.name),
    description: String(row.description ?? ''),
    triggerText: String(row.trigger_text),
    shape: String(row.shape),
    params: JSON.parse(String(row.params)) as string[],
    template: JSON.parse(String(row.plan)) as ExecutionStep[],
    createdAt: Number(row.created_at),
    lastRunAt: row.last_run_at == null ? undefined : Number(row.last_run_at),
    runCount: Number(row.run_count ?? 0),
  };
}
