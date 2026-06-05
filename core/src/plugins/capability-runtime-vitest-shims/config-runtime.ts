import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { DexConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): DexConfig | null {
  return null;
}
