const COMMON_LIVE_ENV_NAMES = [
  "DEX_AGENT_RUNTIME",
  "DEX_CONFIG_PATH",
  "DEX_GATEWAY_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEX_SKIP_BROWSER_CONTROL_SERVER",
  "DEX_SKIP_CANVAS_HOST",
  "DEX_SKIP_CHANNELS",
  "DEX_SKIP_CRON",
  "DEX_SKIP_GMAIL_WATCHER",
  "DEX_STATE_DIR",
] as const;

export type LiveEnvSnapshot = Record<string, string | undefined>;

export function snapshotLiveEnv(extraNames: readonly string[] = []): LiveEnvSnapshot {
  const snapshot: LiveEnvSnapshot = {};
  for (const name of [...COMMON_LIVE_ENV_NAMES, ...extraNames]) {
    snapshot[name] = process.env[name];
  }
  return snapshot;
}

export function restoreLiveEnv(snapshot: LiveEnvSnapshot): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
