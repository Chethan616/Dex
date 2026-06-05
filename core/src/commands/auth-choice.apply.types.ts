import type { DexConfig } from "../config/types.openclaw.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoice, OnboardOptions } from "./onboard-types.js";

export type ApplyAuthChoiceParams = {
  authChoice: AuthChoice;
  config: DexConfig;
  env?: NodeJS.ProcessEnv;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  agentDir?: string;
  setDefaultModel: boolean;
  preserveExistingDefaultModel?: boolean;
  agentId?: string;
  opts?: Partial<OnboardOptions>;
};

export type ApplyAuthChoiceResult = {
  config: DexConfig;
  agentModelOverride?: string;
  retrySelection?: boolean;
};
