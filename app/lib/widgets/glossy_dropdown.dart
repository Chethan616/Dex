// Pill-shaped dropdown trigger that opens a liquid-glass GlassMenu — the
// one with the iOS-26 teardrop morph (premium; falls back to standard on
// Skia). A check sits next to the active option. Used by every Settings
// dropdown + the voice-mode language picker, so all of them morph.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';
import 'menu_glass.dart';

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
      settings: kDexMenuGlass,
      triggerBuilder: (context, toggle) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: toggle,
          child: GlassContainer(
            useOwnLayer: true,
            quality: GlassQuality.minimal,
            shape: const LiquidRoundedSuperellipse(borderRadius: 10),
            settings: const LiquidGlassSettings(
              glassColor: kDexMenuAccentSurface,
              blur: 10,
              thickness: 12,
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
                    size: 14, color: DexColors.accent),
              ],
            ),
          ),
        ),
      ),
      items: [
        for (final o in options)
          GlassMenuItem(
            title: o,
            // Selected option: accent check + accent text (the voice-settings
            // Language dropdown look). No background pill.
            icon: o == value
                ? const Icon(LucideIcons.check, color: DexColors.accent)
                : null,
            titleStyle:
                o == value ? DexType.label(color: DexColors.accent) : null,
            onTap: () => onChanged(o),
          ),
      ],
    );
  }
}
