import type { RuntimeEnv } from "../runtime.js";
import type { ConchAssistantPlan, ConchAssistantPlanner } from "./assistant.js";
import {
  describeConchPersistentOperation,
  parseConchOperation,
  type ConchOperation,
} from "./operations.js";
import { loadConchOverview, type ConchOverview } from "./overview.js";

type ConchDialogueOptions = {
  loadOverview?: typeof loadConchOverview;
  planWithAssistant?: ConchAssistantPlanner;
};

export function approvalQuestion(operation: ConchOperation): string {
  return `Apply this operation: ${describeConchPersistentOperation(operation)}?`;
}

export function isYes(input: string): boolean {
  return /^(y|yes|apply|do it|approved?)$/i.test(input.trim());
}

export async function resolveConchOperation(
  input: string,
  runtime: RuntimeEnv,
  opts: ConchDialogueOptions,
): Promise<ConchOperation> {
  const operation = parseConchOperation(input);
  if (!shouldAskAssistant(input, operation)) {
    return operation;
  }
  const overview = await (opts.loadOverview ?? loadConchOverview)();
  const planner = opts.planWithAssistant ?? (await import("./assistant.js")).planConchCommand;
  const plan = await planner({ input, overview });
  if (!plan) {
    return operation;
  }
  const planned = parseConchOperation(plan.command);
  if (planned.kind === "none") {
    return operation;
  }
  logAssistantPlan(runtime, plan, overview);
  return planned;
}

function shouldAskAssistant(input: string, operation: ConchOperation): boolean {
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
  plan: ConchAssistantPlan,
  overview: ConchOverview,
): void {
  const modelLabel = plan.modelLabel ?? overview.defaultModel ?? "configured model";
  runtime.log(`[conch] planner: ${modelLabel}`);
  if (plan.reply) {
    runtime.log(plan.reply);
  }
  runtime.log(`[conch] interpreted: ${plan.command}`);
}
