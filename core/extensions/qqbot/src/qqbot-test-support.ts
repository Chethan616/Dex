import type { DexConfig } from "openclaw/plugin-sdk/config-contracts";

export function makeQqbotSecretRefConfig(): DexConfig {
  return {
    channels: {
      qqbot: {
        appId: "123456",
        clientSecret: {
          source: "env",
          provider: "default",
          id: "QQBOT_CLIENT_SECRET",
        },
      },
    },
  } as DexConfig;
}

export function makeQqbotDefaultAccountConfig(): DexConfig {
  return {
    channels: {
      qqbot: {
        defaultAccount: "bot2",
        accounts: {
          bot2: { appId: "123456" },
        },
      },
    },
  } as DexConfig;
}
