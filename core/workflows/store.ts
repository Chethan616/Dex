import { randomUUID } from 'crypto';
import { ExecutionPlan, ExecutionStep, TaskStatus } from '../events/types';
import { db } from '../memory/db';
import { matchShape, nameParameters, shapeOf } from './shape';

/**
 * Saved workflows — reusable templates Dex worked out once, kept so it can
 * instantiate the same structure without planning it again.
 *
 * The value is not just speed. A workflow run uses the *exact steps that were
 * verified working*, while still creating a fresh execution instance:
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
  /** Where each parameter came from in the trigger shape. */
  bindings: WorkflowParameterBinding[];
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
  /** Template runs that failed. See `markFailed`. */
  failCount: number;
  /** False means legacy/execution-specific data was quarantined, never run. */
  reusable: boolean;
  invalidReason?: string;
}

export interface WorkflowParameterBinding {
  name: string;
  literalIndex: number;
  kind: string;
}

/** A reusable definition, deliberately separate from one run of that definition. */
export interface WorkflowTemplate {
  name: string;
  shape: string;
  triggerText: string;
  params: string[];
  bindings: WorkflowParameterBinding[];
  steps: ExecutionStep[];
}

/** Current parameters and current identifiers for one fresh workflow execution. */
export interface WorkflowExecutionInstance {
  executionId: string;
  requestId: string;
  taskId?: string;
  template: WorkflowTemplate;
  parameters: Record<string, string>;
  plan: ExecutionPlan;
}

/** Result data belongs to one execution, never to the reusable template. */
export interface WorkflowExecutionResult {
  executionId: string;
  requestId: string;
  taskId?: string;
  status: TaskStatus;
  summary: string;
  answer?: string;
  artifactIds?: string[];
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/**
 * Saved workflow replay is disabled until explicitly re-enabled.  A previous
 * successful browser run must never turn a later plain-language request into
 * an unrelated replay (for example, "open Instagram" becoming Sidemen's post).
 * Set DEX_ENABLE_SAVED_WORKFLOWS=1 only when the owner deliberately wants the
 * reusable-workflow feature back.
 */
export const SAVED_WORKFLOWS_ENABLED = /^(1|true|yes)$/i.test(
  process.env.DEX_ENABLE_SAVED_WORKFLOWS ?? '',
);

/** `{{level}}` — deliberately unlike anything a real parameter value contains. */
function placeholder(name: string): string {
  return `{{${name}}}`;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const ENTITY_INSTRUCTION_RE = /\b[a-z][a-z0-9._-]{1,63}['’]s\b/i;
const EXECUTION_ONLY_KEYS = new Set([
  'artifact', 'artifacts', 'artifact_id', 'artifact_ids',
  'browser_state', 'browserstate', 'current_page', 'current_url',
  'execution', 'execution_id', 'executionid', 'execution_result',
  'request_id', 'requestid', 'result', 'screenshot', 'screenshot_path',
  'task_id', 'taskid', 'verification', 'verification_result',
]);
const URL_KEYS = new Set(['url', 'start_url', 'expected_url', 'post_url']);

interface TemplateBuild {
  shape: string;
  params: string[];
  bindings: WorkflowParameterBinding[];
  template: ExecutionStep[];
  reusable: boolean;
  invalidReason?: string;
}

function keyName(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceText(value: string, literal: string, replacement: string, entity: boolean): string {
  if (!entity) return value.split(literal).join(replacement);
  const re = new RegExp(`(?<![a-z0-9])${escaped(literal)}(?![a-z0-9])`, 'gi');
  return value.replace(re, replacement);
}

function containsText(value: string, literal: string, entity: boolean): boolean {
  if (!entity) return value.toLowerCase() === literal.toLowerCase();
  return new RegExp(`(?<![a-z0-9])${escaped(literal)}(?![a-z0-9])`, 'i').test(value);
}

function requestUrls(text: string): Set<string> {
  return new Set((text.match(URL_RE) ?? []).map((url) => url.replace(/[),.;]+$/, '').toLowerCase()));
}

function entityLiterals(text: string): string[] {
  const shaped = shapeOf(text);
  return shaped.literals.filter((_, index) => shaped.kinds[index] === 'entity');
}

function sanitizeValue(
  value: unknown,
  key: string,
  explicitUrls: Set<string>,
  removed: { executionData: string[] },
): unknown {
  const normalizedKey = keyName(key);

  if (EXECUTION_ONLY_KEYS.has(normalizedKey)) {
    removed.executionData.push(key);
    return undefined;
  }

  if (URL_KEYS.has(normalizedKey) && typeof value === 'string') {
    const normalized = value.replace(/[),.;]+$/, '').toLowerCase();
    if (!explicitUrls.has(normalized)) {
      removed.executionData.push(`execution URL in ${key}`);
      return undefined;
    }
  }

  if (typeof value === 'string') {
    const urls = value.match(URL_RE) ?? [];
    if (urls.length === 0) return value;

    return value.replace(URL_RE, (url) => {
      const normalized = url.replace(/[),.;]+$/, '').toLowerCase();
      if (explicitUrls.has(normalized)) return url;
      // A discovered destination belongs to execution history. Keep the task
      // instruction, but never carry the old destination into a template.
      removed.executionData.push(`discovered URL in ${key}`);
      return '';
    });
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, key, explicitUrls, removed))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const clean = sanitizeValue(childValue, childKey, explicitUrls, removed);
      if (clean !== undefined) out[childKey] = clean;
    }
    return out;
  }

  return value;
}

