import { vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { clearPluginLoaderCache } from "../plugins/loader.js";
import { captureEnv } from "../test-utils/env.js";
import type { SecretsRuntimeEnvSnapshot } from "./runtime-openai-file-fixture.test-helper.js";
export {
  asConfig,
  createOpenAIFileRuntimeConfig,
  createOpenAIFileRuntimeFixture,
  EMPTY_LOADABLE_PLUGIN_ORIGINS,
  expectResolvedOpenAIRuntime,
  loadAuthStoreWithProfiles,
  OPENAI_ENV_KEY_REF,
  OPENAI_FILE_KEY_REF,
} from "./runtime-openai-file-fixture.test-helper.js";
export type { SecretsRuntimeEnvSnapshot } from "./runtime-openai-file-fixture.test-helper.js";
import { clearSecretsRuntimeSnapshot } from "./runtime.js";

export const SECRETS_RUNTIME_INTEGRATION_TIMEOUT_MS = 300_000;

export function beginSecretsRuntimeIsolationForTest(): SecretsRuntimeEnvSnapshot {
  const envSnapshot = captureEnv([
    "DEX_BUNDLED_PLUGINS_DIR",
    "DEX_DISABLE_BUNDLED_PLUGINS",
    "DEX_VERSION",
  ]);
  delete process.env.DEX_BUNDLED_PLUGINS_DIR;
  delete process.env.DEX_VERSION;
  return envSnapshot;
}

export function endSecretsRuntimeIsolationForTest(envSnapshot: SecretsRuntimeEnvSnapshot) {
  vi.restoreAllMocks();
  envSnapshot.restore();
  clearSecretsRuntimeSnapshot();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  clearPluginLoaderCache();
}
