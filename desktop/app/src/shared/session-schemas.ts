import { z } from 'zod';

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum(['draft', 'running', 'stuck', 'paused', 'idle', 'stopped']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ---------------------------------------------------------------------------
// HlEvent — structured agent output events
// ---------------------------------------------------------------------------

export const HlEventThinkingSchema = z.object({
  type: z.literal('thinking'),
  text: z.string(),
});

export const HlEventToolCallSchema = z.object({
  type: z.literal('tool_call'),
  name: z.string(),
  args: z.unknown(),
  iteration: z.number(),
});

export const HlEventToolResultSchema = z.object({
  type: z.literal('tool_result'),
  name: z.string(),
  ok: z.boolean(),
  preview: z.string(),
  ms: z.number(),
});

export const HlEventDoneSchema = z.object({
  type: z.literal('done'),
  summary: z.string(),
  iterations: z.number(),
});

export const HlEventErrorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const HlEventUserInputSchema = z.object({
  type: z.literal('user_input'),
  text: z.string(),
});

export const HlEventSkillWrittenSchema = z.object({
  type: z.literal('skill_written'),
  path: z.string(),
  domain: z.string(),
  topic: z.string(),
  bytes: z.number(),
  action: z.enum(['write', 'patch']),
});

export const HlEventNotifySchema = z.object({
  type: z.literal('notify'),
  message: z.string(),
  level: z.enum(['info', 'blocking']),
});

export const HlEventHarnessEditedSchema = z.object({
  type: z.literal('harness_edited'),
  target: z.enum(['helpers', 'tools']),
  action: z.enum(['write', 'patch']),
  path: z.string(),
  added: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
  changed: z.array(z.string()).optional(),
});

export const HlEventSkillUsedSchema = z.object({
  type: z.literal('skill_used'),
  path: z.string(),
  domain: z.string().optional(),
  topic: z.string(),
});

export const HlEventFileOutputSchema = z.object({
  type: z.literal('file_output'),
  name: z.string(),
  path: z.string(),
  size: z.number(),
  mime: z.string(),
});

// Emitted by adapters at turn end. Carries cumulative-for-this-turn tokens
// and the dollar cost. For Claude Code, costUsd is the CLI's own total_cost_usd
// (authoritative). For Codex, costUsd is computed from a local price table in
// main/hl/pricing.ts (estimated — may drift from OpenAI's dashboard).
export const HlEventTurnUsageSchema = z.object({
  type: z.literal('turn_usage'),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  costUsd: z.number(),
  model: z.string().optional(),
  // 'exact' for Claude's CLI-reported number; 'estimated' when we multiplied
  // token counts ourselves (Codex). Drives the `~` prefix on the UI.
  source: z.enum(['exact', 'estimated']),
});

// ---------------------------------------------------------------------------
// Task state ledger
//
// The engine (Claude Code / Codex) is the orchestrator: it plans, routes, and
// recovers on its own. What it has never had is a place to *record* that work,
// so a plan lived only inside one provider conversation — invisible to the UI
// and lost on a crash. The `dex-state` CLI writes here at every step boundary.
//
// The `failures` array is the point of the whole structure. A step that failed
// on UIA and succeeded on vision keeps BOTH facts: the step is `done`, and it
// carries the record of what broke and which interface recovered it. That is
// how "a tool failure is not a task failure" becomes something you can see
// rather than something you have to take on faith.
// ---------------------------------------------------------------------------

export const TaskStepStatusSchema = z.enum(['pending', 'active', 'done', 'failed', 'skipped']);
export type TaskStepStatus = z.infer<typeof TaskStepStatusSchema>;

export const TaskStepFailureSchema = z.object({
  reason: z.string(),
  // The interface that failed (e.g. 'uia', 'dom', 'mcp:drive') and the one
  // taken instead (e.g. 'vision'). `fallback` stays undefined when the step
  // was simply retried on the same interface.
  tool: z.string().optional(),
  fallback: z.string().optional(),
  at: z.number(),
});

export const TaskStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStepStatusSchema,
  tool: z.string().optional(),
  failures: z.array(TaskStepFailureSchema).default([]),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});
