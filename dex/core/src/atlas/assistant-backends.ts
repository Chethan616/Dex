import type { DexConfig } from "../config/types.openclaw.js";
import type { AtlasOverview } from "./overview.js";

const ATLAS_CLAUDE_CLI_MODEL = "claude-opus-4-8";
const ATLAS_CODEX_MODEL = "gpt-5.5";

type AtlasLocalPlannerBackend = {
  kind: "claude-cli" | "codex-app-server";
  label: string;
  runner: "cli" | "embedded";
  provider: string;
  model: string;
  buildConfig: (workspaceDir: string) => DexConfig;
};

const CLAUDE_CLI_BACKEND: AtlasLocalPlannerBackend = {
  kind: "claude-cli",
  label: `claude-cli/${ATLAS_CLAUDE_CLI_MODEL}`,
  runner: "cli",
  provider: "claude-cli",
  model: ATLAS_CLAUDE_CLI_MODEL,
  buildConfig: (workspaceDir) =>
    buildCliPlannerConfig(workspaceDir, `claude-cli/${ATLAS_CLAUDE_CLI_MODEL}`),
};

const CODEX_APP_SERVER_BACKEND: AtlasLocalPlannerBackend = {
  kind: "codex-app-server",
  label: `openai/${ATLAS_CODEX_MODEL} via codex`,
  runner: "embedded",
  provider: "openai",
  model: ATLAS_CODEX_MODEL,
  buildConfig: buildCodexAppServerPlannerConfig,
};

export function selectAtlasLocalPlannerBackends(
  overview: AtlasOverview,
): AtlasLocalPlannerBackend[] {
  const backends: AtlasLocalPlannerBackend[] = [];
  if (overview.tools.claude.found) {
    backends.push(CLAUDE_CLI_BACKEND);
  }
  if (overview.tools.codex.found) {
    backends.push(CODEX_APP_SERVER_BACKEND);
  }
  return backends;
}

function buildCliPlannerConfig(workspaceDir: string, modelRef: string): DexConfig {
  return {
    agents: {
      defaults: {
        workspace: workspaceDir,
        model: { primary: modelRef },
      },
    },
  };
}

function buildCodexAppServerPlannerConfig(workspaceDir: string): DexConfig {
  return {
    agents: {
      defaults: {
        workspace: workspaceDir,
        model: { primary: `openai/${ATLAS_CODEX_MODEL}` },
      },
    },
    plugins: {
      entries: {
        codex: { enabled: true },
      },
    },
  };
}
