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
  /**
   * `learned` — saved automatically when a task succeeded.
   * `named`   — the owner asked for it by name and calls it by name.
   *
   * Named ones outrank learned ones in the list the Brain is shown, and are
   * never evicted by the cap. A name is a statement that this one matters.
   */
  origin: 'learned' | 'named';
  /** Replays that failed. See `markFailed`. */
  failCount: number;
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
    origin?: 'learned' | 'named';
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
      origin: input.origin ?? 'named',
      failCount: 0,
    };

    db()
      .prepare(
        `INSERT OR REPLACE INTO workflows
         (name, description, trigger_text, shape, params, plan, created_at,
          run_count, origin, fail_count)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT run_count FROM workflows WHERE name = ?), 0),
                 ?, 0)`,
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
        workflow.origin,
      );

    this.prune();
    return workflow;
  }

  get(name: string): Workflow | undefined {
    const row = db()
      .prepare('SELECT * FROM workflows WHERE name = ?')
      .get(name.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return row ? hydrate(row) : undefined;
  }

  list(): Workflow[] {
    // Named first, then by how often each has actually been useful. This is the
    // order the Brain is shown, so the ones that have earned their place are
    // the ones it sees first.
    return (db()
      .prepare(
        "SELECT * FROM workflows "
        + "ORDER BY (origin = 'named') DESC, run_count DESC, created_at DESC",
      )
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
      .prepare(
        'UPDATE workflows SET run_count = run_count + 1, last_run_at = ?, '
        + 'fail_count = 0 WHERE name = ?',
      )
      .run(Date.now(), name.trim().toLowerCase());
  }

  /**
   * A replay failed. Two failures in a row and the workflow is forgotten.
   *
   * This is what makes saving automatically safe to do. Without it, a plan that
   * happened to succeed once is remembered forever and replayed confidently
   * every time the request is re-said — and a saved plan is *more* dangerous
   * than a fresh one, because it skips the Brain entirely and nothing gets a
   * second look at it.
   *
   * Two rather than one: a workflow can fail for reasons that have nothing to
   * do with the plan — the daemon down, a site moved, the machine offline — and
   * throwing away good knowledge over one bad night is its own kind of wrong.
   * `markRun` resets the count, so it takes two failures with no success
   * between them.
   */
  markFailed(name: string): void {
    const key = name.trim().toLowerCase();
    db()
      .prepare('UPDATE workflows SET fail_count = fail_count + 1 WHERE name = ?')
      .run(key);

    const row = db()
      .prepare('SELECT fail_count, origin FROM workflows WHERE name = ?')
      .get(key) as { fail_count?: number; origin?: string } | undefined;

    // A named workflow is the owner's, not Dex's, and is never deleted out from
    // under them. The count is still recorded so the UI can say it is failing.
    if (row && row.origin === 'learned' && Number(row.fail_count ?? 0) >= 2) {
      this.delete(key);
    }
  }

  /**
   * Save a task that just worked, without being asked.
   *
   * Every completed task becomes a reusable script, so the next time the same
   * thing is asked it replays with new parameters and costs no model call at
   * all. That is the whole point of remembering: the second time should be
   * free. Before this, saving was reachable only from the CLI and only after
   * the identical request had succeeded three times, so almost nothing was ever
   * saved.
   *
   * Returns the workflow, or undefined when there is nothing worth saving.
   *
   * Deliberately quiet about failure. This runs after a task the owner already
   * considers finished; an error here must not turn a success into a failure,
   * and there is nothing they could do about it if it did.
   */
  autoSave(input: { plan: ExecutionPlan; requestText: string }): Workflow | undefined {
    try {
      const text = input.requestText.trim();
      if (!text || input.plan.steps.length === 0) return undefined;

      // Already known. Update it in place rather than growing a twin: the
      // parameters are re-derived from the same shape, so the newer plan wins.
      const { shape } = shapeOf(text);
      const existing = db()
        .prepare('SELECT name, origin FROM workflows WHERE shape = ?')
        .get(shape) as { name?: string; origin?: string } | undefined;

      // A workflow the owner named is theirs. Dex does not quietly rewrite it.
      if (existing?.origin === 'named') return undefined;

      const name = existing?.name ?? this.freeName(input.plan.intent || text);
      return this.save({
        name,
        plan: input.plan,
        requestText: text,
        description: input.plan.intent,
        origin: 'learned',
      });
    } catch {
      return undefined;
    }
  }

  /**
   * A slug from the intent, with a number appended if it is taken.
   *
   * The name matters less than it used to — nothing has to type it — but it is
   * what appears in the UI and what `run <name>` accepts, so it should read
   * like the task rather than like a hash.
   */
  private freeName(source: string): string {
    const base = source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 4)
      .join('-')
      .slice(0, 40) || 'task';

    if (!this.get(base)) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`.slice(0, 48);
      if (!this.get(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`.slice(0, 48);
  }

  /**
   * Keep the store from growing without bound.
   *
   * Learned workflows arrive on their own now, so something has to take them
   * away again. Least useful goes first — fewest runs, longest untouched — and
   * a workflow the owner named is never evicted, because naming it was them
   * saying it mattered.
   */
  private prune(limit = 200): void {
    db()
      .prepare(
        "DELETE FROM workflows WHERE name IN ("
        + "  SELECT name FROM workflows WHERE origin = 'learned'"
        + "  ORDER BY run_count DESC, COALESCE(last_run_at, created_at) DESC"
        + "  LIMIT -1 OFFSET ?)",
      )
      .run(limit);
  }

  /**
   * Give a learned workflow a name of the owner's choosing.
   *
   * Naming it also claims it: origin becomes `named`, so it outranks the
   * learned ones and the cap will never evict it.
   */
  rename(from: string, to: string): Workflow {
    const workflow = this.get(from);
    if (!workflow) throw new Error(`No workflow called "${from}"`);

    const name = to.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      throw new Error(
        `"${to}" is not a usable workflow name — use lowercase letters, digits, - or _`,
      );
    }
    if (name !== workflow.name && this.get(name)) {
      throw new Error(`"${name}" is already taken`);
    }

    db()
      .prepare("UPDATE workflows SET name = ?, origin = 'named' WHERE name = ?")
      .run(name, workflow.name);
    return { ...workflow, name, origin: 'named' };
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
    origin: row.origin === 'learned' ? 'learned' : 'named',
    failCount: Number(row.fail_count ?? 0),
  };
}
