import { randomUUID } from "node:crypto";
import type {
  SessionsPatchParams,
  SessionsPatchResult,
} from "../../packages/gateway-protocol/src/index.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import type {
  ChatSendOptions,
  TuiAgentsList,
  TuiBackend,
  TuiEvent,
  TuiModelChoice,
  TuiSessionList,
} from "../tui/tui-backend.js";
import { runTui as defaultRunTui } from "../tui/tui.js";
import type { ConchAssistantPlanner } from "./assistant.js";
import { approvalQuestion, isYes, resolveConchOperation } from "./dialogue.js";
import {
  executeConchOperation,
  isPersistentConchOperation,
  type ConchCommandDeps,
  type ConchOperation,
} from "./operations.js";
import { formatConchStartupMessage, loadConchOverview } from "./overview.js";

type RunTui = typeof defaultRunTui;

export type ConchTuiOptions = {
  yes?: boolean;
  deps?: ConchCommandDeps;
  planWithAssistant?: ConchAssistantPlanner;
  runTui?: RunTui;
};

type ConchHistoryMessage = {
  role: "assistant" | "user";
  content: Array<{ type: "text"; text: string }>;
  timestamp: number;
};

type CaptureRuntime = RuntimeEnv & {
  read: () => string;
};

const CONCH_AGENT_ID = "conch";
const CONCH_SESSION_KEY = buildAgentMainSessionKey({ agentId: CONCH_AGENT_ID });

function createCaptureRuntime(): CaptureRuntime {
  const lines: string[] = [];
  return {
    log: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
    exit: (code) => {
      throw new Error(`Conch operation exited with code ${String(code)}`);
    },
    read: () => lines.join("\n").trim(),
  };
}

async function loadOverviewForTui(opts: ConchTuiOptions) {
  if (opts.deps?.loadOverview) {
    return await opts.deps.loadOverview();
  }
  return await loadConchOverview();
}

