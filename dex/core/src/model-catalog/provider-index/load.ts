import { normalizeDexProviderIndex } from "./normalize.js";
import { DEX_PROVIDER_INDEX } from "./openclaw-provider-index.js";
import type { DexProviderIndex } from "./types.js";

export function loadDexProviderIndex(
  source: unknown = DEX_PROVIDER_INDEX,
): DexProviderIndex {
  return normalizeDexProviderIndex(source) ?? { version: 1, providers: {} };
}
