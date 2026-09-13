import type { RuntimeEnv } from "../runtime.js";
import type { AtlasAssistantPlan, AtlasAssistantPlanner } from "./assistant.js";
import {
  describeAtlasPersistentOperation,
  parseAtlasOperation,
  type AtlasOperation,
} from "./operations.js";
import { loadAtlasOverview, type AtlasOverview } from "./overview.js";

type AtlasDialogueOptions = {
  loadOverview?: typeof loadAtlasOverview;
  planWithAssistant?: AtlasAssistantPlanner;
};

export function approvalQuestion(operation: AtlasOperation): string {
  return `Apply this operation: ${describeAtlasPersistentOperation(operation)}?`;
}

export function isYes(input: string): boolean {
  return /^(y|yes|apply|do it|approved?)$/i.test(input.trim());
}

export async function resolveAtlasOperation(
  input: string,
  runtime: RuntimeEnv,
  opts: AtlasDialogueOptions,
): Promise<AtlasOperation> {
  const operation = parseAtlasOperation(input);
  if (!shouldAskAssistant(input, operation)) {
    return operation;
  }
  const overview = await (opts.loadOverview ?? loadAtlasOverview)();
  const planner = opts.planWithAssistant ?? (await import("./assistant.js")).planAtlasCommand;
  const plan = await planner({ input, overview });
  if (!plan) {
    return operation;
  }
  const planned = parseAtlasOperation(plan.command);
  if (planned.kind === "none") {
    return operation;
  }
  logAssistantPlan(runtime, plan, overview);
  return planned;
}

function shouldAskAssistant(input: string, operation: AtlasOperation): boolean {
  if (operation.kind !== "none") {
    return false;
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed === "quit" || trimmed === "exit") {
    return false;
  }
  return true;
}

function logAssistantPlan(
  runtime: RuntimeEnv,
  plan: AtlasAssistantPlan,
  overview: AtlasOverview,
): void {
  const modelLabel = plan.modelLabel ?? overview.defaultModel ?? "configured model";
  runtime.log(`[atlas] planner: ${modelLabel}`);
  if (plan.reply) {
    runtime.log(plan.reply);
  }
  runtime.log(`[atlas] interpreted: ${plan.command}`);
}
