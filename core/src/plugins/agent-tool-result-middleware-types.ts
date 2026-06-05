import type { AgentToolResult } from "../agents/runtime/index.js";

export type DexAgentToolResult<TResult = unknown> = AgentToolResult<TResult>;

export type AgentToolResultMiddlewareRuntime = "openclaw" | "codex";
/** @deprecated Use AgentToolResultMiddlewareRuntime. */
export type AgentToolResultMiddlewareHarness = AgentToolResultMiddlewareRuntime | "codex-app-server";

export type AgentToolResultMiddlewareEvent = {
  threadId?: string;
  turnId?: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  cwd?: string;
  isError?: boolean;
  result: DexAgentToolResult;
};

export type AgentToolResultMiddlewareContext = {
  runtime: AgentToolResultMiddlewareRuntime;
  /** @deprecated Use runtime. */
  harness?: AgentToolResultMiddlewareRuntime;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
};

export type AgentToolResultMiddlewareResult = {
  result: DexAgentToolResult;
};

export type AgentToolResultMiddleware = (
  event: AgentToolResultMiddlewareEvent,
  ctx: AgentToolResultMiddlewareContext,
) => Promise<AgentToolResultMiddlewareResult | void> | AgentToolResultMiddlewareResult | void;

export type AgentToolResultMiddlewareOptions = {
  runtimes?: AgentToolResultMiddlewareRuntime[];
  /** @deprecated Use runtimes. */
  harnesses?: AgentToolResultMiddlewareHarness[];
};
