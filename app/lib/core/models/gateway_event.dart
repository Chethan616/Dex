// Event frames streamed from the OpenClaw gateway over WebSocket. Shape
// verified from vendor/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts.
//
// We do NOT decode every field OpenClaw could send -- only what Dex renders.
// Anything unknown gets surfaced as a raw payload so it can be logged.

enum GatewayEventKind {
  /// Partial text from the agent's reply -- accumulate into the streaming
  /// message.
  delta,

  /// The agent's reply is complete.
  finalReply,

  /// The agent emitted a tool call (we use this to detect when
  /// run_desktop_task is about to fire so we can pop the Action Preview
  /// before execution begins -- v1 derives this from chat content; Phase 7
  /// uses an MCP-side gate event).
  toolCall,

  /// The tool returned -- we surface this as action steps in the
  /// conversation.
  toolResult,

  /// Gateway broadcasted an approval request.
  approvalRequested,

  /// Error / aborted -- terminal.
  error,
  aborted,

  /// Anything else -- raw payload preserved for the log.
  other,
}

class GatewayEvent {
  final GatewayEventKind kind;
  final String runId;
  final String? sessionKey;
  final String? deltaText;
  final Map<String, dynamic>? raw;
  final DateTime ts;

  GatewayEvent({
    required this.kind,
    required this.runId,
    this.sessionKey,
    this.deltaText,
    this.raw,
    DateTime? ts,
  }) : ts = ts ?? DateTime.now();
}
