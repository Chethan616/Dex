import os from "node:os";
import path from "node:path";
import { normalizeOptionalLowercaseString } from "@dexagent/normalization-core/string-coerce";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";

export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const workspaceDir = env.DEX_WORKSPACE_DIR?.trim();
  if (workspaceDir) {
    return path.resolve(workspaceDir);
  }
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.DEX_PROFILE?.trim();
  if (profile && normalizeOptionalLowercaseString(profile) !== "default") {
    return path.join(home, ".dex", `workspace-${profile}`);
  }
  return path.join(home, ".dex", "workspace");
}

export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
