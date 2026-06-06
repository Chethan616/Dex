import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { extractAssistantText } from "../agents/embedded-agent-utils.js";
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
} from "../agents/simple-completion-runtime.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { selectAtlasLocalPlannerBackends } from "./assistant-backends.js";
import {
  ATLAS_ASSISTANT_MAX_TOKENS,
  ATLAS_ASSISTANT_SYSTEM_PROMPT,
  ATLAS_ASSISTANT_TIMEOUT_MS,
  buildAtlasAssistantUserPrompt,
  parseAtlasAssistantPlanText,
  type AtlasAssistantPlan,
} from "./assistant-prompts.js";
import type { AtlasOverview } from "./overview.js";

export {
  buildAtlasAssistantUserPrompt,
  parseAtlasAssistantPlanText,
  type AtlasAssistantPlan,
} from "./assistant-prompts.js";

export type AtlasAssistantPlanner = (params: {
  input: string;
  overview: AtlasOverview;
}) => Promise<AtlasAssistantPlan | null>;

type RunCliAgentFn = typeof import("../agents/cli-runner.js").runCliAgent;
type RunEmbeddedAgentFn = typeof import("../agents/embedded-agent.js").runEmbeddedAgent;
type ReadConfigFileSnapshotFn = typeof readConfigFileSnapshot;
type PrepareSimpleCompletionModelForAgentFn = typeof prepareSimpleCompletionModelForAgent;
type CompleteWithPreparedSimpleCompletionModelFn = typeof completeWithPreparedSimpleCompletionModel;

export type AtlasConfiguredModelPlannerDeps = {
  readConfigFileSnapshot?: ReadConfigFileSnapshotFn;
  prepareSimpleCompletionModelForAgent?: PrepareSimpleCompletionModelForAgentFn;
  completeWithPreparedSimpleCompletionModel?: CompleteWithPreparedSimpleCompletionModelFn;
};

export type AtlasLocalRuntimePlannerDeps = {
  runCliAgent?: RunCliAgentFn;
  runEmbeddedAgent?: RunEmbeddedAgentFn;
  createTempDir?: () => Promise<string>;
  removeTempDir?: (dir: string) => Promise<void>;
};

export type AtlasPlannerDeps = AtlasConfiguredModelPlannerDeps &
  AtlasLocalRuntimePlannerDeps;

export async function planAtlasCommand(params: {
  input: string;
  overview: AtlasOverview;
  deps?: AtlasPlannerDeps;
}): Promise<AtlasAssistantPlan | null> {
  const configured = await planAtlasCommandWithConfiguredModel(params);
  if (configured) {
    return configured;
  }
  return await planAtlasCommandWithLocalRuntime(params);
}

