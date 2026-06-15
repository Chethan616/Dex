// Pill-shaped dropdown trigger that opens a liquid-glass GlassMenu — the
// one with the iOS-26 teardrop morph (premium; falls back to standard on
// Skia). A check sits next to the active option. Used by every Settings
// dropdown + the voice-mode language picker, so all of them morph.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class GlossyDropdown extends StatelessWidget {
  const GlossyDropdown({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.width = 240,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final double width;

  @override
  Widget build(BuildContext context) {
    return GlassMenu(
      quality: GlassQuality.premium,
      menuWidth: width,
      triggerBuilder: (context, toggle) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: toggle,
          child: GlassContainer(
            useOwnLayer: true,
            shape: const LiquidRoundedSuperellipse(borderRadius: 10),
            settings: const LiquidGlassSettings(
              glassColor: Color.fromRGBO(20, 34, 68, 0.4),
              blur: 8,
              thickness: 10,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md, vertical: DexSpace.sm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(value,
                      style: DexType.label(color: DexColors.text),
                      overflow: TextOverflow.ellipsis),
                ),
                const SizedBox(width: DexSpace.sm),
                const Icon(LucideIcons.chevron_down,
                    size: 14, color: DexColors.textDim),
              ],
            ),
          ),
        ),
      ),
      items: [
        for (final o in options)
          GlassMenuItem(
            title: o,
            icon: o == value
                ? const Icon(LucideIcons.check, color: DexColors.accent)
                : null,
            onTap: () => onChanged(o),
          ),
      ],
    );
  }
}
