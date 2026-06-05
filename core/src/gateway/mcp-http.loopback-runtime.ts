type McpLoopbackRuntime = {
  port: number;
  ownerToken: string;
  nonOwnerToken: string;
};

let activeRuntime: McpLoopbackRuntime | undefined;

export function getActiveMcpLoopbackRuntime(): McpLoopbackRuntime | undefined {
  return activeRuntime ? { ...activeRuntime } : undefined;
}

export function setActiveMcpLoopbackRuntime(runtime: McpLoopbackRuntime): void {
  activeRuntime = { ...runtime };
}

export function resolveMcpLoopbackBearerToken(
  runtime: McpLoopbackRuntime,
  senderIsOwner: boolean,
): string {
  return senderIsOwner ? runtime.ownerToken : runtime.nonOwnerToken;
}

export function clearActiveMcpLoopbackRuntimeByOwnerToken(ownerToken: string): void {
  if (activeRuntime?.ownerToken === ownerToken) {
    activeRuntime = undefined;
  }
}

export function createMcpLoopbackServerConfig(port: number) {
  return {
    mcpServers: {
      openclaw: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: "Bearer ${DEX_MCP_TOKEN}",
          "x-session-key": "${DEX_MCP_SESSION_KEY}",
          "x-openclaw-agent-id": "${DEX_MCP_AGENT_ID}",
          "x-openclaw-account-id": "${DEX_MCP_ACCOUNT_ID}",
          "x-openclaw-message-channel": "${DEX_MCP_MESSAGE_CHANNEL}",
          "x-openclaw-current-channel-id": "${DEX_MCP_CURRENT_CHANNEL_ID}",
          "x-openclaw-current-thread-ts": "${DEX_MCP_CURRENT_THREAD_TS}",
          "x-openclaw-current-message-id": "${DEX_MCP_CURRENT_MESSAGE_ID}",
          "x-openclaw-current-inbound-audio": "${DEX_MCP_CURRENT_INBOUND_AUDIO}",
          "x-openclaw-inbound-event-kind": "${DEX_MCP_INBOUND_EVENT_KIND}",
          "x-openclaw-source-reply-delivery-mode": "${DEX_MCP_SOURCE_REPLY_DELIVERY_MODE}",
        },
      },
    },
  };
}
