import {
  defineBundledChannelEntry,
  loadBundledEntryExportSync,
} from "openclaw/plugin-sdk/channel-entry-contract";
import type { DexPluginApi } from "openclaw/plugin-sdk/channel-entry-contract";
import { registerFeishuSubagentHooks } from "./subagent-hooks-api.js";

function registerFeishuDocTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuDocTools",
  });
  register(api);
}

function registerFeishuChatTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuChatTools",
  });
  register(api);
}

function registerFeishuWikiTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuWikiTools",
  });
  register(api);
}

function registerFeishuDriveTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuDriveTools",
  });
  register(api);
}

function registerFeishuPermTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuPermTools",
  });
  register(api);
}

function registerFeishuBitableTools(api: DexPluginApi) {
  const register = loadBundledEntryExportSync<(api: DexPluginApi) => void>(import.meta.url, {
    specifier: "./api.js",
    exportName: "registerFeishuBitableTools",
  });
  register(api);
}

export default defineBundledChannelEntry({
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "feishuPlugin",
  },
  secrets: {
    specifier: "./secret-contract-api.js",
    exportName: "channelSecrets",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setFeishuRuntime",
  },
  registerFull(api) {
    registerFeishuSubagentHooks(api);
    registerFeishuDocTools(api);
    registerFeishuChatTools(api);
    registerFeishuWikiTools(api);
    registerFeishuDriveTools(api);
    registerFeishuPermTools(api);
    registerFeishuBitableTools(api);
  },
});
