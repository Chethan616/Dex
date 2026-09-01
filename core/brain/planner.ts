import { DexRequest, ExecutionPlan, ExecutionStep } from '../events/types';
import { normalize } from './normalizer';
import { emit } from '../events/bus';
import { LlmProvider, ToolSpec } from '../llm/provider';
import { buildBrainProvider } from '../llm/providers';
import {
  CAPABILITY_NAMES,
  ROUTING_RULES,
  WorkflowSummary,
  capabilityCatalogue,
  workflowCatalogue,
} from './capabilities';

function systemPrompt(workflows: WorkflowSummary[]): string {
  return `You are the planning brain of DEX, a personal Windows AI automation system.

Your ONLY job: analyze the owner's request and produce a structured execution plan.
You plan. You never execute.

DEX has three ways to act, in increasing order of cost and decreasing order of
reliability. Always reach for the cheapest one that can do the job.

${capabilityCatalogue()}${workflowCatalogue(workflows)}

${ROUTING_RULES}

CONFIRMATION TIERS (assign per step, based on what happens if it goes wrong):
  4 = Silent. Reading anything; file search; set_dns; power plan; volume;
      launching an app; Tier 2 reads (list_elements, read_element, wait_for,
      window_state).
  3 = Pre-approve once per session. Writing a file inside the Dex workspace;
      Tier 2 steps that modify a document.
  2 = Always confirm. Running a program; deleting anything; installing software;
      kill_process; registry_write outside DEX's own keys; sending a message to
      anyone.
  1 = Hand-off. Passwords, CAPTCHAs, UAC prompts.

  Do NOT plan Tier 1 steps for passwords or CAPTCHAs — the agents raise those
  themselves, mid-step, when they actually hit one.

  When unsure between two tiers, pick the more cautious one. A needless
  confirmation costs the owner a click; a missing one can cost them data.

WHEN THERE IS NOTHING TO DO

  Some requests are not tasks. "what can you do", "who are you", "hello",
  "which of these should I use" — these want an answer, not an action.

  For those, set "reply" to the answer and leave "steps" empty. Do not invent a
  step to justify replying, and do not reply and act in the same plan: if the
  request needs work done, plan the work and say nothing.

  Answer as Dex, in the second person, briefly — two or three sentences unless
  more is genuinely wanted. Ground it in the capability list above: that list
  is exactly what you can do, and claiming anything outside it is a promise the
  owner will discover is false the first time they try it. If you are asked for
  something Dex cannot do, say so plainly and name the nearest thing it can.

Call create_execution_plan with the structured plan.`;
}

interface RawStep {
  id?: string;
  capability: string;
  action: string;
  params?: Record<string, unknown>;
  confirmationTier: number;
  dependsOn?: string[];
}

interface RawPlan {
  intent: string;
  tier: number;
  steps: RawStep[];
  reply?: string;
}

const plannerTool: ToolSpec = {
  name: 'create_execution_plan',
  description: "Create a structured execution plan as a dependency graph (DAG) to fulfill the owner's request",
  schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        description: 'One-sentence summary of what the owner wants to accomplish',
      },
      tier: {
        type: 'integer',
        enum: [1, 2, 3],
        description: '1 = single step, 2 = multi-step single agent, 3 = multi-agent DAG',
      },
      reply: {
        type: 'string',
        description:
          'The answer, when the request is a question or conversation rather ' +
          'than a task. Leave steps empty when this is set.',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique step ID, e.g. step_1' },
            capability: {
              type: 'string',
              // Generated, not restated. This enum and the catalogue in
              // capabilities.ts were two hand-kept lists and they drifted —
              // four capabilities were legal here and undocumented there.
              enum: [...CAPABILITY_NAMES],
              description: 'Which capability to use',
            },
            action: { type: 'string', description: 'Which action within that capability' },
            params: {
              type: 'object',
              description: 'Action-specific parameters as key-value pairs',
            },
            confirmationTier: {
              type: 'integer',
              enum: [1, 2, 3, 4],
              description:
                '4=silent, 3=pre-approve per session, 2=always confirm, 1=hand-off to owner',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Step IDs this step must wait for (empty array if no dependencies)',
            },
          },
          required: ['id', 'capability', 'action', 'params', 'confirmationTier', 'dependsOn'],
        },
      },
    },
    required: ['intent', 'tier', 'steps'],
  },
};

export class Brain {
  private provider: LlmProvider;

  /**
   * Takes a provider rather than an API key so the Brain has no idea which
   * vendor is answering — that choice lives in core/llm and is one env var.
   */
  constructor(
    provider?: LlmProvider,
    /**
     * Supplies the saved workflows to advertise. A callback rather than a list
     * because workflows are saved and forgotten while Dex runs, and a snapshot
     * taken at construction would go stale immediately.
     */
    private workflows: () => WorkflowSummary[] = () => [],
  ) {
    this.provider = provider ?? buildBrainProvider();
  }

  /**
   * The live view of saved workflows this Brain was built with.
   *
   * Exposed so the Gateway can carry it across when it rebuilds the Brain for
   * a new provider. Rebuilding without it would leave a planner that cannot
   * choose a saved workflow, and nothing would say so — the plans would just
   * quietly get more expensive.
   */
  get workflowSource(): () => WorkflowSummary[] {
    return this.workflows;
  }

  get model(): string {
    return this.provider.label;
  }

