import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
  type DexConfig,
} from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): DexConfig {
  return getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig();
}
