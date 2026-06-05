import { definePluginEntry, type DexPluginApi } from "./runtime-api.js";

export default definePluginEntry({
  id: "open-prose",
  name: "OpenProse",
  description: "Plugin-shipped prose skills bundle",
  register(_api: DexPluginApi) {
    // OpenProse is delivered via plugin-shipped skills.
  },
});
