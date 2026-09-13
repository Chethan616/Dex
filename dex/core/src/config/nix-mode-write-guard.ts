import { resolveIsNixMode } from "./paths.js";

export const NIX_DEX_AGENT_FIRST_URL = "https://github.com/openclaw/nix-openclaw#quick-start";
export const DEX_NIX_OVERVIEW_URL = "https://docs.dex.run/install/nix";

export class NixModeConfigMutationError extends Error {
  readonly code = "DEX_NIX_MODE_CONFIG_IMMUTABLE";

  constructor(params: { configPath?: string } = {}) {
    super(formatNixModeConfigMutationMessage(params));
    this.name = "NixModeConfigMutationError";
  }
}

export function formatNixModeConfigMutationMessage(params: { configPath?: string } = {}): string {
  return [
    "Config is managed by Nix (`DEX_NIX_MODE=1`), so OpenClaw treats openclaw.json as immutable.",
    "This usually means nix-openclaw, the first-party Nix distribution, or another Nix-managed package set this mode.",
    ...(params.configPath ? [`Config path: ${params.configPath}`] : []),
    "Do not run setup, onboarding, openclaw update, plugin install/update/uninstall/enable, doctor repair/token-generation, or config set against this file.",
    "Edit the Nix source for this install instead. For nix-openclaw, edit `programs.openclaw.config` or `instances.<name>.config`, then rebuild with Home Manager or NixOS.",
    `Agent-first Nix setup: ${NIX_DEX_AGENT_FIRST_URL}`,
    `OpenClaw Nix overview: ${DEX_NIX_OVERVIEW_URL}`,
  ].join("\n");
}

export function assertConfigWriteAllowedInCurrentMode(
  params: {
    configPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): void {
  if (!resolveIsNixMode(params.env)) {
    return;
  }
  throw new NixModeConfigMutationError({ configPath: params.configPath });
}
