// Liquid-glass back button used across the settings sub-screens (memory
// add / view, connector detail). Replaces the bare Material IconButton so
// the whole settings surface speaks one glass language.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class GlassBackButton extends StatelessWidget {
  const GlassBackButton({
    super.key,
    required this.onTap,
    this.tooltip = 'Back',
  });
  final VoidCallback onTap;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: Tooltip(
        message: tooltip,
        child: GlassIconButton(
          icon: const Icon(LucideIcons.arrow_left,
              size: 18, color: DexColors.textDim),
          onPressed: onTap,
          size: 36,
          useOwnLayer: true,
        ),
      ),
    );
  }
}
