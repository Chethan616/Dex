import { normalizeOptionalString } from "@dexagent/normalization-core/string-coerce";

export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    normalizeOptionalString(env.DEX_CONTAINER_HINT) ||
    normalizeOptionalString(env.DEX_CONTAINER) ||
    null
  );
}
