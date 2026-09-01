// v1.2 Live Tool Activity — what the user sees in the right panel when an
// MCP tool / built-in tool / engine call runs. Populated from the gateway's
// raw `toolCall` + `toolResult` events; the LLM doesn't have to narrate
// "I'm running command X" because the card already shows it. Saves tokens
// AND gives the user real-time signal during slow turns.

import 'engine.dart';

enum ToolActivityState { running, done, failed, aborted }

class ToolActivity {
  /// Correlates the call frame with the result frame (gateway `runId` or a
  /// locally-generated UUID when the gateway omits it).
  final String callId;
  /// Raw MCP tool id (`bash`, `run_desktop_task`, `parse_screen`, ...).
  final String toolId;
  /// Friendly display name from `tool_registry.dart` (`Shell`, `Windows app`,
  /// `Browser`, ...).
  final String displayName;
  /// Routed engine inferred from the tool id (`shell` / `ufo-uia` /
  /// `browser-use` / `omniparser`).
  final EngineId? engine;
  /// Full argument payload as the MCP server received it. Nullable when the
  /// gateway frame didn't include args (rare). Rendered as a mono key/value
  /// block in the ActivityCard.
  final Map<String, dynamic>? args;
  /// One-line goal description (extracted from args.goal / args.command /
  /// args.url / args.path / args.text). Shown when args is too big to
  /// inline and as the chip label in the conversation.
  final String? goalLabel;
  /// Wall-clock start. UI refreshes the elapsed-time counter every second.
  final DateTime startedAt;
  /// Output lines parsed from the tool result. For `bash` this is stdout
  /// chunks. For `run_desktop_task` this is the structured step list. Each
  /// line is rendered in mono and clipped to 200 chars.
  final List<String> outputLines;
  /// Short summary the tool returned. Bold-rendered at the top of the
  /// output area when present.
  final String? summary;
  /// True/false once the result frame lands; null while still running.
  final bool? ok;
  /// Wall-clock end. Drives the final duration footer.
  final DateTime? endedAt;
  final ToolActivityState state;

  ToolActivity({
    required this.callId,
    required this.toolId,
    required this.displayName,
    this.engine,
    this.args,
    this.goalLabel,
    required this.startedAt,
    this.outputLines = const <String>[],
    this.summary,
    this.ok,
    this.endedAt,
    this.state = ToolActivityState.running,
  });

  /// Wall-clock duration so far. Computed live during `running` state.
  Duration get duration =>
      (endedAt ?? DateTime.now()).difference(startedAt);

  ToolActivity copyWith({
    List<String>? outputLines,
    String? summary,
    bool? ok,
    DateTime? endedAt,
    ToolActivityState? state,
  }) =>
      ToolActivity(
        callId: callId,
        toolId: toolId,
        displayName: displayName,
        engine: engine,
        args: args,
        goalLabel: goalLabel,
        startedAt: startedAt,
        outputLines: outputLines ?? this.outputLines,
        summary: summary ?? this.summary,
        ok: ok ?? this.ok,
        endedAt: endedAt ?? this.endedAt,
        state: state ?? this.state,
      );
}