  async plan(request: DexRequest): Promise<ExecutionPlan> {
    emit('routing', `Brain thinking (${this.provider.label})...`, request.requestId);

    const raw = (await this.provider.callTool({
      system: systemPrompt(this.workflows()),
      user: normalize(request.text),
      tool: plannerTool,
      // Keep the request under Groq's small-tier token-per-minute budget. The
      // provider still has a 2,048-token emergency fallback for unusually
      // large capability/workflow catalogues.
      maxTokens: 4096,
    })) as unknown as RawPlan;

    const rawSteps = Array.isArray(raw?.steps) ? raw.steps : [];
    const reply = typeof raw?.reply === 'string' ? raw.reply.trim() : '';

    // A plan may answer or act, never both.
    //
    // Not tidiness — a safety boundary. If a plan could act *and* narrate, the
    // narration would be written before the steps ran, so it could not describe
    // what happened; and a step that reads a web page could shape what the
    // owner is told about that page. Answers come from requests that do
    // nothing; results come from A2's phrasing pass, which sees only step data.
    if (rawSteps.length === 0) {
      if (!reply) {
        throw new Error('Brain returned neither steps nor a reply');
      }
      return {
        requestId: request.requestId,
        intent: raw.intent ?? request.text,
        tier: 1,
        steps: [],
        reply,
      };
    }

    const steps: ExecutionStep[] = rawSteps.map((s, i) => normalizeStep(s, i));

    return {
      requestId: request.requestId,
      intent: raw.intent ?? request.text,
      tier: (raw.tier as 1 | 2 | 3) ?? 1,
      steps,
    };
  }

  /**
   * Turn what the steps actually returned into a sentence.
   *
   * Dex used to finish a read with the plan's own restatement of the question —
   * "Done: Retrieve the current Windows power plan" — while the answer sat
   * unused in the agent's result. This is the pass that says "You're on the
   * Balanced power plan" instead.
   *
   * Two rules make this safe to run on a system built around verifying rather
   * than assuming:
   *
   *   - It is given ONLY the structured data the steps returned. Never page
   *     text, never file contents. Untrusted content does not get a second
   *     route into a message that reads as Dex speaking.
   *   - It must not alter values. The prompt says so, and the caller keeps the
   *     raw facts, so a wrong number is a visible disagreement rather than the
   *     only thing on screen.
   *
   * Returns null on any failure — rate limit, timeout, empty answer. The caller
   * falls back to rendering the facts directly, because an unanswered question
   * is a worse outcome than a plainly formatted one.
   */
  async phrase(request: string, facts: Record<string, unknown>[]): Promise<string | null> {
    if (facts.length === 0) return null;

    try {
      const answer = (await this.provider.callTool({
        system:
          'You are Dex, reporting what you just found on the owner\'s Windows PC.\n' +
          'You are given the exact data the system returned. State it in one or two\n' +
          'short sentences, in the second person.\n\n' +
          'Rules:\n' +
          '  - Use the values exactly as given. Never round, convert, reorder or\n' +
          '    invent one. If a value looks odd, report it as it is.\n' +
          '  - Mention only what is in the data. Add no advice and no commentary.\n' +
          '  - If the data does not answer the question, say what was found instead.\n' +
          '  - No preamble. Do not say "the data shows".',
        user:
          `The owner asked: ${request}\n\n` +
          `The system returned:\n${JSON.stringify(facts, null, 2)}`,
        tool: answerTool,
        maxTokens: 512,
      })) as { answer?: unknown };

      const text = typeof answer?.answer === 'string' ? answer.answer.trim() : '';
      return text || null;
    } catch {
      // Rate limits are routine on a free tier and must not turn a successful
      // task into a failed one.
      return null;
    }
  }
}

const answerTool: ToolSpec = {
  name: 'report',
  description: 'Report the result to the owner in one or two sentences',
  schema: {
    type: 'object' as const,
    properties: {
      answer: { type: 'string', description: 'What to tell the owner' },
    },
    required: ['answer'],
  },
};

/**
 * Models sometimes use `wait_for` as a window-readiness check and omit the
 * control name. The App Agent's wait operation intentionally requires a name
 * because it waits on a real accessibility-tree element, not a guessed
 * sleep. Repair that unambiguous case at the planner boundary so malformed
 * model output never reaches the agent or becomes a confusing task failure.
 */
function normalizeStep(raw: RawStep, index: number): ExecutionStep {
  const params = { ...(raw.params ?? {}) };
  const window = nonEmptyString(params.window);
  const name = nonEmptyString(params.name) ?? nonEmptyString(params.element);

  if (raw.capability === 'can_control_app' && raw.action === 'wait_for') {
    if (name && !nonEmptyString(params.name)) params.name = name;
    if (!name && window) {
      return {
        id: raw.id ?? `step_${index + 1}`,
        capability: raw.capability,
        action: 'window_state',
        params: { window },
        confirmationTier: clampTier(raw.confirmationTier),
        dependsOn: raw.dependsOn ?? [],
      };
    }
  }

  return {
    id: raw.id ?? `step_${index + 1}`,
    capability: raw.capability,
    action: raw.action,
    params,
    confirmationTier: clampTier(raw.confirmationTier),
    dependsOn: raw.dependsOn ?? [],
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The planner's tier feeds the confirmation gate, so a model that mislabels it
 * weakens a safety control. Measured: gpt-oss-120b tagged trivial reads as
 * Tier 1. An out-of-range or missing value becomes Tier 2 — ask the owner —
 * because the safe direction to fail is "confirm something harmless", never
 * "silently run something destructive".
 */
function clampTier(value: unknown): 1 | 2 | 3 | 4 {
  const tier = Number(value);
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4) return tier;
  return 2;
}
