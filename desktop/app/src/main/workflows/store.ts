/**
 * The user's workflows (shared/workflows.ts), kept in
 * `<userData>/workflows.json`. One file, read once and written whole on each
 * change (through a temp file, so a crash mid-write never leaves half a
 * file): there are at most fifty and they change when the user says so.
 *
 * The agent reaches this through `dex-workflow` and the control server; the
 * hub through IPC (View, Run now); the scheduler to see what's due.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MAX_WORKFLOWS, WorkflowSchema, parseWorkflowInput, parseWorkflowPatch,
  type Workflow,
} from '../../shared/workflows';

interface FileShape { version: 1; workflows: unknown[] }

export class WorkflowStore {
  private items: Workflow[] | null = null;

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  private load(): Workflow[] {
    if (this.items) return this.items;
    let raw: FileShape | null = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as FileShape; } catch { /* none yet, or unreadable */ }
    // One bad entry (an edit by hand) mustn't lose the others.
    this.items = (Array.isArray(raw?.workflows) ? raw.workflows : [])
      .map((w) => WorkflowSchema.safeParse(w))
      .filter((r) => r.success)
      .map((r) => r.data as Workflow);
    return this.items;
  }

  private save(): void {
    const body: FileShape = { version: 1, workflows: this.load() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list(): Workflow[] {
    return this.load().map((w) => ({ ...w }));
  }

  get(id: string): Workflow | null {
    const w = this.load().find((x) => x.id === id);
    return w ? { ...w } : null;
  }

  /**
   * A workflow by id, or by name the way people say it: exact (any case),
   * then the only one that starts with it, then the only one containing it.
   */
  find(ref: string): { workflow: Workflow | null; error: string | null } {
    const all = this.load();
    const q = ref.trim().toLowerCase();
    if (!q) return { workflow: null, error: 'Say which workflow: its name or id.' };
    const byId = all.find((w) => w.id === ref.trim());
    if (byId) return { workflow: { ...byId }, error: null };
    const exact = all.filter((w) => w.name.toLowerCase() === q);
    if (exact.length === 1) return { workflow: { ...exact[0] }, error: null };
    for (const pick of [(w: Workflow) => w.name.toLowerCase().startsWith(q), (w: Workflow) => w.name.toLowerCase().includes(q)]) {
      const hits = all.filter(pick);
      if (hits.length === 1) return { workflow: { ...hits[0] }, error: null };
      if (hits.length > 1) return { workflow: null, error: `“${ref}” could be ${hits.map((w) => `“${w.name}”`).join(' or ')}. Use the id.` };
    }
    return { workflow: null, error: `No workflow is called “${ref}”.${all.length ? ` There are: ${all.map((w) => `“${w.name}”`).join(', ')}.` : ' There are none yet.'}` };
  }

  create(raw: unknown, made?: { engine?: string; model?: string }): { workflow: Workflow | null; error: string | null } {
    const { input, error } = parseWorkflowInput(raw);
    if (!input) return { workflow: null, error };
    const all = this.load();
    if (all.length >= MAX_WORKFLOWS) return { workflow: null, error: `There are already ${MAX_WORKFLOWS} workflows. Delete one first.` };
    if (all.some((w) => w.name.toLowerCase() === input.name.toLowerCase())) {
      return { workflow: null, error: `A workflow called “${input.name}” already exists. Update it, or pick another name.` };
    }
    const at = this.now();
    const workflow: Workflow = {
      id: `wf_${crypto.randomBytes(5).toString('hex')}`, ...input, createdAt: at, updatedAt: at,
      ...(made?.engine ? { engine: made.engine } : {}), ...(made?.model ? { model: made.model } : {}),
    };
    all.push(workflow);
    this.save();
    return { workflow: { ...workflow }, error: null };
  }

  update(id: string, raw: unknown): { workflow: Workflow | null; error: string | null } {
    const all = this.load();
    const i = all.findIndex((w) => w.id === id);
    if (i < 0) return { workflow: null, error: 'That workflow is gone.' };
    const { patch, error } = parseWorkflowPatch(raw);
    if (!patch) return { workflow: null, error };
    if (patch.name && all.some((w, j) => j !== i && w.name.toLowerCase() === patch.name!.toLowerCase())) {
      return { workflow: null, error: `Another workflow is already called “${patch.name}”.` };
    }
    const next: Workflow = { ...all[i], ...patch, updatedAt: this.now() };
    const checked = WorkflowSchema.safeParse(next);
    if (!checked.success) return { workflow: null, error: checked.error.issues[0]?.message ?? 'That change doesn’t fit.' };
    all[i] = checked.data as Workflow;
    this.save();
    return { workflow: { ...all[i] }, error: null };
  }

  remove(id: string): boolean {
    const all = this.load();
    const i = all.findIndex((w) => w.id === id);
    if (i < 0) return false;
    all.splice(i, 1);
    this.save();
    return true;
  }

  /** A run started. Not an edit: `updatedAt` stays, so it doesn't count as "changed since". */
  recordRun(id: string, run: NonNullable<Workflow['lastRun']>): void {
    const w = this.load().find((x) => x.id === id);
    if (!w) return;
    w.lastRun = run;
    this.save();
  }
}
