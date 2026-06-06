import type { DexConfig } from "../config/types.openclaw.js";
import type { ConchOverview } from "./overview.js";

const CONCH_CLAUDE_CLI_MODEL = "claude-opus-4-8";
const CONCH_CODEX_MODEL = "gpt-5.5";

type ConchLocalPlannerBackend = {
  kind: "claude-cli" | "codex-app-server";
  label: string;
  runner: "cli" | "embedded";
  provider: string;
  model: string;
  buildConfig: (workspaceDir: string) => DexConfig;
};

const CLAUDE_CLI_BACKEND: ConchLocalPlannerBackend = {
  kind: "claude-cli",
  label: `claude-cli/${CONCH_CLAUDE_CLI_MODEL}`,
  runner: "cli",
  provider: "claude-cli",
  model: CONCH_CLAUDE_CLI_MODEL,
  buildConfig: (workspaceDir) =>
    buildCliPlannerConfig(workspaceDir, `claude-cli/${CONCH_CLAUDE_CLI_MODEL}`),
};

const CODEX_APP_SERVER_BACKEND: ConchLocalPlannerBackend = {
  kind: "codex-app-server",
  label: `openai/${CONCH_CODEX_MODEL} via codex`,
  runner: "embedded",
  provider: "openai",
  model: CONCH_CODEX_MODEL,
  buildConfig: buildCodexAppServerPlannerConfig,
};

export function selectConchLocalPlannerBackends(
  overview: ConchOverview,
): ConchLocalPlannerBackend[] {
  const backends: ConchLocalPlannerBackend[] = [];
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
        model: { primary: `openai/${CONCH_CODEX_MODEL}` },
      },
    },
    plugins: {
      entries: {
        codex: { enabled: true },
      },
    },
  };
}
