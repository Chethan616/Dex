/**
 * BrowserUseEngine — Phase E.2.
 *
 * AutomationEngine adapter for the `browser-control` MCP server
 * (`dex/drivers/browser-control/server.py`). The router picks this
 * engine when the active foreground process is a browser AND a usable
 * DOM is reachable; the engine then drives `browser-use` over MCP to
 * navigate / click / type through the goal.
 *
 * The adapter is transport-agnostic: tests inject the `runBrowserTask`
 * callback, and the gateway injects the real MCP-stdio bridge. When no
 * callback is wired, execute() returns engine-unavailable so the router
 * falls back to the next engine in the chain.
 *
 * Phase E.2 ALSO accepts an optional `vision: VisionService`. The slot
 * is the contract E.3's canvas-detection hook will use: when the browser
 * driver hits a `<canvas>` element with no actionable DOM, it calls
 * vision.locate() to recover candidate click targets. E.2 just plumbs
 * the field; the proactive-vision call lives in E.3 on the Python side.
 */

import type {
  AutomationEngine,
  EngineId,
  ExecOpts,
  ExecResult,
  RuntimeContext,
  TaskIntent,
} from "../types.js";
import type { VisionService } from "../vision.js";

/** Shape of one `run_browser_task` MCP call. */
export type RunBrowserTaskCallback = (params: {
  goal: string;
  urlHint?: string;
  timeoutMs: number;
  dryRun?: boolean;
  headless?: boolean;
}) => Promise<{
  ok: boolean;
  summary: string;
  steps: string[];
  taskId?: string;
  logPath?: string;
}>;

export interface BrowserUseEngineOptions {
  /**
   * Invokes the Python `run_browser_task` tool over MCP. The gateway
   * injects the real implementation; tests inject mocks. When undefined,
   * execute() returns engine-unavailable so the router falls back.
   */
  runBrowserTask?: RunBrowserTaskCallback;
  /**
   * Optional shared vision service (Phase E.0 + E.1). When wired, E.3's
   * canvas hook can call `vision.locate(...)` to recover click targets on
   * `<canvas>`-heavy pages (Figma, Miro, Canva). When undefined, the
   * engine still runs the normal browser-use loop -- no vision-assist.
   */
  vision?: VisionService;
}

export class BrowserUseEngine implements AutomationEngine {
  constructor(private readonly options: BrowserUseEngineOptions = {}) {}

  id(): EngineId {
    return "browser-use";
  }

  /**
   * Self-confidence on this context. Higher when we're clearly the right
   * tool (browser foreground + reachable DOM), lower when conditions
   * lean toward another engine. The router's base-score table still
   * dominates routing; this is the confidence component.
   */
  score(ctx: RuntimeContext, _task: TaskIntent): number {
    const isBrowser = ctx.appFamily === "browser";
    const domAvailable = ctx.browser?.domAvailable === true;
    if (isBrowser && domAvailable) return 0.95;
    if (isBrowser) return 0.6;
    return 0.1;
  }

  /**
   * Browser tasks are network-bound; first-byte latency depends on the
   * page. 6 s is a sane average for a Playwright spawn + first navigation
   * + first LLM turn. Telemetry refines this over time.
   */
  estimateLatencyMs(_ctx: RuntimeContext, _task: TaskIntent): number {
    return 6_000;
  }

  estimateSuccessRate(ctx: RuntimeContext, _task: TaskIntent): number {
    const history = ctx.history["browser-use"];
    if (!history || history.runs === 0) return 0.55;
    return history.successes / history.runs;
  }

  async execute(_ctx: RuntimeContext, task: TaskIntent, opts: ExecOpts): Promise<ExecResult> {
    const start = Date.now();
    const run = this.options.runBrowserTask;
    if (!run) {
      return {
        ok: false,
        error: {
          kind: "engine-unavailable",
          message:
            "browser-control MCP transport not wired. Phase E.3 connects this " +
            "adapter to the running dex/drivers/browser-control/server.py via the " +
            "gateway.",
        },
        steps: [],
        durationMs: Date.now() - start,
      };
    }
    try {
      const out = await run({
        goal: task.text ?? task.hints.join(" "),
        urlHint: extractUrlHint(task.hints),
        timeoutMs: opts.timeoutMs,
        dryRun: opts.dryRun,
      });
      const steps = (out.steps ?? []).slice(0, 32).map((text) => ({
        text,
        state: "done" as const,
      }));
      if (out.ok) {
        return {
          ok: true,
          summary: out.summary || "browser-use completed",
          steps,
          durationMs: Date.now() - start,
        };
      }
      return {
        ok: false,
        error: { kind: "recoverable", message: out.summary || "browser-use failed" },
        steps,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "recoverable",
          message: err instanceof Error ? err.message : String(err),
        },
        steps: [],
        durationMs: Date.now() - start,
      };
    }
  }
}

function extractUrlHint(hints: ReadonlyArray<string>): string | undefined {
  for (const h of hints) {
    if (h.startsWith("http://") || h.startsWith("https://")) return h;
  }
  return undefined;
}
