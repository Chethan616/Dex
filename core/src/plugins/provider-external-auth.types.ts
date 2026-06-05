import type { AuthProfileStore, OAuthCredential } from "../agents/auth-profiles/types.js";
import type { ModelProviderAuthMode, ModelProviderConfig } from "../config/types.js";
import type { DexConfig } from "../config/types.openclaw.js";

export type ProviderResolveSyntheticAuthContext = {
  config?: DexConfig;
  provider: string;
  providerConfig?: ModelProviderConfig;
};

export type ProviderSyntheticAuthResult = {
  apiKey: string;
  source: string;
  mode: Exclude<ModelProviderAuthMode, "aws-sdk">;
  expiresAt?: number;
};

export type ProviderResolveExternalAuthProfilesContext = {
  config?: DexConfig;
  agentDir?: string;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
  store: AuthProfileStore;
};

export type ProviderResolveExternalOAuthProfilesContext =
  ProviderResolveExternalAuthProfilesContext;

export type ProviderExternalAuthProfile = {
  profileId: string;
  credential: OAuthCredential;
  persistence?: "runtime-only" | "persisted";
};

export type ProviderExternalOAuthProfile = ProviderExternalAuthProfile;
