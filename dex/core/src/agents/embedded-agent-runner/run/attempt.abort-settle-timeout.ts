import { parseStrictPositiveInteger } from "../../../infra/parse-finite-number.js";

type AbortSettleTimeoutEnv = Partial<
  Pick<NodeJS.ProcessEnv, "DEX_EMBEDDED_ABORT_SETTLE_TIMEOUT_MS" | "DEX_TEST_FAST">
>;

export function resolveEmbeddedAbortSettleTimeoutMs(
  env: AbortSettleTimeoutEnv = process.env,
): number {
  const override = parseStrictPositiveInteger(env.DEX_EMBEDDED_ABORT_SETTLE_TIMEOUT_MS);
  if (override !== undefined) {
    return override;
  }
  return env.DEX_TEST_FAST === "1" ? 250 : 2_000;
}
