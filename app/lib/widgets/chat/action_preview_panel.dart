// Right-edge slide-in panel that hosts the pending ActionPreviewCard. The
// Copilot reference doesn't have an analog -- Dex's trust UX requires it.

import 'package:flutter/material.dart';

import '../../core/models/action_preview.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../action_preview_card.dart';

class ActionPreviewPanel extends StatelessWidget {
  const ActionPreviewPanel({
    super.key,
    required this.preview,
    required this.onApprove,
    required this.onDeny,
    this.waiting = 1,
    this.onApproveAll,
  });

  final ActionPreview? preview;
  final VoidCallback onApprove;
  final VoidCallback onDeny;
  final int waiting;
  final VoidCallback? onApproveAll;

  @override
  Widget build(BuildContext context) {
    final visible = preview != null;
    // AnimatedSize collapses the panel to width: 0 when there's no
    // preview so the main content area gets the full remaining space
    // and centers correctly. Previously the panel reserved 380px even
    // when empty, which pulled the home greeting off-center.
    return AnimatedSize(
      duration: DexMotion.respecting(context, DexMotion.slow),
      curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      alignment: Alignment.centerLeft,
      child: visible
          ? SizedBox(
              width: 380,
              child: Container(
                color: DexColors.bg,
                padding: const EdgeInsets.all(DexSpace.lg),
                child: ActionPreviewCard(
                  waiting: waiting,
                  onApproveAll: onApproveAll,
                  preview: preview!,
                  onApprove: onApprove,
                  onDeny: onDeny,
                ),
              ),
            )
          : const SizedBox(width: 0),
    );
  }
}
