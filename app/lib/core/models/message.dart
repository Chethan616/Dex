// A chat message in the Dex conversation. Four speakers:
//   - human    (the user)
//   - agent    (OpenClaw -> Claude prose responses)
//   - action   (UFO2 / browser-use -- a group of executed steps, rendered as a card)
//   - toolChip (Gemini-style "Claude picked tool X" inline announcement, v1.1)
//
// The toolChip and action speakers share a `callId` so the chip and the
// rich Action card can be correlated and updated together.

import 'action_step.dart';

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

  // ----- toolChip fields (v1.1) ---------------------------------------------
  final String? callId;          // correlates chip <-> action card + result
  final String? toolId;          // raw MCP tool name; routed through tool_registry
  final String? toolGoal;        // short, truncated label for the chip
  final ToolChipState? chipState;

  const Message({
    required this.id,
    required this.speaker,
    required this.ts,
    this.text,
    this.steps,
    this.appHint,
    this.streaming = false,
    this.callId,
    this.toolId,
    this.toolGoal,
    this.chipState,
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
      );
}