function findBinding(
  template: ExecutionStep[],
  literal: string,
  kind: string,
): string | undefined {
  const entity = kind === 'entity';
  for (const step of template) {
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value === 'string' && containsText(value, literal, entity)) {
        return entity ? 'entity' : key;
      }
      if (!entity && String(value).toLowerCase() === literal.toLowerCase()) {
        return key;
      }
    }
  }
  return undefined;
}

function buildTemplate(requestText: string, steps: ExecutionStep[]): TemplateBuild {
  const shaped = shapeOf(requestText);
  const explicitUrls = requestUrls(requestText);
  const removed = { executionData: [] as string[] };
  const template = JSON.parse(JSON.stringify(steps)) as ExecutionStep[];

  for (const step of template) {
    const clean = sanitizeValue(step.params, 'params', explicitUrls, removed);
    step.params = (clean && typeof clean === 'object' ? clean : {}) as Record<string, unknown>;
  }

  const requestEntities = new Set(
    shaped.literals
      .filter((_, index) => shaped.kinds[index] === 'entity')
      .map((entity) => entity.toLowerCase()),
  );
  const hasUnparameterizedEntityInstruction = template.some((step) =>
    Object.values(step.params).some((value) => {
      if (typeof value !== 'string' || !ENTITY_INSTRUCTION_RE.test(value)) return false;
      return entityLiterals(value).some((entity) => !requestEntities.has(entity.toLowerCase()));
    }),
  );

  const preferred = shaped.literals.map((literal, i) =>
    findBinding(template, literal, shaped.kinds[i])
  );
  const names = nameParameters(shaped.literals, preferred);
  const params: string[] = [];
  const bindings: WorkflowParameterBinding[] = [];

  shaped.literals.forEach((literal, i) => {
    const binding = preferred[i];
    if (binding === undefined) return;
    const name = names[i];
    params.push(name);
    bindings.push({ name, literalIndex: i, kind: shaped.kinds[i] });
    for (const step of template) {
      for (const [key, value] of Object.entries(step.params)) {
        if (typeof value === 'string') {
          if (containsText(value, literal, shaped.kinds[i] === 'entity')) {
            step.params[key] = replaceText(value, literal, placeholder(name), shaped.kinds[i] === 'entity');
          }
        } else if (String(value).toLowerCase() === literal.toLowerCase()) {
          step.params[key] = placeholder(name);
        }
      }
    }
  });

  const emptyStep = template.some((step) => {
    const task = step.params.task;
    return typeof task === 'string' && task.trim().length === 0;
  });
  const reusable = !emptyStep && template.length > 0 && !hasUnparameterizedEntityInstruction;
  const invalidReason = reusable
    ? undefined
    : hasUnparameterizedEntityInstruction
      ? 'browser template contains a concrete entity with no parameter'
      : 'execution-specific template data left no reusable instruction';

  return { shape: shaped.shape, params, bindings, template, reusable, invalidReason };
}

function templateIsSafe(workflow: Workflow): boolean {
  if (!workflow.reusable) return false;
  const explicitUrls = requestUrls(workflow.triggerText);
  const requestEntities = new Set(entityLiterals(workflow.triggerText).map((entity) => entity.toLowerCase()));

  const visit = (value: unknown, key: string): boolean => {
    const normalizedKey = keyName(key);
    if (EXECUTION_ONLY_KEYS.has(normalizedKey)) return false;
    if (typeof value === 'string') {
      for (const url of value.match(URL_RE) ?? []) {
        const normalized = url.replace(/[),.;]+$/, '').toLowerCase();
        if (!explicitUrls.has(normalized)) return false;
      }
      if (entityLiterals(value).some((entity) => !requestEntities.has(entity.toLowerCase()))) {
        return false;
      }
      return true;
    }
    if (Array.isArray(value)) return value.every((item) => visit(item, key));
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .every(([childKey, childValue]) => visit(childValue, childKey));
    }
    return true;
  };

  return workflow.template.every((step) => visit(step.params, 'params'));
}

