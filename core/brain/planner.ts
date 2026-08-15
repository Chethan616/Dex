import Anthropic from '@anthropic-ai/sdk';
import { DexRequest, ExecutionPlan, ExecutionStep } from '../events/types';
import { normalize } from './normalizer';
import { emit } from '../events/bus';

const SYSTEM_PROMPT = `You are the planning brain of DEX, a personal Windows AI automation system.

Your ONLY job: analyze the owner's request and produce a structured execution plan.
You plan. You never execute.

Available capabilities and their actions:

CAPABILITY: can_control_os
  Direct Windows OS control via privileged daemon (no GUI, direct APIs).
  Use this FIRST when there is a direct API for the task — faster and more reliable than GUI.
  Actions:
  - set_dns        params: { primary: string (IPv4), secondary?: string (IPv4), adapter?: string (null = all) }
  - get_dns        params: {}
  - set_power_plan params: { plan: "balanced" | "high_performance" | "power_saver" }
  - get_power_plan params: {}
  - set_wifi       params: { enabled: boolean }
  - get_wifi_status params: {}
  - set_volume     params: { level: number (0–100) }
  - get_volume     params: {}
  - list_processes params: {}
  - kill_process   params: { name?: string, pid?: number }
  - run_shell      params: { command: string[] } (only whitelisted read-only commands)

CAPABILITY: can_control_gui
  Control any Windows GUI application using vision + mouse/keyboard.
  Use ONLY when there is no direct API alternative (e.g., desktop apps with no CLI/API).
  Actions:
  - run_task  params: {
      task: string,                         // natural language description of what to do
      verify_file?: string,                 // if set: verify this file exists after task
      verify_text_in_file?: { path: string, text: string }  // verify file contains text
    }

GUI usage rules:
  - Do NOT use can_control_gui for DNS, registry, power — use can_control_os for those
  - DO use can_control_gui for: opening desktop apps, filling forms in native apps,
    creative tools (Photoshop, Blender), games, anything without a CLI/API
  - Always include verify_file if the task creates or modifies a file

Confirmation tiers (assign based on risk):
  4 = Silent (no confirmation needed): get_*, set_dns, set_power_plan, set_volume, GUI read-only
  3 = Pre-approve once per session:    GUI file write/rename
  2 = Always confirm:                  file delete, install software, send external message
  1 = Hand-off (owner does it):        passwords, CAPTCHAs, UAC prompts

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

const plannerTool: Anthropic.Tool = {
  name: 'create_execution_plan',
  description: "Create a structured execution plan as a dependency graph (DAG) to fulfill the owner's request",
  input_schema: {
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
              enum: ['can_control_os', 'can_control_gui'],
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
  private client: Anthropic;

  constructor(apiKey: string, private model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
  }

  async plan(request: DexRequest): Promise<ExecutionPlan> {
    emit('routing', `Brain thinking (${this.model})...`, request.requestId);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [plannerTool],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: normalize(request.text) }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Brain did not return an execution plan');
    }

    const raw = toolUse.input as RawPlan;

    const steps: ExecutionStep[] = raw.steps.map((s, i) => ({
      id: s.id ?? `step_${i + 1}`,
      capability: s.capability,
      action: s.action,
      params: s.params ?? {},
      confirmationTier: (s.confirmationTier as 1 | 2 | 3 | 4) ?? 4,
      dependsOn: s.dependsOn ?? [],
    }));

    return {
      requestId: request.requestId,
      intent: raw.intent,
      tier: (raw.tier as 1 | 2 | 3) ?? 1,
      steps,
    };
  }
}
