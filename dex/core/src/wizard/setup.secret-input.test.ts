import { describe, expect, it } from "vitest";
import type { DexConfig } from "../config/config.js";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";

function makeConfig(): DexConfig {
  return {
    secrets: {
      providers: {
        default: { source: "env" },
      },
    },
  } as DexConfig;
}

describe("resolveSetupSecretInputString", () => {
  it("resolves env-template SecretInput strings", async () => {
    const resolved = await resolveSetupSecretInputString({
      config: makeConfig(),
      value: "${DEX_GATEWAY_PASSWORD}",
      path: "gateway.auth.password",
      env: {
        DEX_GATEWAY_PASSWORD: "gateway-secret", // pragma: allowlist secret
      },
    });

    expect(resolved).toBe("gateway-secret");
  });

  it("returns plaintext strings when value is not a SecretRef", async () => {
    const resolved = await resolveSetupSecretInputString({
      config: makeConfig(),
      value: "plain-text",
      path: "gateway.auth.password",
    });

    expect(resolved).toBe("plain-text");
  });

  it("throws with path context when env-template SecretRef cannot resolve", async () => {
    await expect(
      resolveSetupSecretInputString({
        config: makeConfig(),
        value: "${DEX_GATEWAY_PASSWORD}",
        path: "gateway.auth.password",
        env: {},
      }),
    ).rejects.toThrow(
      'gateway.auth.password: failed to resolve SecretRef "env:default:DEX_GATEWAY_PASSWORD"',
    );
  });
});