export type TaskStep = z.infer<typeof TaskStepSchema>;

export const TaskFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number().optional(),
  at: z.number(),
});

export const TaskStateSchema = z.object({
  // Held separately from `sessions.prompt` on purpose: resumeSession()
  // overwrites that column on every follow-up turn, so the original objective
  // would otherwise survive only in the event log.
  objective: z.string(),
  steps: z.array(TaskStepSchema),
  currentStep: z.string().nullable(),
  files: z.array(TaskFileSchema),
  notes: z.array(z.string()),
  updatedAt: z.number(),
});
export type TaskState = z.infer<typeof TaskStateSchema>;

export function validateTaskState(raw: unknown): TaskState {
  return TaskStateSchema.parse(raw);
}

export const EMPTY_TASK_STATE: TaskState = {
  objective: '',
  steps: [],
  currentStep: null,
  files: [],
  notes: [],
  updatedAt: 0,
};

// The wire format of a `dex-state` call. Deliberately a small set of verbs
// rather than "write the whole ledger": the agent should not have to restate
// the plan to record that one step finished, and a partial write can never
// clobber steps it forgot to mention.
export const TaskStateMutationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('plan'),
    objective: z.string().optional(),
    steps: z.array(z.object({ id: z.string().optional(), title: z.string(), tool: z.string().optional() })),
  }),
  z.object({ op: z.literal('step-start'), stepId: z.string() }),
  z.object({ op: z.literal('step-done'), stepId: z.string().optional() }),
  z.object({
    op: z.literal('step-fail'),
    stepId: z.string().optional(),
    reason: z.string(),
    tool: z.string().optional(),
    fallback: z.string().optional(),
  }),
  z.object({ op: z.literal('file'), path: z.string(), name: z.string().optional(), size: z.number().optional() }),
  z.object({ op: z.literal('note'), text: z.string() }),
  z.object({ op: z.literal('get') }),
]);
export type TaskStateMutation = z.infer<typeof TaskStateMutationSchema>;

// ---------------------------------------------------------------------------
// DEX events
// ---------------------------------------------------------------------------

// Emitted when the ledger changes. Carries the whole state rather than a diff:
// it is small, it makes the renderer a pure function of the last event, and a
// dropped frame cannot desynchronise the plan view.
export const HlEventTaskStateSchema = z.object({
  type: z.literal('task_state'),
  state: TaskStateSchema,
});

// A result worth showing as a card rather than as terminal text — today, file
// search hits. `items` is empty for the `reading` kind, which uses `body`.
export const HlEventArtifactSchema = z.object({
  type: z.literal('artifact'),
  kind: z.enum(['files', 'reading']),
  title: z.string(),
  note: z.string().optional(),
  total: z.number().optional(),
  body: z.string().optional(),
  file: z.string().optional(),
  items: z.array(z.object({
    label: z.string(),
    detail: z.string().optional(),
    reasons: z.array(z.string()).default([]),
    excerpt: z.string().optional(),
    bytes: z.number().optional(),
    modified: z.number().optional(),
  })).default([]),
});

// A screen capture taken while driving the desktop. Shown in the preview pane
// only while the browser view is not live — see PreviewDeck.
export const HlEventScreenshotSchema = z.object({
  type: z.literal('screenshot'),
  path: z.string(),
  caption: z.string().optional(),
  // 'uia' when the shot is annotated with numbered accessibility boxes,
  // 'raw' for a plain capture. Drives the caption the deck shows.
  mode: z.enum(['raw', 'uia']).default('raw'),
  at: z.number(),
});

export const HlEventSchema = z.discriminatedUnion('type', [
  HlEventThinkingSchema,
  HlEventToolCallSchema,
  HlEventToolResultSchema,
  HlEventDoneSchema,
  HlEventErrorSchema,
  HlEventUserInputSchema,
  HlEventSkillWrittenSchema,
  HlEventNotifySchema,
  HlEventHarnessEditedSchema,
  HlEventSkillUsedSchema,
  HlEventFileOutputSchema,
  HlEventTurnUsageSchema,
  HlEventTaskStateSchema,
  HlEventArtifactSchema,
  HlEventScreenshotSchema,
]);

