export type { ChannelPlugin, DexPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";
export type { DexConfig } from "openclaw/plugin-sdk/config-contracts";
export type {
  DexPluginService,
  DexPluginServiceContext,
  PluginLogger,
} from "openclaw/plugin-sdk/core";
export type { ResolvedQQBotAccount, QQBotAccountConfig } from "./src/types.js";
export { getQQBotRuntime, setQQBotRuntime } from "./src/bridge/runtime.js";
