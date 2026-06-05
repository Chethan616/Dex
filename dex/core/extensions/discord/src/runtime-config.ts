import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
  selectApplicableRuntimeConfig,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import type { DexConfig } from "./runtime-api.js";

export function selectDiscordRuntimeConfig(inputConfig: DexConfig): DexConfig {
  return (
    selectApplicableRuntimeConfig({
      inputConfig,
      runtimeConfig: getRuntimeConfigSnapshot(),
      runtimeSourceConfig: getRuntimeConfigSourceSnapshot(),
    }) ?? inputConfig
  );
}