export type HlEvent = z.infer<typeof HlEventSchema>;

// ---------------------------------------------------------------------------
// AgentSession — the core session record
// ---------------------------------------------------------------------------

export const AgentSessionSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  status: SessionStatusSchema,
  createdAt: z.number(),
  output: z.array(HlEventSchema),
  error: z.string().optional(),
  group: z.string().optional(),
  hasBrowser: z.boolean().optional(),
  originChannel: z.string().optional(),
  originConversationId: z.string().optional(),
  primarySite: z.string().nullable().optional(),
  lastUrl: z.string().nullable().optional(),
  canResume: z.boolean().optional(),
  lastActivityAt: z.number().optional(),
  engine: z.string().optional(),
  model: z.string().optional(),
  // Snapshotted at spawn — whether the run was authenticated via API key or
  // subscription OAuth. Optional on existing rows (pre-migration-v9 sessions
  // predate this field). Distinct from the live auth mode in authStore because
  // users may flip between modes, but historical sessions should still reflect
  // the mode that actually ran them (for cost attribution).
  // Cumulative usage totals, updated on each turn_usage event. For Claude Code
  // these reflect the CLI's own figures; for Codex they are computed locally
  // via main/hl/pricing.ts and may drift from OpenAI's dashboard.
  costUsd: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  costSource: z.enum(['exact', 'estimated']).optional(),
  authMode: z.enum(['apiKey', 'subscription']).optional(),
  // Subscription tier label when authMode === 'subscription'. For Claude Code
  // this is the OAuth credential's subscriptionType ("max" | "pro"). For Codex
  // we use 'chatgpt' as a generic label since the CLI does not expose the
  // plan tier locally.
  subscriptionType: z.string().optional(),
});

export type AgentSession = z.infer<typeof AgentSessionSchema>;

// ---------------------------------------------------------------------------
// OutputEntry — UI-friendly flattened event for rendering
// ---------------------------------------------------------------------------

export const OutputEntryTypeSchema = z.enum(['thinking', 'tool_call', 'tool_result', 'text', 'error']);

export const OutputEntrySchema = z.object({
  id: z.string(),
  type: OutputEntryTypeSchema,
  timestamp: z.number(),
  content: z.string(),
  tool: z.string().optional(),
  duration: z.number().optional(),
});

export type OutputEntry = z.infer<typeof OutputEntrySchema>;

// ---------------------------------------------------------------------------
// TabInfo — browser tab observation
// ---------------------------------------------------------------------------

export const TabInfoSchema = z.object({
  targetId: z.string(),
  url: z.string(),
  title: z.string(),
  type: z.enum(['page', 'iframe', 'other']),
  active: z.boolean(),
});

export type TabInfo = z.infer<typeof TabInfoSchema>;

// ---------------------------------------------------------------------------
// BrowserPoolStats — monitoring data
// ---------------------------------------------------------------------------

export const PoolSessionInfoSchema = z.object({
  sessionId: z.string(),
  attached: z.boolean(),
  createdAt: z.number(),
  pid: z.number(),
});

export const BrowserPoolStatsSchema = z.object({
  active: z.number(),
  queued: z.number(),
  maxConcurrent: z.number(),
  sessions: z.array(PoolSessionInfoSchema),
});

export type BrowserPoolStats = z.infer<typeof BrowserPoolStatsSchema>;

// ---------------------------------------------------------------------------
// IPC validation helpers
// ---------------------------------------------------------------------------

export function validateSession(data: unknown): AgentSession {
  return AgentSessionSchema.parse(data);
}

export function validateSessionList(data: unknown): AgentSession[] {
  return z.array(AgentSessionSchema).parse(data);
}

export function validateHlEvent(data: unknown): HlEvent {
  return HlEventSchema.parse(data);
}

export function validateTabs(data: unknown): TabInfo[] {
  return z.array(TabInfoSchema).parse(data);
}

export function validatePoolStats(data: unknown): BrowserPoolStats {
  return BrowserPoolStatsSchema.parse(data);
}
