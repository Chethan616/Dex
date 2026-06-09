// The Action Preview -- the soul of the app. Amber border while pending,
// mono steps, Approve (accent) / Deny. Highest-contrast element by design.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../core/models/action_preview.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'action_step.dart';

class ActionPreviewCard extends StatelessWidget {
  const ActionPreviewCard({
    super.key,
    required this.preview,
    required this.onApprove,
    required this.onDeny,
  });

  final ActionPreview preview;
  final VoidCallback onApprove;
  final VoidCallback onDeny;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: DexMotion.respecting(context, DexMotion.medium),
      curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      decoration: BoxDecoration(
        // Keeps the amber stroke (the "needs your attention" signal
        // from design.md) but upgrades the fill from a flat surface
        // to the same glossy gradient every other floating card in
        // the app uses, so the preview reads as one family with the
        // composer / spotlight / dialogs while still standing out
        // via its border colour.
        gradient: DexSurface.glossyGradient(),
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.stateAwaiting, width: 1.5),
        boxShadow: DexSurface.glossyShadow,
      ),
      padding: const EdgeInsets.all(DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(LucideIcons.triangle_alert, size: 16, color: DexColors.stateAwaiting),
              const SizedBox(width: DexSpace.sm),
              Text(
                'Action Preview',
                style: DexType.label(color: DexColors.stateAwaiting),
                semanticsLabel: 'pending approval',
              ),
            ],
          ),
          const SizedBox(height: DexSpace.sm),
          Text(preview.title, style: DexType.heading(color: DexColors.text)),
          if (preview.appHint != null) ...[
            const SizedBox(height: 2),
            Text(preview.appHint!, style: DexType.caption(color: DexColors.textDim)),
          ],
          const Divider(height: DexSpace.xl),
          ...preview.steps.map((s) => ActionStepLine(step: s)),
          const SizedBox(height: DexSpace.lg),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: onDeny,
                child: Text('Deny',
                    style: DexType.label(color: DexColors.textDim)),
              ),
              const SizedBox(width: DexSpace.sm),
              ElevatedButton(
                onPressed: onApprove,
                child: const Text('Approve'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