export async function planAtlasCommandWithConfiguredModel(params: {
  input: string;
  overview: AtlasOverview;
  deps?: AtlasConfiguredModelPlannerDeps;
}): Promise<AtlasAssistantPlan | null> {
  const input = params.input.trim();
  if (!input) {
    return null;
  }
  const snapshot = await (params.deps?.readConfigFileSnapshot ?? readConfigFileSnapshot)();
  if (!snapshot.exists || !snapshot.valid) {
    return null;
  }
  const cfg = snapshot.runtimeConfig ?? snapshot.config;
  const agentId = resolveDefaultAgentId(cfg);
  const prepared = await (
    params.deps?.prepareSimpleCompletionModelForAgent ?? prepareSimpleCompletionModelForAgent
  )({
    cfg,
    agentId,
    allowMissingApiKeyModes: ["aws-sdk"],
  });
  if ("error" in prepared) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATLAS_ASSISTANT_TIMEOUT_MS);
  try {
    const response = await (
      params.deps?.completeWithPreparedSimpleCompletionModel ??
      completeWithPreparedSimpleCompletionModel
    )({
      model: prepared.model,
      auth: prepared.auth,
      context: {
        systemPrompt: ATLAS_ASSISTANT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildAtlasAssistantUserPrompt({
              input,
              overview: params.overview,
            }),
            timestamp: Date.now(),
          },
        ],
      },
      options: {
        maxTokens: ATLAS_ASSISTANT_MAX_TOKENS,
        signal: controller.signal,
      },
    });
    const parsed = parseAtlasAssistantPlanText(extractAssistantText(response));
    if (!parsed) {
      return null;
    }
    return {
      ...parsed,
      modelLabel: `${prepared.selection.provider}/${prepared.selection.modelId}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function planAtlasCommandWithLocalRuntime(params: {
  input: string;
  overview: AtlasOverview;
  deps?: AtlasLocalRuntimePlannerDeps;
}): Promise<AtlasAssistantPlan | null> {
  const input = params.input.trim();
  if (!input) {
    return null;
  }
  const backends = selectAtlasLocalPlannerBackends(params.overview);
  if (backends.length === 0) {
    return null;
  }
  const prompt = buildAtlasAssistantUserPrompt({
    input,
    overview: params.overview,
  });

  for (const backend of backends) {
    try {
      const rawText = await runLocalRuntimePlanner(backend, {
        prompt,
        deps: params.deps,
      });
      const parsed = parseAtlasAssistantPlanText(rawText);
      if (parsed) {
        return {
          ...parsed,
          modelLabel: backend.label,
        };
      }
    } catch {
      // Try the next locally available runtime. Atlas must keep booting.
    }
  }
  return null;
}

async function runLocalRuntimePlanner(
  backend: ReturnType<typeof selectAtlasLocalPlannerBackends>[number],
  params: {
    prompt: string;
    deps?: AtlasLocalRuntimePlannerDeps;
  },
): Promise<string | undefined> {
  const tempDir = await (params.deps?.createTempDir ?? createTempPlannerDir)();
  try {
    const runId = `atlas-planner-${randomUUID()}`;
    const sessionFile = path.join(tempDir, "session.jsonl");
    const sessionId = `${runId}-session`;
    const sessionKey = `temp:atlas-planner:${runId}`;
    switch (backend.runner) {
      case "cli": {
        const runCli = params.deps?.runCliAgent ?? (await loadRunCliAgent());
        const result = await runCli({
          sessionId,
          sessionKey,
          agentId: "atlas",
          trigger: "manual",
          sessionFile,
          workspaceDir: tempDir,
          config: backend.buildConfig(tempDir),
          prompt: params.prompt,
          provider: backend.provider,
          model: backend.model,
          timeoutMs: ATLAS_ASSISTANT_TIMEOUT_MS,
          runId,
          extraSystemPrompt: ATLAS_ASSISTANT_SYSTEM_PROMPT,
          extraSystemPromptStatic: ATLAS_ASSISTANT_SYSTEM_PROMPT,
          messageChannel: "atlas",
          messageProvider: "atlas",
          cleanupCliLiveSessionOnRunEnd: true,
        });
        return extractPlannerResultText(result);
      }
      case "embedded": {
        const runEmbedded = params.deps?.runEmbeddedAgent ?? (await loadRunEmbeddedAgent());
        const result = await runEmbedded({
          sessionId,
          sessionKey,
          agentId: "atlas",
          trigger: "manual",
          sessionFile,
          workspaceDir: tempDir,
          config: backend.buildConfig(tempDir),
          prompt: params.prompt,
          provider: backend.provider,
          model: backend.model,
          agentHarnessId: "codex",
          disableTools: true,
          toolsAllow: [],
          timeoutMs: ATLAS_ASSISTANT_TIMEOUT_MS,
          runId,
          extraSystemPrompt: ATLAS_ASSISTANT_SYSTEM_PROMPT,
          messageChannel: "atlas",
          messageProvider: "atlas",
          cleanupBundleMcpOnRunEnd: true,
        });
        return extractPlannerResultText(result);
      }
    }
    return undefined;
  } finally {
    await (params.deps?.removeTempDir ?? removeTempPlannerDir)(tempDir);
  }
}

async function createTempPlannerDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-atlas-planner-"));
}

async function removeTempPlannerDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function loadRunCliAgent(): Promise<RunCliAgentFn> {
  return (await import("../agents/cli-runner.js")).runCliAgent;
}

async function loadRunEmbeddedAgent(): Promise<RunEmbeddedAgentFn> {
  return (await import("../agents/embedded-agent.js")).runEmbeddedAgent;
}

function extractPlannerResultText(result: {
  payloads?: Array<{ text?: string }>;
  meta?: {
    finalAssistantVisibleText?: string;
    finalAssistantRawText?: string;
  };
}): string | undefined {
  return (
    result.meta?.finalAssistantVisibleText ??
    result.meta?.finalAssistantRawText ??
    result.payloads
      ?.map((payload) => payload.text?.trim())
      .filter(Boolean)
      .join("\n")
  );
}
