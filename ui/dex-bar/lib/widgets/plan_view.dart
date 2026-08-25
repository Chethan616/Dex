import 'package:flutter/material.dart';

import '../core/models.dart';
import '../theme/tokens.dart';

/// The plan DAG, laid out as dependency waves — each row is a set of steps that
/// can run in parallel; arrows down mean "waits for the row above".
class PlanView extends StatelessWidget {
  const PlanView({super.key, required this.plan, required this.events});

  final ExecutionPlanModel plan;
  final List<DexEvent> events;

  /// Group steps into waves by dependency depth — the same order the
  /// Orchestrator dispatches them in.
  List<List<ExecutionStepModel>> get _waves {
    final byId = {for (final s in plan.steps) s.id: s};
    final depth = <String, int>{};

    int resolve(String id, Set<String> seen) {
      if (depth.containsKey(id)) return depth[id]!;
      if (!seen.add(id)) return 0; // cycle guard
      final step = byId[id];
      if (step == null || step.dependsOn.isEmpty) return depth[id] = 0;
      final d = step.dependsOn.map((p) => resolve(p, seen)).reduce((a, b) => a > b ? a : b) + 1;
      return depth[id] = d;
    }

    for (final s in plan.steps) {
      resolve(s.id, <String>{});
    }

    final maxDepth = depth.values.isEmpty ? 0 : depth.values.reduce((a, b) => a > b ? a : b);
    return List.generate(
      maxDepth + 1,
      (d) => plan.steps.where((s) => depth[s.id] == d).toList(),
    );
  }

  String _statusOf(String stepId) {
    String status = 'pending';
    for (final e in events) {
      if (e.stepId != stepId) continue;
      switch (e.type) {
        case 'selecting':
        case 'executing':
        case 'retrying':
          status = 'running';
        case 'awaiting':
          status = 'awaiting';
        case 'done':
          status = 'done';
        case 'failed':
          status = 'failed';
        case 'cancelled':
          status = 'cancelled';
      }
    }
    return status;
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final waves = _waves;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(plan.intent, style: DexType.sans(size: 14, color: t.text, weight: FontWeight.w500)),
        const SizedBox(height: DexTokens.spaceXs),
        Text(
          'Tier ${plan.tier} · ${plan.steps.length} step${plan.steps.length == 1 ? '' : 's'} · ${waves.length} wave${waves.length == 1 ? '' : 's'}',
          style: DexType.mono(size: 10.5, color: t.textFaint),
        ),
        const SizedBox(height: DexTokens.spaceMd),
        for (var i = 0; i < waves.length; i++) ...[
          if (i > 0)
            Padding(
              padding: const EdgeInsets.only(left: 14, top: 2, bottom: 2),
              child: Icon(Icons.arrow_downward_rounded, size: 13, color: t.borderStrong),
            ),
          Wrap(
            spacing: DexTokens.spaceSm,
            runSpacing: DexTokens.spaceSm,
            children: [
              for (final step in waves[i])
                _StepNode(step: step, status: _statusOf(step.id)),
            ],
          ),
        ],
      ],
    );
  }
}

class _StepNode extends StatelessWidget {
  const _StepNode({required this.step, required this.status});

  final ExecutionStepModel step;
  final String status;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    final (Color color, IconData icon) = switch (status) {
      'done' => (t.eventColor('done'), Icons.check_rounded),
      'failed' => (t.eventColor('failed'), Icons.close_rounded),
      'running' => (t.eventColor('executing'), Icons.play_arrow_rounded),
      'awaiting' => (t.eventColor('awaiting'), Icons.pause_rounded),
      'cancelled' => (t.eventColor('cancelled'), Icons.block_rounded),
      _ => (t.textFaint, Icons.circle_outlined),
    };

    return AnimatedContainer(
      duration: DexTokens.durMed,
      constraints: const BoxConstraints(maxWidth: 300),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: status == 'pending' ? t.surface : color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DexTokens.radiusMd),
        border: Border.all(
          color: status == 'pending' ? t.border : color.withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: DexTokens.spaceSm),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  step.action,
                  overflow: TextOverflow.ellipsis,
                  style: DexType.mono(size: 11.5, color: t.text, weight: FontWeight.w500),
                ),
                Text(
                  '${step.id} · ${step.capability} · T${step.confirmationTier}',
                  overflow: TextOverflow.ellipsis,
                  style: DexType.mono(size: 9.5, color: t.textFaint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
