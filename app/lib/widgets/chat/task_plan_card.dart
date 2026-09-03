// Live task-plan checklist. Renders ConversationStore.plan (from the agent's
// `update_plan` tool) so the user watches concrete steps tick off instead of
// a blank "thinking…". Pending = hollow circle, in-progress = pulsing accent
// dot, completed = check.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/models/plan_step.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';

class TaskPlanCard extends StatelessWidget {
  const TaskPlanCard({super.key, required this.steps});

  final List<PlanStep> steps;

  @override
  Widget build(BuildContext context) {
    if (steps.isEmpty) return const SizedBox.shrink();
    final done = steps
        .where((s) =>
            s.status == PlanStepStatus.completed ||
            s.status == PlanStepStatus.failed)
        .length;
    final failed = steps.where((s) => s.status == PlanStepStatus.failed).length;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: DexGlass(
        radius: 14,
        padding: const EdgeInsets.all(DexSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(LucideIcons.list_checks,
                    size: 15, color: DexColors.accent),
                const SizedBox(width: DexSpace.xs),
                Text('Plan',
                    style: DexType.label(color: DexColors.text)),
                const Spacer(),
                // The failures, said out loud. "3/3" beside two red rows
                // reads as success at a glance, which is the one thing it
                // was not.
                if (failed > 0) ...[
                  Text(
                    failed == 1 ? '1 failed' : '$failed failed',
                    style: DexType.caption(color: DexColors.stateError),
                  ),
                  const SizedBox(width: DexSpace.sm),
                ],
                Text('$done/${steps.length}',
                    style: DexType.caption(color: DexColors.textFaint)),
              ],
            ),
            const SizedBox(height: DexSpace.sm),
            for (final s in steps) _StepRow(step: s),
          ],
        ),
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.step});
  final PlanStep step;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (step.status) {
      PlanStepStatus.completed => (LucideIcons.circle_check, DexColors.accent),
      PlanStepStatus.failed => (LucideIcons.circle_x, DexColors.stateError),
      PlanStepStatus.inProgress => (LucideIcons.loader, DexColors.stateActing),
      PlanStepStatus.pending => (LucideIcons.circle, DexColors.textFaint),
    };
    final textColor = switch (step.status) {
      PlanStepStatus.completed => DexColors.textDim,
      PlanStepStatus.failed => DexColors.text,
      PlanStepStatus.inProgress => DexColors.text,
      PlanStepStatus.pending => DexColors.textFaint,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 14, color: color),
          ),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: Text(
              step.label,
              style: DexType.caption(color: textColor).copyWith(
                decoration: step.status == PlanStepStatus.completed
                    ? TextDecoration.lineThrough
                    : null,
                decorationColor: DexColors.textFaint,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
