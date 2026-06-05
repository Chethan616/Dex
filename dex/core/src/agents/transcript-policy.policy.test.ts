import { describe, expect, it, vi } from "vitest";
import type { DexConfig } from "../config/config.js";
import { resolveTranscriptPolicy } from "./transcript-policy.js";

vi.mock("../plugins/provider-hook-runtime.js", () => ({
  resolveProviderRuntimePlugin: vi.fn(({ provider }: { provider?: string }) =>
    provider === "mistral"
      ? {
          buildReplayPolicy: () => ({
            sanitizeToolCallIds: true,
            toolCallIdMode: "strict9",
          }),
        }
      : undefined,
  ),
}));

const MISTRAL_PLUGIN_CONFIG = {
  plugins: {
    entries: {
      mistral: { enabled: true },
    },
  },
} as DexConfig;

function createProviderRuntimeSmokeContext(): {
  config: DexConfig;
  env: NodeJS.ProcessEnv;
  workspaceDir: string;
} {
  const env = { ...process.env };
  delete env.DEX_BUNDLED_PLUGINS_DIR;
  delete env.DEX_SKIP_PROVIDERS;
  delete env.DEX_SKIP_CHANNELS;
  delete env.DEX_SKIP_CRON;
  delete env.DEX_TEST_MINIMAL_GATEWAY;
  return {
    config: {},
    env,
    workspaceDir: process.cwd(),
  };
}

describe("resolveTranscriptPolicy provider replay policy", () => {
  it("uses images-only sanitization without tool-call id rewriting for OpenAI models", () => {
    const policy = resolveTranscriptPolicy({
      ...createProviderRuntimeSmokeContext(),
      provider: "openai",
      modelId: "gpt-4o",
      modelApi: "openai",
    });
    expect(policy.sanitizeMode).toBe("images-only");
    expect(policy.sanitizeToolCallIds).toBe(false);
    expect(policy.toolCallIdMode).toBeUndefined();
  });

  it("uses strict9 tool-call sanitization for Mistral-family models", () => {
    const policy = resolveTranscriptPolicy({
      ...createProviderRuntimeSmokeContext(),
      provider: "mistral",
      modelId: "mistral-large-latest",
      config: MISTRAL_PLUGIN_CONFIG,
    });
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe("strict9");
  });
});
