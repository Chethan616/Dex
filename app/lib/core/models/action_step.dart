// One mono line in the conversation reflecting a single thing the agent did
// or is doing inside an app -- "focus -> Excel", "select B2:B40", etc.

enum ActionStepState { queued, running, done, failed }

class ActionStep {
  final String text;
  final ActionStepState state;
  final DateTime ts;

  const ActionStep({
    required this.text,
    required this.state,
    required this.ts,
  });

  ActionStep withState(ActionStepState s) =>
      ActionStep(text: text, state: s, ts: ts);
}
