// Floating menu that drops down from the mode pill on the composer.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import 'composer_mode.dart';

class ModeMenu {
  static Future<ComposerMode?> show({
    required BuildContext context,
    required Offset anchor,
    required ComposerMode current,
  }) {
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    return showMenu<ComposerMode>(
      context: context,
      position: RelativeRect.fromSize(
        Rect.fromLTWH(anchor.dx, anchor.dy, 0, 0),
        overlay.size,
      ),
      color: DexColors.surface2,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rmd,
        side: const BorderSide(color: DexColors.border, width: 1),
      ),
      items: ComposerMode.values
          .map(
            (m) => PopupMenuItem<ComposerMode>(
              value: m,
              padding: const EdgeInsets.symmetric(
                horizontal: DexSpace.md, vertical: DexSpace.sm,
              ),
              child: _ModeRow(mode: m, selected: m == current),
            ),
          )
          .toList(growable: false),
    );
  }
}

class _ModeRow extends StatelessWidget {
  const _ModeRow({required this.mode, required this.selected});
  final ComposerMode mode;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 280,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            mode.icon,
            size: 16,
            color: selected ? DexColors.accent : DexColors.textDim,
          ),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  mode.label,
                  style: DexType.label(
                    color: selected ? DexColors.accent : DexColors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  mode.description,
                  style: DexType.caption(color: DexColors.textFaint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
