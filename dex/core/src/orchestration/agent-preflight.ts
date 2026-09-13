/**
 * Agent preflight adapter — Phase F.1.a wire-in.
 *
 * Plugs the orchestrator preflight into the gateway's agent turn loop.
 * Called from `cli-runner/prepare.ts` with the user's prompt; returns
 * the system-prompt hint string the prepare path appends to the agent's
 * next turn.
 *
 * Why this lives separately from `preflight.ts`: the gateway preflight
 * has zero access to a real foreground process probe today -- the agent
 * loop runs in the gateway's Node process, not the user's desktop
 * session. So we synthesize a probe from the parsed `TaskIntent.hints`
 * (which already maps "open notepad" -> `notepad.exe` and so on). When
 * the gateway later gains a remote-foreground probe via the paired Dex
 * mobile / desktop client, swap `synthesizeForegroundFromHints()` for
 * the real probe and this file's contract doesn't change.
 */

import { preflight, type EnginePreflightResult } from "./preflight.js";
import { defaultEngines } from "./registry.js";
import { inferAppFamilyFromHints, parseTaskIntent } from "./task-intent.js";
import type {
  AppFamily,
  AutomationEngine,
  EngineHistory,
  EngineId,
  ProcessContext,
} from "./types.js";
import type { ContextScannerProbes } from "./context-scanner.js";

export interface AgentPreflightOptions {
  /** Override the default 4-engine registry. Tests / future integrations. */
  engines?: readonly AutomationEngine[];
  /** Override the probes. Production passes nothing (synthetic probes
   *  reconstructed from task intent). */
  probes?: ContextScannerProbes;
  /** Caller may inject an existing telemetry-derived history snapshot
   *  per engine so the Beta-prior scoring has real data even without a
   *  process probe. */
  history?: Record<EngineId, EngineHistory>;
}

/**
 * Run the orchestrator preflight against the user's raw text. Returns
 * the hint string the agent's system prompt should append. Returns ""
 * on unhandled error (so a preflight bug NEVER blocks an agent turn).
 */
export async function runAgentPreflightFor(
  userText: string,
  options: AgentPreflightOptions = {},
): Promise<string> {
  if (!userText || !userText.trim()) return "";
  try {
    const result = await runAgentPreflightRaw(userText, options);
    return result.hint;
  } catch {
    // Preflight is best-effort. A bug here must never block a turn.
    return "";
  }
}

/**
 * Same as `runAgentPreflightFor` but returns the full
 * `EnginePreflightResult` for callers that want the routed primary +
 * fallbacks (e.g. F.1.b telemetry, or the gateway emitting an
 * `engineAttempt` frame to the Flutter chip).
 */
export async function runAgentPreflightRaw(
  userText: string,
  options: AgentPreflightOptions = {},
): Promise<EnginePreflightResult> {
  const task = parseTaskIntent(userText);
  const synthesized = synthesizeForegroundFromHints(task.hints);
  // When the prompt clearly names a desktop app (system / office / ide
  // family), assume UIA is reachable -- the user's host is desktop
  // Windows, accessibility APIs work. Without this, shell beats
  // ufo-uia on every system task because ufo-uia.score() drops to 0.2
  // when uia.available=false, suppressing the hint that would have
  // helped the LLM pick run_desktop_task for "open notepad and write
  // a program".
  const assumeUiaAvailable =
    synthesized.assumedFamily === "system" ||
    synthesized.assumedFamily === "office" ||
    synthesized.assumedFamily === "ide";
  const baseProbes: ContextScannerProbes = options.probes ?? {
    foreground: async (): Promise<ProcessContext | null> => synthesized.process,
    uia: async () => ({
      available: assumeUiaAvailable,
      rootChildCount: assumeUiaAvailable ? 5 : 0,
      estimatedDepth: assumeUiaAvailable ? 3 : 0,
    }),
    browser: async () => synthesized.browser,
    history: async () =>
      (options.history ?? {}) as Record<EngineId, EngineHistory | undefined>,
    visionCapable: () => false,
  };
  return preflight({
    userText,
    engines: options.engines ?? defaultEngines(),
    probes: baseProbes,
  });
}

/**
 * Build a fake `ProcessContext` (and `BrowserContext` when relevant) from
 * the task intent's hints. The scanner's `classifyAppFamily()` then maps
 * the process name to the right family, so the score table gives a
 * sensible routing even without a real foreground probe.
 */
function synthesizeForegroundFromHints(hints: ReadonlyArray<string>): {
  process: ProcessContext;
  browser:
    | { kind: "chromium" | "firefox" | "webkit" | string; domAvailable: boolean; activeTabUrl?: string }
    | undefined;
  assumedFamily: AppFamily | null;
} {
  const family = inferAppFamilyFromHints(hints);
  const exeHint = hints.find((h) => h.endsWith(".exe"));
  const urlHint = hints.find(
    (h) => h.startsWith("http://") || h.startsWith("https://"),
  );

  const processName = pickProcessName(family, exeHint, urlHint);
  const process: ProcessContext = {
    name: processName,
    exePath: "",
    pid: -1,
  };
  // Synthesize a browser context when the family says we're in a browser,
  // OR a URL was named. domAvailable=true is the optimistic guess: if a
  // real browser is active, browser-use's CDP probe would find a DOM.
  const browser =
    family === "browser" || urlHint !== undefined
      ? {
          kind: "chromium" as const,
          domAvailable: true,
          activeTabUrl: urlHint,
        }
      : undefined;
  return { process, browser, assumedFamily: family };
}

function pickProcessName(
  family: AppFamily | null,
  exeHint: string | undefined,
  urlHint: string | undefined,
): string {
  if (exeHint) return exeHint;
  if (urlHint) return "chrome.exe"; // best-default for "open https://..."
  switch (family) {
    case "browser":
      return "chrome.exe";
    case "office":
      return "winword.exe";
    case "ide":
      return "code.exe";
    case "game":
      return "steam.exe";
    case "system":
      return "explorer.exe";
    case "media":
      return "vlc.exe";
    case "unknown":
    case null:
    default:
      return "";
  }
}
