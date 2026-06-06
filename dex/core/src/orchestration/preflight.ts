/**
 * Engine preflight — Phase F.1.a.
 *
 * Wraps scanRuntimeContext + parseTaskIntent + route into a single
 * call that returns:
 *   - the picked engine (primary)
 *   - the fallback chain (next two engines)
 *   - a formatted system-prompt hint string the gateway can inject so
 *     the LLM picks the matching MCP tool.
 *
 * v1 just builds the hint string. The actual hint injection into the
 * agent's system prompt is a follow-up commit (F.1.a.wire) so that
 * change can be reviewed independently of the preflight logic.
 *
 * Performance: scanner ≤ 50 ms, scorer ≤ 10 ms, router ≤ 5 ms, hint
 * formatting trivial — total preflight cost stays well under 100 ms,
 * the latency budget locked in the orchestration README.
 */

import { scanRuntimeContext, type ContextScannerProbes } from "./context-scanner.js";
import { route } from "./router.js";
import { parseTaskIntent } from "./task-intent.js";
import type {
  AutomationEngine,
  EngineId,
  RoutedExecution,
  RuntimeBudget,
  RuntimeContext,
  TaskIntent,
} from "./types.js";

export interface EnginePreflightInput {
  /** Raw user prompt text. */
  userText: string;
  /** Engines registered with the orchestrator. */
  engines: readonly AutomationEngine[];
  /** Probes injected by the gateway. Tests pass mocks. */
  probes?: ContextScannerProbes;
  /** Optional latency budget the planner wants the engine to respect. */
  budget?: RuntimeBudget;
}

export interface EnginePreflightResult {
  ctx: RuntimeContext;
  task: TaskIntent;
  routed: RoutedExecution;
  /**
   * Human-readable system-prompt addendum. Empty when the routed primary
   * is `shell` AND the alternatives' scores are within 0.05 — at that
   * point the agent's built-in default already nails the task, no nudge
   * needed.
   */
  hint: string;
}

/**
 * Run the orchestrator preflight and return the picked engine + a
 * system-prompt hint string. Pure async; safe to call from the agent
 * turn pipeline.
 */
export async function preflight(input: EnginePreflightInput): Promise<EnginePreflightResult> {
  const task = parseTaskIntent(input.userText);
  const ctx = await scanRuntimeContext(input.budget ?? {}, input.probes ?? {});
  const routed = route(input.engines, ctx, task);
  const hint = buildEnginePreflightHint({ ctx, task, routed });
  return { ctx, task, routed, hint };
}

/**
 * Format a system-prompt hint the LLM will read on its next turn.
 * Returns "" when no nudge is needed.
 */
export function buildEnginePreflightHint(args: {
  ctx: RuntimeContext;
  task: TaskIntent;
  routed: RoutedExecution;
}): string {
  const { ctx, task, routed } = args;
  const primary = routed.primary;
  const next = routed.fallbacks[0];

  // Suppress the hint when shell is the runaway winner (clear margin
  // over the next engine) -- the agent already knows about shell tools
  // by default and an extra nudge would be pure noise. Close calls
  // (gap < 0.05) still get the hint so the agent has both options.
  if (primary.engine === "shell" && (!next || primary.score - next.score >= 0.05)) {
    return "";
  }

  const toolName = MCP_TOOL_FOR_ENGINE[primary.engine] ?? "the matching MCP tool";
  const familyLine =
    ctx.appFamily !== "unknown"
      ? `Active app family: ${ctx.appFamily}` +
        (ctx.process.name ? ` (foreground: ${ctx.process.name})` : "")
      : null;
  const taskLine = task.kind !== "compound" ? `Task kind: ${task.kind}` : null;
  const hintsLine = task.hints.length > 0 ? `Hints: ${task.hints.join(", ")}` : null;
  const fallbackLine = next
    ? `Fallback engines available: ${routed.fallbacks
        .map((f) => `${f.engine} (score=${f.score.toFixed(2)})`)
        .join(", ")}.`
    : null;

  return [
    "## Orchestrator preflight",
    `For this turn the Dex orchestrator picked engine \`${primary.engine}\` ` +
      `(score=${primary.score.toFixed(2)}, latency≈${primary.estimatedLatencyMs}ms).`,
    familyLine,
    taskLine,
    hintsLine,
    `Prefer the matching MCP tool: \`${toolName}\`. ` +
      "If you must deviate (e.g. the picked tool returned an error you can't fix), " +
      "say so explicitly in your reply and pick from the fallbacks.",
    fallbackLine,
  ]
    .filter((line): line is string => line !== null && line !== "")
    .join("\n");
}

/** Map of EngineId → the canonical MCP tool the agent should call. */
const MCP_TOOL_FOR_ENGINE: Record<EngineId, string> = {
  shell: "bash",
  "ufo-uia": "run_desktop_task",
  "browser-use": "run_browser_task",
  omniparser: "parse_screen",
};
