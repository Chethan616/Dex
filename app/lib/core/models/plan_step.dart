// A single step in the agent's live task plan, emitted by dex-core's
// `update_plan` tool (`plan: [{step, status}]`). Rendered as a checklist so
// the user watches concrete progress instead of a blank "thinking…".

enum PlanStepStatus { pending, inProgress, completed }

class PlanStep {
  const PlanStep({required this.label, required this.status});

  final String label;
  final PlanStepStatus status;

  static PlanStepStatus _statusFrom(Object? raw) {
    switch ((raw as String?)?.trim()) {
      case 'in_progress':
        return PlanStepStatus.inProgress;
      case 'completed':
        return PlanStepStatus.completed;
      default:
        return PlanStepStatus.pending;
    }
  }

  /// Parse the `plan` array from an `update_plan` tool call's args.
  /// Tolerant of missing/odd fields — a malformed entry just becomes a
  /// pending step with whatever label text is present.
  static List<PlanStep> listFromArgs(Object? planArg) {
    if (planArg is! List) return const <PlanStep>[];
    final out = <PlanStep>[];
    for (final e in planArg) {
      if (e is! Map) continue;
      final label = (e['step'] ?? e['label'] ?? e['text'] ?? '').toString().trim();
      if (label.isEmpty) continue;
      out.add(PlanStep(label: label, status: _statusFrom(e['status'])));
    }
    return out;
  }
}
