import {
  getRuntimeConfig,
  resolveConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../config/config.js";
import type { DexConfig } from "../config/types.openclaw.js";
import { buildCleanupPlan } from "./cleanup-utils.js";

export function resolveCleanupPlanFromDisk(): {
  cfg: DexConfig;
  stateDir: string;
  configPath: string;
  oauthDir: string;
  configInsideState: boolean;
  oauthInsideState: boolean;
  workspaceDirs: string[];
} {
  const cfg = getRuntimeConfig();
  const stateDir = resolveStateDir();
  const configPath = resolveConfigPath();
  const oauthDir = resolveOAuthDir();
  const plan = buildCleanupPlan({ cfg, stateDir, configPath, oauthDir });
  return { cfg, stateDir, configPath, oauthDir, ...plan };
}
