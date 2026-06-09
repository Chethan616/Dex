// Rounded pill chip used on the empty-home suggestion row.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

class SuggestionChip extends StatelessWidget {
  const SuggestionChip({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rpill,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.lg, vertical: DexSpace.sm,
        ),
        decoration: BoxDecoration(
          color: DexColors.surface2.withValues(
            alpha: DexSurface.acrylicAlphaQuiet,
          ),
          borderRadius: DexRadius.rpill,
          border: Border.all(color: DexColors.border),
        ),
        child: Text(label, style: DexType.label(color: DexColors.text)),
      ),
    );
  }
}
