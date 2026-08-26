import { DexRequest, ExecutionPlan, ExecutionStep } from '../events/types';
import { normalize } from './normalizer';
import { emit } from '../events/bus';
import { LlmProvider, ToolSpec } from '../llm/provider';
import { buildBrainProvider } from '../llm/providers';
import { ROUTING_RULES, capabilityCatalogue } from './capabilities';

const SYSTEM_PROMPT = `You are the planning brain of DEX, a personal Windows AI automation system.

Your ONLY job: analyze the owner's request and produce a structured execution plan.
You plan. You never execute.

DEX has three ways to act, in increasing order of cost and decreasing order of
reliability. Always reach for the cheapest one that can do the job.

${capabilityCatalogue()}

${ROUTING_RULES}

CONFIRMATION TIERS (assign per step, based on what happens if it goes wrong):
  4 = Silent. Reading anything; set_dns; power plan; volume; launching an app;
      Tier 2 reads (list_elements, read_element, wait_for, window_state).
  3 = Pre-approve once per session. Writing or renaming a file; Tier 2 steps
      that modify a document.
  2 = Always confirm. Deleting anything; installing software; kill_process;
      registry_write outside DEX's own keys; sending a message to anyone.
  1 = Hand-off. Passwords, CAPTCHAs, UAC prompts.

  Do NOT plan Tier 1 steps for passwords or CAPTCHAs — the agents raise those
  themselves, mid-step, when they actually hit one.

  When unsure between two tiers, pick the more cautious one. A needless
  confirmation costs the owner a click; a missing one can cost them data.

Call create_execution_plan with the structured plan.`;

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
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique step ID, e.g. step_1' },
            capability: {
              type: 'string',
              enum: [
                'can_control_os',
                'can_control_app',
                'can_control_gui',
                'can_browse_web',
                'can_access_email',
                'can_access_calendar',
                'can_access_drive',
              ],
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
  constructor(provider?: LlmProvider) {
    this.provider = provider ?? buildBrainProvider();
  }

  get model(): string {
    return this.provider.label;
  }

  async plan(request: DexRequest): Promise<ExecutionPlan> {
    emit('routing', `Brain thinking (${this.provider.label})...`, request.requestId);

    const raw = (await this.provider.callTool({
      system: SYSTEM_PROMPT,
      user: normalize(request.text),
      tool: plannerTool,
      maxTokens: 2048,
    })) as unknown as RawPlan;

    if (!Array.isArray(raw?.steps) || raw.steps.length === 0) {
      throw new Error('Brain returned a plan with no steps');
    }

    const steps: ExecutionStep[] = raw.steps.map((s, i) => ({
      id: s.id ?? `step_${i + 1}`,
      capability: s.capability,
      action: s.action,
      params: s.params ?? {},
      confirmationTier: clampTier(s.confirmationTier),
      dependsOn: s.dependsOn ?? [],
    }));

    return {
      requestId: request.requestId,
      intent: raw.intent ?? request.text,
      tier: (raw.tier as 1 | 2 | 3) ?? 1,
      steps,
    };
  }
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
