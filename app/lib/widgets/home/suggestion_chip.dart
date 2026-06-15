// Rounded pill chip used on the empty-home suggestion row. Now a real
// liquid-glass chip (GlassChip) — it brings its own hover/press jelly
// physics and frosted surface. Sits over the home background (not nested
// inside another glass surface), which is exactly where the package says
// glass belongs.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../theme/tokens.dart';

class SuggestionChip extends StatelessWidget {
  const SuggestionChip({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GlassChip(
      label: label,
      onTap: onTap,
      labelStyle: DexType.label(color: DexColors.text),
    );
  }
}
