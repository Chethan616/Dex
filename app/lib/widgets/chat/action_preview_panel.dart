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
  });

  final ActionPreview? preview;
  final VoidCallback onApprove;
  final VoidCallback onDeny;

  @override
  Widget build(BuildContext context) {
    final visible = preview != null;
    return AnimatedSlide(
      offset: visible ? Offset.zero : const Offset(1.05, 0),
      duration: DexMotion.respecting(context, DexMotion.slow),
      curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      child: AnimatedOpacity(
        opacity: visible ? 1 : 0,
        duration: DexMotion.respecting(context, DexMotion.medium),
        child: SizedBox(
          width: 380,
          child: Container(
            color: DexColors.bg,
            padding: const EdgeInsets.all(DexSpace.lg),
            child: visible
                ? ActionPreviewCard(
                    preview: preview!,
                    onApprove: onApprove,
                    onDeny: onDeny,
                  )
                : const SizedBox.shrink(),
          ),
        ),
      ),
    );
  }
}
