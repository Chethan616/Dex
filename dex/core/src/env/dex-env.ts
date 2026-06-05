/**
 * Canonical reader for `DEX_*` environment variables with a one-cycle
 * `OPENCLAW_*` fallback. Users upgrading from OpenClaw keep working without
 * touching their shell profile; the first fallback per legacy name emits a
 * single stderr deprecation hint so the migration is visible.
 *
 * Design notes (Phase B.3):
 *   - Hot-path safe: the common case (DEX_X set) is one property read. The
 *     fallback adds a Set lookup + one extra property read, all sub-µs.
 *   - Deprecation logging is process-global and per-legacy-name, so a single
 *     warning fires per env var per process, not once per call.
 *   - `warn` is injectable so tests assert without polluting real stderr.
 *   - `__resetDexEnvDeprecationCacheForTests` resets the cache; not exported
 *     from any package barrel and not intended for production use.
 */

const DEPRECATION_LOGGED = new Set<string>();
const DEX_PREFIX = "DEX_";
const LEGACY_PREFIX = "OPENCLAW_";

export interface DexEnvOptions {
  /** Source environment. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Sink for the deprecation message. Defaults to `process.stderr.write`. */
  warn?: (message: string) => void;
}

export function dexEnv(name: string, options?: DexEnvOptions): string | undefined {
  // Fast path: production callers pass no `options`. Reading `process.env`
  // directly here keeps the function monomorphic (single argument shape) so
  // V8 can inline it. Splitting the slow path into its own helper keeps the
  // top of the function tiny and predictable for the hot DEX_X-set case.
  if (options === undefined) {
    const direct = process.env[name];
    if (direct !== undefined) return direct;
    if (!name.startsWith(DEX_PREFIX)) return undefined;
    return resolveLegacyFallback(name, process.env, undefined);
  }

  const env = options.env ?? process.env;
  const direct = env[name];
  if (direct !== undefined) return direct;
  if (!name.startsWith(DEX_PREFIX)) return undefined;
  return resolveLegacyFallback(name, env, options.warn);
}

function resolveLegacyFallback(
  name: string,
  env: NodeJS.ProcessEnv,
  warn: ((message: string) => void) | undefined,
): string | undefined {
  const legacy = LEGACY_PREFIX + name.slice(DEX_PREFIX.length);
  const fallback = env[legacy];
  if (fallback === undefined) return undefined;
  if (!DEPRECATION_LOGGED.has(legacy)) {
    DEPRECATION_LOGGED.add(legacy);
    const message =
      `[dex] ${legacy} is deprecated; use ${name} instead. Falling back for this run.\n`;
    if (warn !== undefined) {
      warn(message);
    } else {
      process.stderr.write(message);
    }
  }
  return fallback;
}

/**
 * Test-only: clear the per-process deprecation cache so subsequent fallbacks
 * re-emit the warning. Never call from production code.
 */
export function __resetDexEnvDeprecationCacheForTests(): void {
  DEPRECATION_LOGGED.clear();
}
