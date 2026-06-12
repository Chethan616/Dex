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
    task.kind === "compound"
      ? "This looks like a multi-step task. Chain tools as needed: " +
        "`browser-control__run_browser_task` for steps inside a web page, " +
        "`windows-desktop-control__run_desktop_task` for steps inside a native " +
        "Windows app's UI, and `exec` for file/CLI steps. Do NOT fall back to " +
        "screenshots + SendKeys when one of these tools covers the step."
      : null,
    // OS-state sub-steps are where small models waste minutes driving
    // Settings UI (and then time out). Steer those to exec even when the
    // overall turn routed to a GUI engine.
    primary.engine !== "shell" || task.kind === "compound"
      ? "OS state reads/writes (wallpaper, resolution, DNS, services, " +
        "registry, env vars, screenshots) are one-line PowerShell jobs -- " +
        "use `exec` for those sub-steps instead of driving a Settings UI. " +
        "You CAN open and drive desktop apps (WhatsApp, Excel, Settings) " +
        "via the tools above; never tell the user you're unable to operate " +
        "applications."
      : null,
    // Channel sends beat GUI automation by minutes. When the user has a
    // messenger paired as a Dex channel, the `message` tool delivers
    // text/files in ONE call -- GUI-driving the messenger app is the
    // last resort, not the default.
    "Sending a message or file via WhatsApp/Telegram/Discord/Slack: if " +
      "that channel is paired, use the `message` tool (one call). Only " +
      "fall back to driving the messenger's UI when no channel is paired. " +
      "WhatsApp targets: use `me` to send to the user themselves (never " +
      "ask for their number); other recipients need the FULL international " +
      "number (country code + number, no + or spaces) -- a bare national " +
      "number silently delivers to nobody.",
    fallbackLine,
  ]
    .filter((line): line is string => line !== null && line !== "")
    .join("\n");
}

/**
 * Map of EngineId → the canonical tool id the agent should call.
 * MCP tools surface to the agent NAMESPACED as `<server>__<tool>`
 * (verified against a live `dex agent` tool listing) -- an unprefixed
 * name like `run_desktop_task` doesn't match anything in the agent's
 * tool list, so a small model never connects the hint to the tool.
 * Shell is the built-in `exec` tool (there is no `bash` tool id).
 */
const MCP_TOOL_FOR_ENGINE: Record<EngineId, string> = {
  shell: "exec",
  "ufo-uia": "windows-desktop-control__run_desktop_task",
  "browser-use": "browser-control__run_browser_task",
  omniparser: "omniparser__parse_screen",
};
