/**
 * Context scanner — Phase C.1.
 *
 * Builds a `RuntimeContext` from cheap parallel probes so the orchestrator
 * router can pick an engine in < 100 ms. Three probes run concurrently:
 *
 *   1. Foreground-window probe   → process name + PID + exePath
 *   2. UIA-availability probe    → whether the window exposes a UIA tree
 *   3. Browser-CDP probe         → whether a Chromium/Chrome/Edge tab is
 *                                  active AND reachable via remote debugging
 *
 * Each probe is wrapped in a 50 ms timeout so a hung COM call can never
 * block routing. When a probe fails or times out, we fall back to a
 * conservative answer ("no UIA available", "no DOM available") rather than
 * blocking the scan.
 *
 * The platform implementations live in `./platform/{win32,darwin,linux}.ts`
 * — only the Win32 path is wired today. Other platforms return stubs that
 * the scorer treats as "system" / "no UIA" / "no DOM".
 */

import type {
  AppFamily,
  EngineHistory,
  EngineId,
  ProcessContext,
  RuntimeBudget,
  RuntimeContext,
  UiaContext,
  BrowserContext,
} from "./types.js";

/** Probe deadline. Anything slower is silently downgraded to its fallback. */
const DEFAULT_PROBE_TIMEOUT_MS = 50;

/** App-family table. Keys are lowercased process.name basenames. */
const APP_FAMILY_TABLE: Record<string, AppFamily> = {
  // browsers
  "chrome.exe": "browser",
  "msedge.exe": "browser",
  "firefox.exe": "browser",
  "brave.exe": "browser",
  "opera.exe": "browser",
  "vivaldi.exe": "browser",
  // office
  "winword.exe": "office",
  "excel.exe": "office",
  "powerpnt.exe": "office",
  "outlook.exe": "office",
  "onenote.exe": "office",
  // IDEs
  "code.exe": "ide",
  "cursor.exe": "ide",
  "devenv.exe": "ide",
  "idea64.exe": "ide",
  "pycharm64.exe": "ide",
  "webstorm64.exe": "ide",
  // media
  "spotify.exe": "media",
  "vlc.exe": "media",
  "obs64.exe": "media",
  // system
  "explorer.exe": "system",
  "cmd.exe": "system",
  "powershell.exe": "system",
  "wt.exe": "system",
  "notepad.exe": "system",
  "calc.exe": "system",
  "systemsettings.exe": "system",
};

/** Heuristic: known game engines / launchers. */
const GAME_PROCESS_HINTS = new Set([
  "steam.exe",
  "epicgameslauncher.exe",
  "battle.net.exe",
  "leagueclient.exe",
  "valorant.exe",
  "fortnite.exe",
  "minecraft.exe",
  "minecraftlauncher.exe",
]);

function classifyAppFamily(processName: string): AppFamily {
  const lower = processName.toLowerCase();
  if (lower in APP_FAMILY_TABLE) {
    return APP_FAMILY_TABLE[lower] as AppFamily;
  }
  if (GAME_PROCESS_HINTS.has(lower)) {
    return "game";
  }
  return "unknown";
}

/** Race a promise against a timeout. The timeout resolves to `onTimeout()`. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Probe injection — production callers omit these; tests pass mocks. */
export interface ContextScannerProbes {
  /** Foreground-window probe. Returns process info or null when unresolvable. */
  foreground?: () => Promise<ProcessContext | null>;
  /** UIA probe. Argument is the resolved process; returns availability. */
  uia?: (process: ProcessContext) => Promise<UiaContext>;
  /** Browser CDP probe. Returns browser context or undefined if no browser is active. */
  browser?: (process: ProcessContext) => Promise<BrowserContext | undefined>;
  /** History lookup. Returns per-engine history snapshots from telemetry. */
  history?: (process: ProcessContext) => Promise<Record<EngineId, EngineHistory>>;
  /** Whether the OS supports screen-capture for OmniParser-style vision. */
  visionCapable?: () => boolean;
  /** Per-probe timeout. Defaults to 50 ms. */
  timeoutMs?: number;
}

