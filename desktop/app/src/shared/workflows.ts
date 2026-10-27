/**
 * Workflows and daily routines: a named list of steps DEX runs on its own,
 * when the user asks ("run my morning routine") or on a schedule ("every
 * weekday at 7:30").
 *
 * The user makes and edits them in plain words; the agent turns that into a
 * spec with `dex-workflow` (dex-tools/workflows.md). Main keeps them in
 * `<userData>/workflows.json` and starts a task for each run. `/workflow`
 * shows them in the chat as cards (the widget kit's `workflows` type), and
 * View opens the graph (hub/workflows/WorkflowGraph.tsx, and the phone's).
 *
 * Steps run in order: one line of nodes, the trigger first. Branches were
 * left out on purpose — a routine that needs a decision says so in a step
 * and the agent decides (or asks, with an `ask` step).
 */
import { z } from 'zod';

export const STEP_KINDS = ['task', 'app', 'web', 'pc', 'notify', 'wait', 'ask'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'times are HH:MM, 24-hour');

export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('daily'), time: HHMM }),
  z.object({ kind: z.literal('weekly'), days: z.array(z.enum(WEEKDAYS)).min(1).max(7), time: HHMM }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const StepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][\w-]{0,23}$/),
  kind: z.enum(STEP_KINDS),
  title: text(80),
  /** One line under the title in the graph: what exactly, where. */
  detail: text(200).optional(),
  /** The instruction the agent gets for this step, when the title isn't enough. */
  prompt: text(1000).optional(),
});
export type WorkflowStep = z.infer<typeof StepSchema>;

export const MAX_STEPS = 20;
export const MAX_WORKFLOWS = 50;

