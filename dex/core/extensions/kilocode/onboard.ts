import {
  createModelCatalogPresetAppliers,
  type DexConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { buildKilocodeProvider } from "./provider-catalog.js";
import { KILOCODE_BASE_URL, KILOCODE_DEFAULT_MODEL_REF } from "./provider-models.js";

export { KILOCODE_BASE_URL, KILOCODE_DEFAULT_MODEL_REF };

const kilocodePresetAppliers = createModelCatalogPresetAppliers({
  primaryModelRef: KILOCODE_DEFAULT_MODEL_REF,
  resolveParams: (_cfg: DexConfig) => ({
    providerId: "kilocode",
    api: "openai-completions",
    baseUrl: KILOCODE_BASE_URL,
    catalogModels: buildKilocodeProvider().models ?? [],
    aliases: [{ modelRef: KILOCODE_DEFAULT_MODEL_REF, alias: "Kilo Gateway" }],
  }),
});

export function applyKilocodeProviderConfig(cfg: DexConfig): DexConfig {
  return kilocodePresetAppliers.applyProviderConfig(cfg);
}

export function applyKilocodeConfig(cfg: DexConfig): DexConfig {
  return kilocodePresetAppliers.applyConfig(cfg);
}
