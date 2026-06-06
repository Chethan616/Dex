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
import { selectConchLocalPlannerBackends } from "./assistant-backends.js";
import {
  CONCH_ASSISTANT_MAX_TOKENS,
  CONCH_ASSISTANT_SYSTEM_PROMPT,
  CONCH_ASSISTANT_TIMEOUT_MS,
  buildConchAssistantUserPrompt,
  parseConchAssistantPlanText,
  type ConchAssistantPlan,
} from "./assistant-prompts.js";
import type { ConchOverview } from "./overview.js";

export {
  buildConchAssistantUserPrompt,
  parseConchAssistantPlanText,
  type ConchAssistantPlan,
} from "./assistant-prompts.js";

export type ConchAssistantPlanner = (params: {
  input: string;
  overview: ConchOverview;
}) => Promise<ConchAssistantPlan | null>;

type RunCliAgentFn = typeof import("../agents/cli-runner.js").runCliAgent;
type RunEmbeddedAgentFn = typeof import("../agents/embedded-agent.js").runEmbeddedAgent;
type ReadConfigFileSnapshotFn = typeof readConfigFileSnapshot;
type PrepareSimpleCompletionModelForAgentFn = typeof prepareSimpleCompletionModelForAgent;
type CompleteWithPreparedSimpleCompletionModelFn = typeof completeWithPreparedSimpleCompletionModel;

export type ConchConfiguredModelPlannerDeps = {
  readConfigFileSnapshot?: ReadConfigFileSnapshotFn;
  prepareSimpleCompletionModelForAgent?: PrepareSimpleCompletionModelForAgentFn;
  completeWithPreparedSimpleCompletionModel?: CompleteWithPreparedSimpleCompletionModelFn;
};

export type ConchLocalRuntimePlannerDeps = {
  runCliAgent?: RunCliAgentFn;
  runEmbeddedAgent?: RunEmbeddedAgentFn;
  createTempDir?: () => Promise<string>;
  removeTempDir?: (dir: string) => Promise<void>;
};

export type ConchPlannerDeps = ConchConfiguredModelPlannerDeps &
  ConchLocalRuntimePlannerDeps;

export async function planConchCommand(params: {
  input: string;
  overview: ConchOverview;
  deps?: ConchPlannerDeps;
}): Promise<ConchAssistantPlan | null> {
  const configured = await planConchCommandWithConfiguredModel(params);
  if (configured) {
    return configured;
  }
  return await planConchCommandWithLocalRuntime(params);
}

export async function planConchCommandWithConfiguredModel(params: {
  input: string;
  overview: ConchOverview;
  deps?: ConchConfiguredModelPlannerDeps;
}): Promise<ConchAssistantPlan | null> {
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
  const timer = setTimeout(() => controller.abort(), CONCH_ASSISTANT_TIMEOUT_MS);
  try {
    const response = await (
      params.deps?.completeWithPreparedSimpleCompletionModel ??
      completeWithPreparedSimpleCompletionModel
    )({
      model: prepared.model,
      auth: prepared.auth,
      context: {
        systemPrompt: CONCH_ASSISTANT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildConchAssistantUserPrompt({
              input,
              overview: params.overview,
            }),
            timestamp: Date.now(),
          },
        ],
      },
      options: {
        maxTokens: CONCH_ASSISTANT_MAX_TOKENS,
        signal: controller.signal,
      },
    });
    const parsed = parseConchAssistantPlanText(extractAssistantText(response));
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

export async function planConchCommandWithLocalRuntime(params: {
  input: string;
  overview: ConchOverview;
  deps?: ConchLocalRuntimePlannerDeps;
}): Promise<ConchAssistantPlan | null> {
  const input = params.input.trim();
  if (!input) {
    return null;
  }
  const backends = selectConchLocalPlannerBackends(params.overview);
  if (backends.length === 0) {
    return null;
  }
  const prompt = buildConchAssistantUserPrompt({
    input,
    overview: params.overview,
  });

  for (const backend of backends) {
    try {
      const rawText = await runLocalRuntimePlanner(backend, {
        prompt,
        deps: params.deps,
      });
      const parsed = parseConchAssistantPlanText(rawText);
      if (parsed) {
        return {
          ...parsed,
          modelLabel: backend.label,
        };
      }
    } catch {
      // Try the next locally available runtime. Conch must keep booting.
    }
  }
  return null;
}

async function runLocalRuntimePlanner(
  backend: ReturnType<typeof selectConchLocalPlannerBackends>[number],
  params: {
    prompt: string;
    deps?: ConchLocalRuntimePlannerDeps;
  },
): Promise<string | undefined> {
  const tempDir = await (params.deps?.createTempDir ?? createTempPlannerDir)();
  try {
    const runId = `conch-planner-${randomUUID()}`;
    const sessionFile = path.join(tempDir, "session.jsonl");
    const sessionId = `${runId}-session`;
    const sessionKey = `temp:conch-planner:${runId}`;
    switch (backend.runner) {
      case "cli": {
        const runCli = params.deps?.runCliAgent ?? (await loadRunCliAgent());
        const result = await runCli({
          sessionId,
          sessionKey,
          agentId: "conch",
          trigger: "manual",
          sessionFile,
          workspaceDir: tempDir,
          config: backend.buildConfig(tempDir),
          prompt: params.prompt,
          provider: backend.provider,
          model: backend.model,
          timeoutMs: CONCH_ASSISTANT_TIMEOUT_MS,
          runId,
          extraSystemPrompt: CONCH_ASSISTANT_SYSTEM_PROMPT,
          extraSystemPromptStatic: CONCH_ASSISTANT_SYSTEM_PROMPT,
          messageChannel: "conch",
          messageProvider: "conch",
          cleanupCliLiveSessionOnRunEnd: true,
        });
        return extractPlannerResultText(result);
      }
      case "embedded": {
        const runEmbedded = params.deps?.runEmbeddedAgent ?? (await loadRunEmbeddedAgent());
        const result = await runEmbedded({
          sessionId,
          sessionKey,
          agentId: "conch",
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
          timeoutMs: CONCH_ASSISTANT_TIMEOUT_MS,
          runId,
          extraSystemPrompt: CONCH_ASSISTANT_SYSTEM_PROMPT,
          messageChannel: "conch",
          messageProvider: "conch",
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
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-conch-planner-"));
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