export const WorkflowSchema = z.object({
  id: z.string().regex(/^wf_[a-z0-9]{4,24}$/),
  name: text(60),
  description: text(240).optional(),
  trigger: TriggerSchema,
  steps: z.array(StepSchema).min(1).max(MAX_STEPS),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRun: z.object({ at: z.number(), sessionId: z.string().max(100).optional(), by: z.enum(['schedule', 'user']) }).optional(),
  /** The engine and model of the task it was made in: its runs use the same. */
  engine: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

/* ── Reading what agents write ──────────────────────────────────────── */

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const firstOf = (o: Loose, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');

const DAY_WORDS: Record<string, Weekday[]> = {
  mon: ['mon'], monday: ['mon'], tue: ['tue'], tues: ['tue'], tuesday: ['tue'], wed: ['wed'], wednesday: ['wed'],
  thu: ['thu'], thur: ['thu'], thurs: ['thu'], thursday: ['thu'], fri: ['fri'], friday: ['fri'], sat: ['sat'], saturday: ['sat'],
  sun: ['sun'], sunday: ['sun'],
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weekday: ['mon', 'tue', 'wed', 'thu', 'fri'], weekends: ['sat', 'sun'], weekend: ['sat', 'sun'],
};

const KIND_WORDS: Record<string, StepKind> = {
  task: 'task', agent: 'task', do: 'task', action: 'task', step: 'task',
  app: 'app', apps: 'app', open: 'app', launch: 'app', desktop: 'app', windows: 'app',
  web: 'web', browser: 'web', browse: 'web', site: 'web', website: 'web', url: 'web', search: 'web',
  pc: 'pc', system: 'pc', computer: 'pc', settings: 'pc', systemchange: 'pc', cleanup: 'pc', clean: 'pc',
  notify: 'notify', notification: 'notify', message: 'notify', tell: 'notify', report: 'notify', summary: 'notify', send: 'notify',
  wait: 'wait', delay: 'wait', pause: 'wait',
  ask: 'ask', question: 'ask', confirm: 'ask', choose: 'ask',
};

/** "7:30", "7.30 am", "19:30", "7pm" → "07:30" / "19:00", or the input when it isn't a time. */
export function normalizeTime(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(raw);
  if (!m) return raw;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ampm = m[3]?.toLowerCase().replace(/\./g, '');
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return raw;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const PART_OF_DAY: Record<string, string> = { morning: '08:00', noon: '12:00', midday: '12:00', afternoon: '14:00', evening: '19:00', night: '21:00', tonight: '21:00', midnight: '00:00' };

/**
 * A schedule said in words, the way agents (and people) write it: "every day
 * at 8am", "weekdays 7:30", "mon and fri at 9 pm", "every morning", "on
 * demand", or a cron line ("0 8 * * *"). Null when it isn't one.
 */
export function triggerFromText(raw: string): Trigger | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (/^(manual|none|never|on[\s-]?demand|only when (i|they) ask|when (i|they) (ask|say)|by hand|on request)\b/.test(s)) return { kind: 'manual' };
  const cron = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([\d,\-*]+)$/.exec(s);
  if (cron) {
    const time = `${cron[2].padStart(2, '0')}:${cron[1].padStart(2, '0')}`;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    if (cron[3] === '*') return { kind: 'daily', time };
    const nums = cron[3].split(',').flatMap((p) => {
      const [a, b] = p.split('-').map(Number);
      return b === undefined ? [a] : Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    });
    const days = WEEKDAYS.filter((d) => nums.some((n) => JS_DAY[n % 7] === d));
    return days.length === 7 ? { kind: 'daily', time } : days.length ? { kind: 'weekly', days, time } : null;
  }
  const clock = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$|,)/.exec(s.replace(/\b(at|@)\s*/g, ' '));
  let time: string | undefined;
  if (clock && (clock[2] || clock[3])) time = normalizeTime(`${clock[1]}${clock[2] ? `:${clock[2]}` : ''}${clock[3] ?? ''}`) as string;
  else if (clock && /\bat\s*\d/.test(s)) time = normalizeTime(clock[1]) as string;
  time ??= Object.entries(PART_OF_DAY).find(([w]) => new RegExp(`\\b${w}s?\\b`).test(s))?.[1];
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) time = undefined;
  const days = WEEKDAYS.filter((d) => s.split(/[^a-z]+/).some((w) => DAY_WORDS[w]?.includes(d)));
  if (days.length && days.length < 7) return { kind: 'weekly', days, time: time ?? '09:00' };
  if (time || days.length === 7 || /\b(daily|every\s*day|everyday|each day)\b/.test(s)) return { kind: 'daily', time: time ?? '09:00' };
  return null;
}

function normTrigger(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '' || raw === 'manual') return { kind: 'manual' };
  if (typeof raw === 'string') return triggerFromText(raw) ?? raw;
  if (!isObj(raw)) return raw;
  const said = firstOf(raw, 'cron', 'expression', 'text');
  if (typeof said === 'string' && triggerFromText(said)) return triggerFromText(said);
  const kind = String(firstOf(raw, 'kind', 'type', 'every', 'repeat') ?? '').toLowerCase();
  const time = normalizeTime(firstOf(raw, 'time', 'at'));
  const daysRaw = firstOf(raw, 'days', 'on', 'weekdays');
  // "every": "weekdays" names the days, not a kind.
  const daysGiven = daysRaw ?? (DAY_WORDS[kind.replace(/[^a-z]/g, '')] ? kind : undefined);
  const dayList = (Array.isArray(daysGiven) ? daysGiven : typeof daysGiven === 'string' ? daysGiven.split(/[\s,]+/) : [])
    .flatMap((d) => DAY_WORDS[String(d).toLowerCase().replace(/[^a-z]/g, '')] ?? []);
  const days = WEEKDAYS.filter((d) => dayList.includes(d));
  if (kind === 'manual' || kind === 'none' || kind === 'never') return { kind: 'manual' };
  if (days.length === 7) return { kind: 'daily', time };
  if (kind === 'weekly' || kind === 'week' || days.length) return { kind: 'weekly', days, time };
  if (kind === 'daily' || kind === 'day' || kind === 'everyday' || time) return { kind: 'daily', time };
  return raw;
}

