import type { DexConfig } from "../../config/types.openclaw.js";

export function createPerSenderSessionConfig(
  overrides: Partial<NonNullable<DexConfig["session"]>> = {},
): NonNullable<DexConfig["session"]> {
  return {
    mainKey: "main",
    scope: "per-sender",
    ...overrides,
  };
}
