/**
 * Orchestration types — Phase C.0.
 *
 * The orchestrator picks ONE automation engine per task by reading a cheap
 * deterministic `RuntimeContext` (active process name, UIA tree availability,
 * browser DOM availability, etc.) and scoring every available engine against
 * the user's `TaskIntent`. No LLM call is made for the routing decision; the
 * LLM only enters the loop AFTER the engine is chosen, to drive that engine's
 * internal step planning.
 *
 * The shape below is the contract Phase C builds against. Concrete engines
 * (UfoUIA, BrowserUse, OmniParser, plus the Dex built-in Shell) live in
 * `./engines/`. The router lives in `./router.ts`. The scorer lives in
 * `./capability-scorer.ts`.
 */

/** Stable identifier for an automation engine. */
export type EngineId = "shell" | "ufo-uia" | "browser-use" | "omniparser" | (string & {});

/** App family classification — derived deterministically from process name. */
export type AppFamily =
  | "browser"
  | "office"
  | "ide"
  | "game"
  | "media"
  | "system"
  | "unknown";

/** What the active foreground browser window is (when one is present). */
export interface BrowserContext {
  kind: "chromium" | "firefox" | "webkit" | (string & {});
  /** Active tab URL if the CDP probe could reach it; undefined otherwise. */
  activeTabUrl?: string;
  /** True if a usable DOM is reachable via CDP / accessibility tree. */
  domAvailable: boolean;
}

/** Process-level facts about the active foreground window. */
export interface ProcessContext {
  /** Lowercased basename, e.g. `"notepad.exe"`, `"chrome.exe"`. */
  name: string;
  /** Absolute path on disk. Empty string when not resolvable. */
  exePath: string;
  /** OS process id (Windows DWORD). */
  pid: number;
}

/** UIA tree availability + a cheap shape estimate. */
export interface UiaContext {
  /** True if a UIA root could be acquired for this window. */
  available: boolean;
  /** Number of children of the root. 0 means an empty / inaccessible tree. */
  rootChildCount: number;
  /** Estimated depth (rough; full traversal is too expensive for the probe). */
  estimatedDepth: number;
}

/** Per-engine history extracted from the telemetry SQLite store. */
export interface EngineHistory {
  /** Total runs against this process+task class. */
  runs: number;
  /** Number of runs that completed with `outcome === "success"`. */
  successes: number;
  /** Rolling average wall-clock time-to-first-action, in milliseconds. */
  avgLatencyMs: number;
}

/** Per-request budget the planner can pass to bias the scorer toward fast engines. */
export interface RuntimeBudget {
  /** Maximum acceptable wall-clock time-to-first-action, in milliseconds. */
  latencyMs?: number;
}

/** Snapshot of "what the user is looking at right now". */
export interface RuntimeContext {
  process: ProcessContext;
  appFamily: AppFamily;
  browser?: BrowserContext;
  uia: UiaContext;
  /** True on a real Windows desktop; false in headless CI / sandboxed runs. */
  visionCapable: boolean;
  /** Per-engine history, keyed by EngineId. Missing engines mean "no history". */
  history: Record<EngineId, EngineHistory | undefined>;
  budget: RuntimeBudget;
}

/** What the user asked Dex to do. */
export type TaskKind = "click" | "type" | "navigate" | "extract" | "compose" | "compound";

export interface TaskIntent {
  kind: TaskKind;
  /** Lowercased hint tokens extracted from the user prompt (urls, app names, etc.). */
  hints: string[];
  /** Raw user prompt — engines that need the full text read this. */
  text?: string;
}

/** Component-wise score breakdown for one engine on one task. */
export interface ScoreBreakdown {
  engine: EngineId;
  /** Composite score, 0..1. Higher is better. */
  score: number;
  /** Individual contributions before weight application; for telemetry. */
  components: {
    /** Hand-tuned (engine, appFamily) base — drives most of the signal. */
    base: number;
    /** Beta-mean(α + successes, β + failures) from history. */
    historyPrior: number;
    /** Negative weight when the engine's estimated latency exceeds budget. */
    latencyPenalty: number;
    /** Engine's self-reported confidence on this RuntimeContext. */
    confidence: number;
  };
  /** Engine's own best-effort latency estimate for this task, in ms. */
  estimatedLatencyMs: number;
}

/** Where the engine got stuck. Routing uses this to decide if a fallback can recover. */
export type ExecErrorKind =
  | "recoverable"
  | "user-confirmation-required"
  | "engine-unavailable"
  | "timeout"
  | "fatal";

export interface ExecError {
  kind: ExecErrorKind;
  message: string;
  /** Optional structured details for the fallback chain to inspect. */
  details?: Record<string, unknown>;
}

/** Outcome of one engine.execute() call. */
export type ExecResult =
  | {
      ok: true;
      /** Engine-reported summary (e.g. UFO²'s final reasoning). */
      summary: string;
      /** Step list for the action card. */
      steps: ExecStep[];
      durationMs: number;
    }
  | {
      ok: false;
      error: ExecError;
      /** Partial steps produced before failure, for the action card. */
      steps: ExecStep[];
      durationMs: number;
    };

export interface ExecStep {
  /** Brief mono-font line for the action card (≤ 80 chars). */
  text: string;
  /** Glyph state for the leading character (matches design.md tokens). */
  state: "queued" | "running" | "done" | "failed" | "skipped";
  /** Optional timestamp the step entered its current state. */
  at?: number;
}

/** Options the router passes to engine.execute(). */
export interface ExecOpts {
  timeoutMs: number;
  /** If true, engine emits planned steps without taking actions. */
  dryRun?: boolean;
  /** Engine-specific knobs (e.g. UFO²'s `engine: fast | vision`). */
  engineHints?: Record<string, unknown>;
}

/** Recovery suggestion returned by engine.recover?(). */
export type RecoveryAction =
  | { kind: "retry" }
  | { kind: "fall-back-to"; engine: EngineId }
  | { kind: "ask-user"; question: string }
  | { kind: "give-up" };

/** Contract every automation engine implements. */
export interface AutomationEngine {
  /** Stable identifier; used in telemetry + score tables + UI chips. */
  id(): EngineId;

  /**
   * Cheap synchronous score for this engine on the given context+task.
   * Range 0..1. The scorer composes this with history priors + latency
   * penalty before picking a winner.
   */
  score(ctx: RuntimeContext, task: TaskIntent): number;

  /** Best-effort time-to-first-action estimate, in ms. */
  estimateLatencyMs(ctx: RuntimeContext, task: TaskIntent): number;

  /**
   * Best-effort success-rate prior, 0..1. Implementations may simply return
   * the Beta-mean of `ctx.history[id()]` or apply additional heuristics.
   */
  estimateSuccessRate(ctx: RuntimeContext, task: TaskIntent): number;

  /** Run the task. Long-running; engine writes telemetry on its own. */
  execute(ctx: RuntimeContext, task: TaskIntent, opts: ExecOpts): Promise<ExecResult>;

  /** Optional: attempt to recover from a known failure mode. */
  recover?(error: ExecError): Promise<RecoveryAction>;
}

/** Router output: who runs the task + what to try if that fails. */
export interface RoutedExecution {
  primary: ScoreBreakdown;
  fallbacks: ScoreBreakdown[];
  /** Full sorted breakdown for telemetry / debugging. */
  scoreBreakdown: ScoreBreakdown[];
}
