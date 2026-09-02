// A chat message in the Dex conversation. Four speakers:
//   - human    (the user)
//   - agent    (Dex brain -> Claude prose responses)
//   - action   (UFO2 / browser-use -- a group of executed steps, rendered as a card)
//   - toolChip (Gemini-style "Claude picked tool X" inline announcement, v1.1)
//
// The toolChip and action speakers share a `callId` so the chip and the
// rich Action card can be correlated and updated together.

import 'action_step.dart';
import 'engine.dart';

enum MessageSpeaker { human, agent, action, toolChip }

enum ToolChipState { running, done, failed, denied }

class Message {
  final String id;
  final MessageSpeaker speaker;
  final String? text;            // present for human + agent
  final List<ActionStep>? steps; // present for action
  final String? appHint;         // optional app label on action cards
  final DateTime ts;
  final bool streaming;          // true while delta frames are still arriving

  // ----- toolChip fields (v1.1 + C.7-flutter) -------------------------------
  /// The task this message reports on, when it reports on one.
  ///
  /// Needed so feedback can be recorded against something. Without it, a
  /// thumbs-up is a click with nowhere to go — which is what it was.
  final String? requestId;
  final String? callId;          // correlates chip <-> action card + result
  final String? toolId;          // raw MCP tool name; routed through tool_registry
  final String? toolGoal;        // short, truncated label for the chip
  final ToolChipState? chipState;
  /// Orchestrator engine inferred from `toolId` (C.7-flutter). The chip and
  /// the Live panel both render an engine pill when this is non-null.
  final EngineId? engine;

  const Message({
    required this.id,
    required this.speaker,
    required this.ts,
    this.text,
    this.steps,
    this.appHint,
    this.streaming = false,
    this.requestId,
    this.callId,
    this.toolId,
    this.toolGoal,
    this.chipState,
    this.engine,
  });

  Message copyWith({
    String? text,
    List<ActionStep>? steps,
    bool? streaming,
    ToolChipState? chipState,
  }) => Message(
        id: id,
        speaker: speaker,
        ts: ts,
        text: text ?? this.text,
        steps: steps ?? this.steps,
        appHint: appHint,
        streaming: streaming ?? this.streaming,
        callId: callId,
        toolId: toolId,
        toolGoal: toolGoal,
        chipState: chipState ?? this.chipState,
        engine: engine,
      );
}