function slugStepId(i: number): string {
  return `s${i + 1}`;
}

/**
 * A workflow spec as main stores it, from the shapes agents tend to write:
 * `schedule` for the trigger, "7:30 am" for a time, "weekdays" for days,
 * steps as plain strings, `type`/`action` for a step's kind, `name` for its title.
 */
export function normalizeWorkflowInput(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const w: Loose = { ...raw };
  w.name = firstOf(raw, 'name', 'title');
  w.description = firstOf(raw, 'description', 'summary', 'about');
  if (w.description === undefined) delete w.description;
  if ('trigger' in raw || 'schedule' in raw || 'when' in raw) w.trigger = normTrigger(firstOf(raw, 'trigger', 'schedule', 'when'));
  const steps = firstOf(raw, 'steps', 'actions', 'nodes');
  if (Array.isArray(steps)) {
    w.steps = steps.map((s, i) => {
      if (typeof s === 'string') return { id: slugStepId(i), kind: 'task', title: s.trim().slice(0, 80), ...(s.trim().length > 80 ? { prompt: s.trim() } : {}) };
      if (!isObj(s)) return s;
      const given = String(firstOf(s, 'kind', 'type', 'action') ?? 'task').toLowerCase().replace(/[^a-z]/g, '');
      const params = isObj(s.params) ? s.params : isObj(s.args) ? s.args : {};
      // No title: what it says it does, or the action it names ("temp_clean" → "Temp clean").
      const said = firstOf(s, 'title', 'name', 'label', 'do', 'description', 'summary', 'text');
      const named = firstOf(s, 'command') ?? firstOf(params, 'command', 'action', 'name');
      const title = said ?? (typeof named === 'string' ? named.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : undefined);
      const step: Loose = {
        id: typeof s.id === 'string' && /^[A-Za-z0-9][\w-]{0,23}$/.test(s.id) ? s.id : slugStepId(i),
        kind: KIND_WORDS[given] ?? 'task',
        title,
      };
      const detail = firstOf(s, 'detail', 'description', 'subtitle');
      const prompt = firstOf(s, 'prompt', 'instruction', 'instructions');
      if (detail !== undefined) step.detail = detail;
      if (prompt !== undefined) step.prompt = prompt;
      return step;
    });
  }
  delete w.title; delete w.schedule; delete w.when; delete w.actions; delete w.nodes; delete w.summary; delete w.about;
  return w;
}

