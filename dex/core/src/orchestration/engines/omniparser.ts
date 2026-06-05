/**
 * OmniParser engine adapter — Phase C.5.
 *
 * AutomationEngine implementation that talks to the Python MCP server at
 * `dex/drivers/omniparser/server.py`. The actual MCP transport is owned
 * by the gateway; this adapter is the contract glue between the
 * orchestration router and the running driver.
 *
 * Today the adapter is a STUB: it scores correctly (so the router picks
 * it when the context warrants) but `execute()` returns a "not yet
 * wired" error so the fallback chain advances to the next engine. The
 * actual call into `parse_screen` lands when the orchestrator hooks into
 * the gateway's MCP dispatch table (Phase C.7).
 */

import type {
  AutomationEngine,
  EngineId,
  ExecOpts,
  ExecResult,
  RuntimeContext,
  TaskIntent,
} from "../types.js";

export interface OmniParserAdapterOptions {
  /**
   * Invokes the Python `parse_screen` tool over MCP. The gateway injects
   * a real implementation; tests inject mocks. When undefined, execute()
   * returns engine-unavailable so the router falls back.
   */
  callParseScreen?: (params: {
    imagePath?: string;
    region?: [number, number, number, number];
    maxElements?: number;
    timeoutMs: number;
  }) => Promise<{
    elements: Array<{ bbox: [number, number, number, number]; label: string; type: string }>;
    imagePath: string;
    modelVersion: string;
    durationMs: number;
  }>;
}

export class OmniParserEngine implements AutomationEngine {
  constructor(private readonly options: OmniParserAdapterOptions = {}) {}

  id(): EngineId {
    return "omniparser";
  }

  score(ctx: RuntimeContext, _task: TaskIntent): number {
    // OmniParser's self-confidence is highest when the OTHER two engines
    // are clearly out of reach (no UIA + no DOM). When UIA OR a DOM is
    // available, our base score table handles it; here we just nudge the
    // confidence component up when we're the only option.
    const uiaUnavailable = !ctx.uia.available;
    const noDom = !ctx.browser?.domAvailable;
    if (uiaUnavailable && noDom) return 0.9;
    if (uiaUnavailable || noDom) return 0.5;
    return 0.2;
  }

  estimateLatencyMs(ctx: RuntimeContext, _task: TaskIntent): number {
    // CPU inference: ~2 s per frame. With a GPU it's closer to 300 ms.
    // We bias by visionCapable as a proxy — refine when telemetry has
    // per-host latency histories that the scorer can read directly.
    return ctx.visionCapable ? 2_000 : 5_000;
  }

  estimateSuccessRate(ctx: RuntimeContext, _task: TaskIntent): number {
    const history = ctx.history["omniparser"];
    if (!history || history.runs === 0) return 0.5;
    return history.successes / history.runs;
  }

  async execute(_ctx: RuntimeContext, _task: TaskIntent, opts: ExecOpts): Promise<ExecResult> {
    const start = Date.now();
    if (!this.options.callParseScreen) {
      return {
        ok: false,
        error: {
          kind: "engine-unavailable",
          message:
            "OmniParser MCP transport not wired. Phase C.7 connects this adapter " +
            "to the running dex/drivers/omniparser/server.py via the gateway.",
        },
        steps: [],
        durationMs: Date.now() - start,
      };
    }
    try {
      const parseResult = await this.options.callParseScreen({
        timeoutMs: opts.timeoutMs,
      });
      return {
        ok: true,
        summary: `OmniParser detected ${parseResult.elements.length} elements (${parseResult.modelVersion}).`,
        steps: parseResult.elements.slice(0, 12).map((el) => ({
          text: `${el.type}  "${el.label}"  @ (${el.bbox[0]}, ${el.bbox[1]})`,
          state: "done" as const,
        })),
        durationMs: parseResult.durationMs ?? Date.now() - start,
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
