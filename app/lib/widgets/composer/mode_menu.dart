// Floating menu that drops up from the mode pill on the composer. Now
// routes through GlossyMenu so the popup picks up the same glassy
// gradient + edge highlight + spring entry as the composer card.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import '../glossy_menu.dart';
import 'composer_mode.dart';

class ModeMenu {
  static Future<ComposerMode?> show({
    required BuildContext context,
    required Offset anchor,
    required ComposerMode current,
  }) {
    return GlossyMenu.show<ComposerMode>(
      context: context,
      anchor: anchor,
      width: 280,
      entries: <GlossyMenuEntry<ComposerMode>>[
        for (final m in ComposerMode.values)
          GlossyMenuItem<ComposerMode>(
            value: m,
            child: _ModeRow(mode: m, selected: m == current),
          ),
      ],
    );
  }
}

class _ModeRow extends StatelessWidget {
  const _ModeRow({required this.mode, required this.selected});
  final ComposerMode mode;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Row(
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
    );
  }
}