/** The fields a user (or the agent) may set; ids, dates and lastRun are main's. */
export const WorkflowInputSchema = z.object({
  name: text(60),
  description: text(240).optional(),
  trigger: TriggerSchema.default({ kind: 'manual' }),
  steps: z.array(StepSchema).min(1).max(MAX_STEPS),
  enabled: z.boolean().default(true),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

/** A partial update: only what's given changes; `steps` replaces the list. */
export const WorkflowPatchSchema = WorkflowInputSchema.partial();
export type WorkflowPatch = z.infer<typeof WorkflowPatchSchema>;

function issuesText(e: z.ZodError): string {
  return e.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(spec)'}: ${i.message}`).join('; ');
}

export const WORKFLOW_SHAPE = '{"name":"Morning routine","description":"News, weather and my day","trigger":{"kind":"weekly","days":["mon","tue","wed","thu","fri"],"time":"07:30"},"steps":[{"kind":"web","title":"Check the weather","detail":"Hyderabad, today"},{"kind":"task","title":"Summarise my unread mail"},{"kind":"notify","title":"Send me the summary"}]} — trigger kinds: manual, daily {time}, weekly {days, time}; step kinds: task, app, web, pc, notify, wait, ask';

export function parseWorkflowInput(raw: unknown): { input: WorkflowInput; error: null } | { input: null; error: string } {
  const r = WorkflowInputSchema.safeParse(normalizeWorkflowInput(raw));
  if (!r.success) return { input: null, error: `${issuesText(r.error)}. A workflow looks like ${WORKFLOW_SHAPE}` };
  return { input: withUniqueStepIds(r.data), error: null };
}

export function parseWorkflowPatch(raw: unknown): { patch: WorkflowPatch; error: null } | { patch: null; error: string } {
  const normal = normalizeWorkflowInput(raw);
  // Only what was given: a missing name or trigger must not reset the stored one.
  if (isObj(normal)) for (const k of Object.keys(normal)) if (normal[k] === undefined) delete normal[k];
  const r = WorkflowPatchSchema.safeParse(normal);
  if (!r.success) return { patch: null, error: `${issuesText(r.error)}. A workflow looks like ${WORKFLOW_SHAPE}` };
  const given = isObj(normal) ? normal : {};
  const patch: WorkflowPatch = {};
  for (const k of Object.keys(r.data) as (keyof WorkflowPatch)[]) if (k in given) (patch as Loose)[k] = r.data[k];
  if (patch.steps) patch.steps = withUniqueStepIds({ steps: patch.steps }).steps;
  return { patch, error: null };
}

function withUniqueStepIds<T extends { steps: WorkflowStep[] }>(w: T): T {
  const used = new Set<string>();
  const steps = w.steps.map((s, i) => {
    let id = s.id || slugStepId(i);
    while (used.has(id)) id = `${id.slice(0, 22)}_${i}`;
    used.add(id);
    return { ...s, id };
  });
  return { ...w, steps };
}

/* ── When it runs ───────────────────────────────────────────────────── */

const DAY_NAMES: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
/** Date.getDay(): 0 is Sunday. */
const JS_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "7:30 am" for "07:30". */
export function clockText(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

/** "Every day at 7:30 am", "Weekdays at 9:00 am", "Mon, Wed at 6:00 pm", "When you run it". */
/**
 * The saved workflow a request names, when running it is the whole request:
 * "execute order 66", "run my morning routine", "start Weekly tidy-up",
 * "Order 66". Null for anything else — a longer request goes to the agent,
 * which can still run one with `dex-workflow run`.
 */
export function workflowCalledFor(prompt: string, workflows: Array<Pick<Workflow, 'name'>>): Workflow | null {
  const text = prompt.trim().toLowerCase().replace(/[“”"'`]/g, '').replace(/[.!?\s]+$/, '');
  if (!text || text.length > 120 || text.includes('\n')) return null;
  const said = text
    .replace(/^(?:(?:hey\s+)?dex[,:]?\s+)?(?:please\s+|pls\s+)?/, '')
    .replace(/^(?:run|execute|exec|start|do|begin|launch|trigger|kick\s+off|go)\s+/, '')
    .replace(/^(?:my|the)\s+/, '')
    .replace(/\s+(?:now|please)$/, '')
    .trim();
  const names = new Set([said, said.replace(/\s+(?:workflow|routine)$/, '')]);
  const hits = workflows.filter((w) => names.has(w.name.trim().toLowerCase().replace(/[“”"'`]/g, '')));
  return hits.length === 1 ? (hits[0] as Workflow) : null;
}

export function triggerText(t: Trigger): string {
  if (t.kind === 'manual') return 'When you run it';
  if (t.kind === 'daily') return `Every day at ${clockText(t.time)}`;
  const set = new Set(t.days);
  const ordered = WEEKDAYS.filter((d) => set.has(d));
  const weekdays = ordered.length === 5 && !set.has('sat') && !set.has('sun');
  const weekend = ordered.length === 2 && set.has('sat') && set.has('sun');
  const days = weekdays ? 'Weekdays' : weekend ? 'Weekends' : ordered.length === 1 ? `Every ${DAY_NAMES[ordered[0]]}` : ordered.map((d) => DAY_NAMES[d]).join(', ');
  return `${days} at ${clockText(t.time)}`;
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function runsOn(t: Trigger, day: Date): boolean {
  if (t.kind === 'daily') return true;
  if (t.kind === 'weekly') return t.days.includes(JS_DAY[day.getDay()]);
  return false;
}

/** The next time it runs after `from` (local time), or null for a manual one. */
export function nextRunAt(t: Trigger, from: number): number | null {
  if (t.kind === 'manual') return null;
  const start = new Date(from);
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (!runsOn(t, day)) continue;
    const at = atTime(day, t.time).getTime();
    if (at > from) return at;
  }
  return null;
}

/** The latest scheduled time at or before `now`, or null. */
export function lastScheduledAt(t: Trigger, now: number): number | null {
  if (t.kind === 'manual') return null;
  const today = new Date(now);
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (!runsOn(t, day)) continue;
    const at = atTime(day, t.time).getTime();
    if (at <= now) return at;
  }
  return null;
}

/**
 * How late a missed run may still start: the PC was asleep at 7:30 and woke
 * at 9 — the morning routine still runs. Asleep all day — it waits for tomorrow.
 */
export const CATCH_UP_MS = 3 * 60 * 60 * 1000;

/**
 * Whether a scheduled workflow should start now: its last scheduled time has
 * passed, it hasn't run since (nor since it was made or changed), and that
 * time isn't too long ago.
 */
export function isDue(w: Workflow, now: number): boolean {
  if (!w.enabled) return false;
  const due = lastScheduledAt(w.trigger, now);
  if (due === null) return false;
  if (now - due > CATCH_UP_MS) return false;
  const since = Math.max(w.lastRun?.at ?? 0, w.updatedAt);
  return due > since;
}

/* ── Running ────────────────────────────────────────────────────────── */

const KIND_HINT: Record<StepKind, string> = {
  task: '',
  app: ' (a Windows app: use the mcp__windows__* tools, in the background)',
  web: ' (the web: an MCP connector first, the browser only if none fits)',
  pc: ' (the PC itself: system_info, and system_change only for allowlisted fixes)',
  notify: ' (tell the user: put it in your final message, which reaches their phone)',
  wait: ' (wait as described, but never more than 10 minutes inside one run)',
  ask: ' (ask the user with dex-ui, then end your turn and carry on with their answer)',
};

/** The prompt a run gets: the steps in order, with how to do each kind. */
export function workflowPrompt(w: Pick<Workflow, 'name' | 'description' | 'steps' | 'trigger'>, by: 'schedule' | 'user'): string {
  const lines = [
    `The application already started one run of “${w.name}”${by === 'schedule' ? ` on its schedule: ${triggerText(w.trigger).toLowerCase()}` : ''}. Complete the steps below in this session. Do not start or run this workflow again.`,
    ...(w.description ? [`What it's for: ${w.description}`] : []),
    '',
    'Do these steps in order:',
    ...w.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}${KIND_HINT[s.kind]}${s.prompt ? `\n   ${s.prompt.replace(/\n/g, '\n   ')}` : ''}`),
    '',
    'If a step can\'t be done, say why in one line and carry on with the next. End with a short summary of what each step found or did.',
  ];
  return lines.join('\n');
}

/** One line for previews and logs: "Morning routine · Weekdays at 7:30 am · 4 steps". */
export function workflowLine(w: Pick<Workflow, 'name' | 'trigger' | 'steps'>): string {
  return `${w.name} · ${triggerText(w.trigger)} · ${w.steps.length} step${w.steps.length === 1 ? '' : 's'}`;
}

const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Next: today at 7:30 am", "Next: tomorrow at 7:30 am", "Next: Friday at 6:00 pm"; "Paused"; null for a manual one. */
export function nextRunText(w: Pick<Workflow, 'trigger' | 'enabled'>, now: number): string | null {
  if (w.trigger.kind === 'manual') return null;
  if (!w.enabled) return 'Paused';
  const at = nextRunAt(w.trigger, now);
  if (at === null) return null;
  const d = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : LONG_DAYS[d.getDay()];
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `Next: ${day} at ${clockText(hhmm)}`;
}
