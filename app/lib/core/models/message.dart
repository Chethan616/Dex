// A chat message in the Dex conversation. Three speakers:
//   - human  (the user)
//   - agent  (OpenClaw -> Claude prose responses)
//   - action (UFO2 -- a group of executed steps, rendered as a card)
//
// The agent speaker covers ordinary natural-language assistant replies.
// The action speaker is reserved for grouped action_step lines that came
// out of a run_desktop_task call.

import 'action_step.dart';

enum MessageSpeaker { human, agent, action }

class Message {
  final String id;
  final MessageSpeaker speaker;
  final String? text;            // present for human + agent
  final List<ActionStep>? steps; // present for action
  final String? appHint;         // optional app label on action cards
  final DateTime ts;
  final bool streaming;          // true while delta frames are still arriving

  const Message({
    required this.id,
    required this.speaker,
    required this.ts,
    this.text,
    this.steps,
    this.appHint,
    this.streaming = false,
  });

  Message copyWith({
    String? text,
    List<ActionStep>? steps,
    bool? streaming,
  }) => Message(
        id: id,
        speaker: speaker,
        ts: ts,
        text: text ?? this.text,
        steps: steps ?? this.steps,
        appHint: appHint,
        streaming: streaming ?? this.streaming,
      );
}
