import type { DexConfig } from "../../config/types.openclaw.js";

export function makeModelFallbackCfg(overrides: Partial<DexConfig> = {}): DexConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as DexConfig;
}
