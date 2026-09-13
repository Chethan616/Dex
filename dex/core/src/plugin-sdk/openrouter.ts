// Manual facade. Keep loader boundary explicit.
import type { ModelProviderConfig, DexConfig } from "../config/types.js";
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

type FacadeModule = {
  applyOpenrouterConfig: (cfg: DexConfig) => DexConfig;
  applyOpenrouterProviderConfig: (cfg: DexConfig) => DexConfig;
  buildOpenrouterProvider: () => ModelProviderConfig;
  OPENROUTER_DEFAULT_MODEL_REF: string;
};

function loadFacadeModule(): FacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<FacadeModule>({
    dirName: "openrouter",
    artifactBasename: "api.js",
  });
}
export const applyOpenrouterConfig: FacadeModule["applyOpenrouterConfig"] = ((...args) =>
  loadFacadeModule()["applyOpenrouterConfig"](...args)) as FacadeModule["applyOpenrouterConfig"];
export const applyOpenrouterProviderConfig: FacadeModule["applyOpenrouterProviderConfig"] = ((
  ...args
) =>
  loadFacadeModule()["applyOpenrouterProviderConfig"](
    ...args,
  )) as FacadeModule["applyOpenrouterProviderConfig"];
export const buildOpenrouterProvider: FacadeModule["buildOpenrouterProvider"] = ((...args) =>
  loadFacadeModule()["buildOpenrouterProvider"](
    ...args,
  )) as FacadeModule["buildOpenrouterProvider"];
export const OPENROUTER_DEFAULT_MODEL_REF: FacadeModule["OPENROUTER_DEFAULT_MODEL_REF"] =
  loadFacadeModule()["OPENROUTER_DEFAULT_MODEL_REF"];
