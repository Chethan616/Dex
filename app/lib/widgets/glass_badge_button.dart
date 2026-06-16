// GlassBadgeButton — the circular liquid-glass icon badge that is Dex's
// shared "actiony + round" control, modelled on macOS Tahoe Spotlight's
// trailing icon badges (App Store / folder / layers / files).
//
// Wraps the package GlassIconButton, which already ships the squash/stretch
// jelly press physics + a directional glow. We render it at premium quality
// with a clear-crystal tint so the whole set (spotlight badges, composer
// toolbar, vision + voice control bars) reads as one material — and a tap
// visibly springs + (optionally) glows.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class GlassBadgeButton extends StatelessWidget {
  const GlassBadgeButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.tooltip,
    this.iconColor,
    this.glowColor,
    this.size = 44,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final Color? iconColor;

  /// When set, the jelly press also blooms this colour (e.g. the accent on
  /// the send button so a tap glows).
  final Color? glowColor;
  final double size;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final button = MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      child: GlassIconButton(
        icon: Icon(
          icon,
          size: size * 0.42,
          color: iconColor ?? (enabled ? DexColors.text : DexColors.textFaint),
        ),
        onPressed: onTap,
        size: size,
        useOwnLayer: true,
        quality: GlassQuality.premium,
        glowColor: glowColor,
        settings: const LiquidGlassSettings(
          glassColor: Color.fromRGBO(255, 255, 255, 0.12),
          blur: 10,
          thickness: 16,
          glowIntensity: 0.5,
        ),
      ),
    );
    if (tooltip == null) return button;
    return Tooltip(message: tooltip!, child: button);
  }
}