export class WorkflowStore {
  constructor() {
    if (!SAVED_WORKFLOWS_ENABLED) return;
    // Existing installs predate the template/execution split. Repair in place
    // so valid structure survives, while execution-specific rows are quarantined
    // instead of being silently replayed.
    this.repairLegacyWorkflows();
  }

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
    if (!SAVED_WORKFLOWS_ENABLED) {
      throw new Error('Saved workflows are disabled; each request is planned and executed fresh.');
    }
    const name = input.name.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      throw new Error(
        `"${input.name}" is not a usable workflow name — use lowercase letters, digits, - or _`,
      );
    }

    const built = buildTemplate(input.requestText, input.plan.steps);

    const workflow: Workflow = {
      name,
      description: input.description ?? input.plan.intent,
      triggerText: input.requestText.trim(),
      shape: built.shape,
      params: built.params,
      bindings: built.bindings,
      template: built.template,
      createdAt: Date.now(),
      runCount: 0,
      origin: input.origin ?? 'named',
      failCount: 0,
      reusable: built.reusable,
      invalidReason: built.invalidReason,
    };

    db()
      .prepare(
        `INSERT OR REPLACE INTO workflows
         (name, description, trigger_text, shape, params, bindings, plan, created_at,
          run_count, origin, fail_count, reusable, invalid_reason, template_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT run_count FROM workflows WHERE name = ?), 0),
                 ?, 0, ?, ?, 2)`,
      )
      .run(
        workflow.name,
        workflow.description,
        workflow.triggerText,
        workflow.shape,
        JSON.stringify(workflow.params),
        JSON.stringify(workflow.bindings),
        JSON.stringify(workflow.template),
        workflow.createdAt,
        workflow.name,
        workflow.origin,
        workflow.reusable ? 1 : 0,
        workflow.invalidReason ?? null,
      );

    this.prune();
    return workflow;
  }

  get(name: string): Workflow | undefined {
    if (!SAVED_WORKFLOWS_ENABLED) return undefined;
    const row = db()
      .prepare('SELECT * FROM workflows WHERE name = ?')
      .get(name.trim().toLowerCase()) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const workflow = hydrate(row);
    return templateIsSafe(workflow)
      ? workflow
      : { ...workflow, reusable: false, invalidReason: workflow.invalidReason ?? 'unsafe template data' };
  }

  list(): Workflow[] {
    if (!SAVED_WORKFLOWS_ENABLED) return [];
    // Named first, then by how often each has actually been useful. This is the
    // order the Brain is shown, so the ones that have earned their place are
    // the ones it sees first.
    return (db()
      .prepare(
        "SELECT * FROM workflows "
        + "ORDER BY (origin = 'named') DESC, run_count DESC, created_at DESC",
      )
      .all() as Array<Record<string, unknown>>)
      .map(hydrate)
      .filter((workflow) => templateIsSafe(workflow));
  }

  delete(name: string): boolean {
    return (
      db().prepare('DELETE FROM workflows WHERE name = ?').run(name.trim().toLowerCase())
        .changes > 0
    );
  }

  /**
   * Rebuild a legacy row with current template rules. This is deliberately
   * additive: the old row is never deleted, and a row that cannot be made safe
   * is kept for inspection but marked non-reusable.
   */
  private repairLegacyWorkflows(): void {
    const rows = db()
      .prepare('SELECT * FROM workflows')
      .all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      if (Number(row.template_version ?? 1) >= 2) continue;
      let steps: ExecutionStep[];
      try {
        steps = JSON.parse(String(row.plan)) as ExecutionStep[];
        if (!Array.isArray(steps)) throw new Error('plan is not an array');
      } catch {
        db()
          .prepare('UPDATE workflows SET reusable = 0, invalid_reason = ?, template_version = 2 WHERE name = ?')
          .run('malformed workflow template', String(row.name));
        continue;
      }

      const built = buildTemplate(String(row.trigger_text ?? ''), steps);
      const nextParams = JSON.stringify(built.params);
      const nextBindings = JSON.stringify(built.bindings);
      const nextPlan = JSON.stringify(built.template);
      const nextShape = built.shape;
      const oldBindings = row.bindings == null ? '[]' : String(row.bindings);
      const reusable = built.reusable ? 1 : 0;
      const reason = built.invalidReason ?? null;

      if (
        String(row.shape ?? '') !== nextShape ||
        String(row.params ?? '') !== nextParams ||
        oldBindings !== nextBindings ||
        String(row.plan ?? '') !== nextPlan ||
        Number(row.reusable ?? 1) !== reusable ||
        Number(row.template_version ?? 1) !== 2 ||
        (row.invalid_reason == null ? null : String(row.invalid_reason)) !== reason
      ) {
        db()
          .prepare(
            `UPDATE workflows
             SET shape = ?, params = ?, bindings = ?, plan = ?, reusable = ?, invalid_reason = ?, template_version = 2
             WHERE name = ?`,
          )
          .run(nextShape, nextParams, nextBindings, nextPlan, reusable, reason, String(row.name));
      }
    }
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
   * A template run failed. Two failures in a row and the workflow is forgotten.
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
   * thing is asked it instantiates with new parameters and costs no model call
   * at all. That is the whole point of remembering: the second time should be
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
    if (!SAVED_WORKFLOWS_ENABLED) return undefined;
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
      const learned = this.save({
        name,
        plan: input.plan,
        requestText: text,
        description: input.plan.intent,
        origin: 'learned',
      });
      return learned.reusable ? learned : undefined;
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
   * The zero-cost path: does this request match a reusable template?
   *
   * Shape equality only — no fuzzy matching. Running the wrong saved workflow
   * with the owner's numbers substituted in is a far worse outcome than falling
   * through to the Brain and paying for one call.
   */
  matchRequest(text: string): { workflow: Workflow; args: Record<string, string> } | undefined {
    if (!SAVED_WORKFLOWS_ENABLED) return undefined;
    for (const workflow of this.list()) {
      const literals = matchShape(text, workflow.shape);
      if (!literals) continue;

      const args: Record<string, string> = {};
      const bindings = workflow.bindings.length > 0
        ? workflow.bindings
        : workflow.params.map((name, literalIndex) => ({ name, literalIndex, kind: 'legacy' }));
      for (const binding of bindings) {
        if (literals[binding.literalIndex] === undefined) continue;
        args[binding.name] = literals[binding.literalIndex];
      }

      if (Object.keys(args).length === workflow.params.length && workflow.reusable) {
        return { workflow, args };
      }
    }
    return undefined;
  }

  /** Fill a template's placeholders. Missing arguments are reported, not guessed. */
  bind(workflow: Workflow, args: Record<string, string>, requestId: string, taskId?: string): ExecutionPlan {
    if (!workflow.reusable) {
      throw new Error(
        `Workflow "${workflow.name}" is not reusable: ${workflow.invalidReason ?? 'unsafe template data'}`,
      );
    }
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
    // reusing it verbatim reads as a lie: instantiating at 55 while announcing
    // "set volume to 35 percent" is worse than saying less. State the workflow
    // and the arguments actually in use.
    const shown = workflow.params.map((p) => `${p}=${args[p]}`).join(', ');

    return {
      requestId,
      taskId,
      intent: shown ? `${workflow.name} (${shown})` : workflow.name,
      tier: 2,
      steps,
    };
  }

  /** Instantiate a template into a fresh execution instance. */
  instantiate(
    workflow: Workflow,
    args: Record<string, string>,
    requestId: string,
    taskId?: string,
  ): WorkflowExecutionInstance {
    const plan = this.bind(workflow, args, requestId, taskId);
    const template: WorkflowTemplate = {
      name: workflow.name,
      shape: workflow.shape,
      triggerText: workflow.triggerText,
      params: [...workflow.params],
      bindings: workflow.bindings.map((binding) => ({ ...binding })),
      steps: JSON.parse(JSON.stringify(workflow.template)) as ExecutionStep[],
    };
    return {
      executionId: randomUUID(),
      requestId,
      taskId,
      template,
      parameters: { ...args },
      plan,
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
  let bindings: WorkflowParameterBinding[] = [];
  let params: string[] = [];
  let template: ExecutionStep[] = [];
  let validJson = true;
  try {
    bindings = row.bindings == null ? [] : JSON.parse(String(row.bindings)) as WorkflowParameterBinding[];
    if (!Array.isArray(bindings)) {
      bindings = [];
      validJson = false;
    }
  } catch {
    bindings = [];
    validJson = false;
  }
  try {
    params = JSON.parse(String(row.params)) as string[];
    template = JSON.parse(String(row.plan)) as ExecutionStep[];
    if (!Array.isArray(params) || !Array.isArray(template)) validJson = false;
  } catch {
    params = [];
    template = [];
    validJson = false;
  }
  return {
    name: String(row.name),
    description: String(row.description ?? ''),
    triggerText: String(row.trigger_text),
    shape: String(row.shape),
    params,
    bindings,
    template,
    createdAt: Number(row.created_at),
    lastRunAt: row.last_run_at == null ? undefined : Number(row.last_run_at),
    runCount: Number(row.run_count ?? 0),
    origin: row.origin === 'learned' ? 'learned' : 'named',
    failCount: Number(row.fail_count ?? 0),
    reusable: validJson && Number(row.reusable ?? 1) !== 0,
    invalidReason: validJson
      ? (row.invalid_reason == null ? undefined : String(row.invalid_reason))
      : 'malformed workflow JSON',
  };
}