/** Empty UIA fallback — used when the probe fails or the OS isn't supported. */
const NO_UIA: UiaContext = {
  available: false,
  rootChildCount: 0,
  estimatedDepth: 0,
};

/** Stub when no foreground window can be resolved (CI, headless). */
const HEADLESS_PROCESS: ProcessContext = {
  name: "",
  exePath: "",
  pid: -1,
};

/**
 * Build a RuntimeContext from cheap parallel probes. Total wall-clock budget
 * is ~50 ms because each probe is independently timeout-bounded. The
 * `budget` argument lets the planner pass a per-task latency hint that
 * `capability-scorer.ts` reads to bias against slow engines.
 */
export async function scanRuntimeContext(
  budget: RuntimeBudget = {},
  probes: ContextScannerProbes = {},
): Promise<RuntimeContext> {
  const timeoutMs = probes.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const visionCapable = (probes.visionCapable ?? defaultVisionCapable)();

  // Probe 1: foreground process. Everything else depends on this; if it
  // times out we degrade to "system / unknown" but still return a valid ctx.
  const process =
    (await withTimeout(
      (probes.foreground ?? defaultForegroundProbe)(),
      timeoutMs,
      () => HEADLESS_PROCESS,
    )) ?? HEADLESS_PROCESS;

  const appFamily = classifyAppFamily(process.name);

  // Probes 2-4 fan out in parallel against the resolved process.
  const [uia, browser, history] = await Promise.all([
    withTimeout(
      (probes.uia ?? defaultUiaProbe)(process),
      timeoutMs,
      () => NO_UIA,
    ),
    withTimeout(
      (probes.browser ?? defaultBrowserProbe)(process),
      timeoutMs,
      () => undefined,
    ),
    withTimeout(
      (probes.history ?? defaultHistoryProbe)(process),
      timeoutMs,
      () => ({}) as Record<EngineId, EngineHistory>,
    ),
  ]);

  return {
    process,
    appFamily,
    browser,
    uia,
    visionCapable,
    history,
    budget,
  };
}

// ---- Default probes -----------------------------------------------------------
// These are intentionally stubs in C.1: the structure + timeouts + family
// classification are the real deliverable for this commit. Real Win32 /
// UIA / CDP wiring lands incrementally in later C.* commits where each
// probe gets its own platform-specific implementation under
// `./platform/{win32,darwin,linux}.ts`.

const defaultForegroundProbe = async (): Promise<ProcessContext | null> => {
  if (process.platform !== "win32") {
    return HEADLESS_PROCESS;
  }
  // TODO(C.1.a): shell out to User32.GetForegroundWindow via PowerShell
  // `Add-Type` once the broader scanner is wired into the gateway loop.
  // Until then, scan callers MUST inject `probes.foreground` so the router
  // sees real data; defaulting to HEADLESS_PROCESS keeps the scan total-
  // function but routes everything through Shell / OmniParser unknown paths.
  return HEADLESS_PROCESS;
};

const defaultUiaProbe = async (_process: ProcessContext): Promise<UiaContext> => NO_UIA;

const defaultBrowserProbe = async (
  process: ProcessContext,
): Promise<BrowserContext | undefined> => {
  const name = process.name.toLowerCase();
  if (
    name === "chrome.exe" ||
    name === "msedge.exe" ||
    name === "brave.exe" ||
    name === "vivaldi.exe" ||
    name === "opera.exe"
  ) {
    return { kind: "chromium", domAvailable: false };
  }
  if (name === "firefox.exe") {
    return { kind: "firefox", domAvailable: false };
  }
  if (name === "safari.exe") {
    return { kind: "webkit", domAvailable: false };
  }
  return undefined;
};

const defaultHistoryProbe = async (
  _process: ProcessContext,
): Promise<Record<EngineId, EngineHistory>> => ({});

const defaultVisionCapable = (): boolean => process.platform === "win32";

// ---- Export helpers used by tests --------------------------------------------

export {
  classifyAppFamily,
  withTimeout as _withTimeoutForTests,
  APP_FAMILY_TABLE as _APP_FAMILY_TABLE_FOR_TESTS,
};
