// The Action Preview -- the soul of the app. Amber border while pending,
// mono steps, Approve (accent) / Deny. Highest-contrast element by design.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../core/models/action_preview.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'action_step.dart';
import 'dex_glass.dart';

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
    // Two-shell structure: outer amber-stroked container preserves the
    // design.md "needs your attention" signal; the inner RefractiveEdge
    // + glossy gradient gives the same apple-grade glass treatment the
    // rest of the chrome uses. Amber stays the loudest element so the
    // user's eye still lands here first.
    return AnimatedContainer(
      duration: DexMotion.respecting(context, DexMotion.medium),
      curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      decoration: BoxDecoration(
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.stateAwaiting, width: 1.5),
        boxShadow: DexSurface.glossyShadow,
      ),
      // 1.5px inset to clear the amber stroke before the refractive rim
      // starts, so the two stack visibly rather than overlap.
      padding: const EdgeInsets.all(1.5),
      child: DexGlass(
        radius: 10,
        shadow: false,
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
      ),
    );
  }
}
