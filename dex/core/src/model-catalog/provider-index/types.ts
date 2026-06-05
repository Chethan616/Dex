import type { ModelCatalogProvider } from "@dexagent/model-catalog-core/model-catalog-types";

export type DexProviderIndexPluginInstall = {
  clawhubSpec?: string;
  npmSpec?: string;
  defaultChoice?: "clawhub" | "npm";
  minHostVersion?: string;
  expectedIntegrity?: string;
};

export type DexProviderIndexPlugin = {
  id: string;
  package?: string;
  source?: string;
  install?: DexProviderIndexPluginInstall;
};

export type DexProviderIndexProviderAuthChoice = {
  method: string;
  choiceId: string;
  choiceLabel: string;
  choiceHint?: string;
  assistantPriority?: number;
  assistantVisibility?: "visible" | "manual-only";
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  optionKey?: string;
  cliFlag?: string;
  cliOption?: string;
  cliDescription?: string;
  onboardingScopes?: readonly ("text-inference" | "image-generation" | "music-generation")[];
};

export type DexProviderIndexProvider = {
  id: string;
  name: string;
  plugin: DexProviderIndexPlugin;
  docs?: string;
  categories?: readonly string[];
  authChoices?: readonly DexProviderIndexProviderAuthChoice[];
  previewCatalog?: ModelCatalogProvider;
};

export type DexProviderIndex = {
  version: number;
  providers: Readonly<Record<string, DexProviderIndexProvider>>;
};
