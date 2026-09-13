/**
 * UfoUiaEngine — Phase E.2.
 *
 * AutomationEngine adapter for the `windows-desktop-control` MCP server
 * (`dex/core/drivers/windows-desktop-control/server.py`). The router picks
 * this engine when the active foreground is a native Win32 app whose UIA
 * tree is reachable (Office, Settings, Notepad, Calculator, IDEs, …).
 *
 * Transport-agnostic: tests inject the `runDesktopTask` callback; the
 * gateway injects the real MCP-stdio bridge. When undefined, execute()
 * returns engine-unavailable so the router falls back.
 *
 * Phase E.2 also accepts an optional `vision: VisionService`. When wired,
 * a future "UIA returned no actionable hit" branch can call
 * `vision.locate(...)` against the active window region to recover
 * click targets on sparse-UIA controls (legacy apps, custom-drawn
 * canvases inside otherwise-accessible windows). E.2 just plumbs the
 * field; the proactive call lives in a later E.* commit on the Python
 * side mirroring E.3's browser hook.
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

/** Shape of one `run_desktop_task` MCP call. */
export type RunDesktopTaskCallback = (params: {
  goal: string;
  appHint?: string;
  engine?: "fast" | "vision";
  timeoutMs: number;
  dryRun?: boolean;
}) => Promise<{
  ok: boolean;
  summary: string;
  steps: string[];
  taskId?: string;
  logPath?: string;
}>;

export interface UfoUiaEngineOptions {
  /**
   * Invokes the Python `run_desktop_task` tool over MCP. The gateway
   * injects the real implementation; tests inject mocks. When undefined,
   * execute() returns engine-unavailable so the router falls back.
   */
  runDesktopTask?: RunDesktopTaskCallback;
  /**
   * Optional shared vision service (Phase E.0 + E.1). The slot exists so
   * a follow-up commit can call `vision.locate(...)` when UIA traversal
   * returns no actionable hit on a sparse-UIA window. v1 wires the slot
   * but the proactive call ships separately, after the Python driver
   * gains its UIA-coverage probe.
   */
  vision?: VisionService;
}

export class UfoUiaEngine implements AutomationEngine {
  constructor(private readonly options: UfoUiaEngineOptions = {}) {}

  id(): EngineId {
    return "ufo-uia";
  }

  /**
   * Self-confidence on this context. We win cleanly on native Win32
   * surfaces with a reachable UIA tree; we drop sharply when the tree
   * is empty (no hooks for UFO² to read) or when we're inside a
   * browser (browser-use is the right tool).
   */
  score(ctx: RuntimeContext, _task: TaskIntent): number {
    if (ctx.appFamily === "browser") return 0.1;
    if (!ctx.uia.available) return 0.2;
    if (ctx.uia.rootChildCount === 0) return 0.3;
    return 0.9;
  }

  /**
   * UIA traversal is fast; the LLM per-step planning dominates. 4 s is a
   * reasonable cold-start estimate for a short native-app task; telemetry
   * refines this over time.
   */
  estimateLatencyMs(_ctx: RuntimeContext, _task: TaskIntent): number {
    return 4_000;
  }

  estimateSuccessRate(ctx: RuntimeContext, _task: TaskIntent): number {
    const history = ctx.history["ufo-uia"];
    if (!history || history.runs === 0) return 0.6;
    return history.successes / history.runs;
  }

  async execute(_ctx: RuntimeContext, task: TaskIntent, opts: ExecOpts): Promise<ExecResult> {
    const start = Date.now();
    const run = this.options.runDesktopTask;
    if (!run) {
      return {
        ok: false,
        error: {
          kind: "engine-unavailable",
          message:
            "windows-desktop-control MCP transport not wired. The gateway " +
            "connects this adapter to dex/core/drivers/windows-desktop-control/server.py " +
            "at startup.",
        },
        steps: [],
        durationMs: Date.now() - start,
      };
    }
    try {
      const out = await run({
        goal: task.text ?? task.hints.join(" "),
        appHint: extractAppHint(task.hints),
        engine: pickFastOrVision(opts),
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
          summary: out.summary || "ufo-uia completed",
          steps,
          durationMs: Date.now() - start,
        };
      }
      return {
        ok: false,
        error: { kind: "recoverable", message: out.summary || "ufo-uia failed" },
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

function extractAppHint(hints: ReadonlyArray<string>): string | undefined {
  for (const h of hints) {
    if (h.endsWith(".exe")) return h;
  }
  return undefined;
}

function pickFastOrVision(opts: ExecOpts): "fast" | "vision" | undefined {
  const hint = opts.engineHints?.["uiaMode"];
  if (hint === "fast" || hint === "vision") return hint;
  return undefined;
}