function message(role: "assistant" | "user", text: string): ConchHistoryMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function splitModelRef(ref: string | undefined): { provider?: string; model?: string } {
  const trimmed = ref?.trim();
  if (!trimmed) {
    return {};
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return { model: trimmed };
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

class ConchTuiBackend implements TuiBackend {
  readonly connection = { url: "conch local" };

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onGap?: (info: { expected: number; received: number }) => void;

  private seq = 0;
  private pending: ConchOperation | null = null;
  private handoff: ConchOperation | null = null;
  private requestExit: (() => void) | null = null;
  private readonly messages: ConchHistoryMessage[] = [];

  constructor(
    private readonly opts: ConchTuiOptions,
    welcome: string,
  ) {
    this.messages.push(message("assistant", welcome));
  }

  setRequestExitHandler(handler: () => void): void {
    this.requestExit = handler;
  }

  consumeHandoff(): ConchOperation | null {
    const handoff = this.handoff;
    this.handoff = null;
    return handoff;
  }

  start(): void {
    queueMicrotask(() => {
      this.onConnected?.();
    });
  }

  stop(): void {
    // The enclosing TUI owns terminal shutdown; Conch has no transport to close.
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    const runId = opts.runId ?? randomUUID();
    const text = opts.message.trim();
    this.messages.push(message("user", opts.message));
    void this.respond(runId, opts.sessionKey, text);
    return { runId };
  }

  async abortChat(): Promise<{ ok: boolean; aborted: boolean }> {
    return { ok: true, aborted: false };
  }

  async loadHistory(): Promise<{
    sessionId: string;
    messages: ConchHistoryMessage[];
    thinkingLevel: string;
    verboseLevel: string;
  }> {
    return {
      sessionId: "conch",
      messages: this.messages,
      thinkingLevel: "off",
      verboseLevel: "off",
    };
  }

  async listSessions(): Promise<TuiSessionList> {
    const overview = await loadOverviewForTui(this.opts);
    const model = splitModelRef(overview.defaultModel);
    return {
      ts: Date.now(),
      path: "conch",
      count: 1,
      defaults: {
        model: model.model ?? null,
        modelProvider: model.provider ?? null,
        contextTokens: null,
      },
      sessions: [
        {
          key: CONCH_SESSION_KEY,
          sessionId: "conch",
          displayName: "Conch",
          updatedAt: Date.now(),
          thinkingLevel: "off",
          verboseLevel: "off",
          model: model.model,
          modelProvider: model.provider,
        },
      ],
    };
  }

  async listAgents(): Promise<TuiAgentsList> {
    return {
      defaultId: CONCH_AGENT_ID,
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: CONCH_AGENT_ID, name: "Conch" }],
    };
  }

  async patchSession(opts: SessionsPatchParams): Promise<SessionsPatchResult> {
    const model = splitModelRef(typeof opts.model === "string" ? opts.model : undefined);
    return {
      ok: true,
      path: "conch",
      key: CONCH_SESSION_KEY,
      entry: {
        sessionId: "conch",
        displayName: "Conch",
        updatedAt: Date.now(),
        ...(model.model ? { model: model.model } : {}),
        ...(model.provider ? { modelProvider: model.provider } : {}),
      },
      resolved: {
        modelProvider: model.provider,
        model: model.model,
      },
    };
  }

  async resetSession(): Promise<{ ok: boolean }> {
    this.pending = null;
    const overview = await loadOverviewForTui(this.opts);
    this.messages.splice(
      0,
      this.messages.length,
      message("assistant", formatConchStartupMessage(overview)),
    );
    return { ok: true };
  }

  async getGatewayStatus(): Promise<string> {
    const overview = await loadOverviewForTui(this.opts);
    return overview.gateway.reachable ? "Gateway reachable" : "Gateway unreachable";
  }

  async listModels(): Promise<TuiModelChoice[]> {
    return [];
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private emit(event: string, payload: unknown): void {
    this.onEvent?.({
      event,
      payload,
      seq: this.nextSeq(),
    });
  }

  private emitFinal(runId: string, sessionKey: string, text: string): void {
    const assistant = message(
      "assistant",
      text || "Conch listened and found nothing to change.",
    );
    this.messages.push(assistant);
    this.emit("chat", {
      runId,
      sessionKey,
      state: "final",
      message: assistant,
    });
  }

  private emitError(runId: string, sessionKey: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.emit("chat", {
      runId,
      sessionKey,
      state: "error",
      errorMessage,
    });
  }

  private async respond(runId: string, sessionKey: string, text: string): Promise<void> {
    try {
      const reply = await this.resolveReply(text);
      this.emitFinal(runId, sessionKey, reply);
    } catch (error) {
      this.emitError(runId, sessionKey, error);
    }
  }

  private async resolveReply(text: string): Promise<string> {
    if (this.pending) {
      if (isYes(text)) {
        const pending = this.pending;
        this.pending = null;
        const capture = createCaptureRuntime();
        await executeConchOperation(pending, capture, {
          approved: true,
          deps: this.opts.deps,
        });
        return capture.read() || "Applied. Audit entry written.";
      }
      this.pending = null;
      return "Skipped. No barnacles on config today.";
    }

    const capture = createCaptureRuntime();
    const operation = await resolveConchOperation(text, capture, this.opts);

    if (operation.kind === "open-tui") {
      this.handoff = operation;
      queueMicrotask(() => this.requestExit?.());
      return "Opening your normal agent TUI. Use /conch there to come back.";
    }

    if (isPersistentConchOperation(operation) && !this.opts.yes) {
      this.pending = operation;
      await executeConchOperation(operation, capture, {
        approved: false,
        deps: this.opts.deps,
      });
      return [capture.read(), approvalQuestion(operation)].filter(Boolean).join("\n\n");
    }

    await executeConchOperation(operation, capture, {
      approved: this.opts.yes === true || !isPersistentConchOperation(operation),
      deps: this.opts.deps,
    });
    const reply = capture.read();
    if (operation.kind === "none" && reply.includes("Bye.")) {
      queueMicrotask(() => this.requestExit?.());
    }
    return reply;
  }
}

export async function runConchTui(
  opts: ConchTuiOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  let nextInput: string | undefined;
  for (;;) {
    const overview = await loadOverviewForTui(opts);
    const backend = new ConchTuiBackend(opts, formatConchStartupMessage(overview));
    const runTui = opts.runTui ?? defaultRunTui;
    await runTui({
      local: true,
      session: CONCH_SESSION_KEY,
      historyLimit: 200,
      backend,
      config: {},
      title: "dex conch",
      ...(nextInput ? { message: nextInput } : {}),
    });

    const handoff = backend.consumeHandoff();
    if (!handoff) {
      return;
    }
    const result = await executeConchOperation(handoff, runtime, {
      approved: true,
      deps: opts.deps,
    });
    nextInput = result.nextInput;
    if (!nextInput?.trim()) {
      return;
    }
  }
}
