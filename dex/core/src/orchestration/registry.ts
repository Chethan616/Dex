/**
 * Engine registry — Phase F.1.a wire-in.
 *
 * Returns the default set of `AutomationEngine` instances the gateway uses
 * when calling `preflight()` for a routing decision. Engines are
 * constructed without callbacks, which means `score()` /
 * `estimateLatencyMs()` / `estimateSuccessRate()` are fully usable for
 * routing, but `execute()` returns `engine-unavailable` until the gateway
 * later wires real MCP transports in (the C.7 follow-up + Phase F.1.b).
 *
 * The shell engine is a tiny inline stub in this file -- there's no
 * concrete `ShellEngine` class today because the existing dex-core
 * bash/process tools live outside the orchestration scaffold. F.1.b
 * will replace this stub with an adapter that calls the actual built-in
 * shell tool dispatcher.
 */

import { BrowserUseEngine } from "./engines/browser-use.js";
import { OmniParserEngine } from "./engines/omniparser.js";
import { UfoUiaEngine } from "./engines/ufo-uia.js";
import type {
  AutomationEngine,
  EngineId,
  ExecResult,
  RuntimeContext,
  TaskIntent,
} from "./types.js";

/** Placeholder shell engine -- scoring works, execute() reports unavailable. */
class ShellEngineStub implements AutomationEngine {
  id(): EngineId {
    return "shell";
  }
  score(_ctx: RuntimeContext, _task: TaskIntent): number {
    // Shell is always a reasonable last resort -- the base table handles
    // family-specific ranking. Our self-confidence is steady.
    return 0.5;
  }
  estimateLatencyMs(_ctx: RuntimeContext, _task: TaskIntent): number {
    return 500;
  }
  estimateSuccessRate(ctx: RuntimeContext, _task: TaskIntent): number {
    const h = ctx.history.shell;
    if (!h || h.runs === 0) return 0.7;
    return h.successes / h.runs;
  }
  async execute(): Promise<ExecResult> {
    return {
      ok: false,
      error: {
        kind: "engine-unavailable",
        message:
          "Shell engine adapter not yet wired. The orchestrator preflight " +
          "still scores correctly; F.1.b connects this to the dex-core " +
          "built-in bash / read / write tools.",
      },
      steps: [],
      durationMs: 0,
    };
  }
}

let cached: readonly AutomationEngine[] | undefined;

/**
 * Lazy singleton for the four-engine default registry. Cheap to call --
 * builds once per process.
 */
export function defaultEngines(): readonly AutomationEngine[] {
  if (!cached) {
    cached = [
      new ShellEngineStub(),
      new UfoUiaEngine(),
      new BrowserUseEngine(),
      new OmniParserEngine(),
    ];
  }
  return cached;
}

/** Reset for tests. Production code should not call this. */
export function resetEngineRegistryForTesting(): void {
  cached = undefined;
}
