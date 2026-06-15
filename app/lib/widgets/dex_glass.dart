// DexGlass — the app's standard frosted panel, backed by a real liquid
// glass surface (GlassContainer with its own layer) instead of the old
// BackdropFilter + gradient recipe. One widget so every panel (dialogs,
// composer, cards, sheets, the spotlight overlay) shares the same glass.
//
// Use this anywhere the app previously did:
//   DecoratedBox(glossyShadow) > RefractiveEdge > BackdropFilter > Container(glossyGradient)
//
// On Windows/Skia this renders the lightweight glass shader; on Impeller
// it's the full pipeline. Either way it's the real thing, not a gradient.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class DexGlass extends StatelessWidget {
  const DexGlass({
    super.key,
    required this.child,
    this.radius = 16,
    this.padding,
    this.shadow = true,
    this.tint,
    this.glow = 0.0,
  });

  final Widget child;

  /// Corner radius of the superellipse glass shape.
  final double radius;

  /// Inner padding applied inside the glass.
  final EdgeInsetsGeometry? padding;

  /// Drop a soft elevation shadow under the panel (off for inline chrome).
  final bool shadow;

  /// Optional glass tint override. Defaults to a cool dark navy matching
  /// Dex's deep-navy dark palette so white text stays readable through
  /// the frost (the package's near-transparent default is too light over
  /// the app background).
  final Color? tint;

  /// Interaction glow intensity (0 = none).
  final double glow;

  @override
  Widget build(BuildContext context) {
    Widget panel = GlassContainer(
      useOwnLayer: true,
      shape: LiquidRoundedSuperellipse(borderRadius: radius),
      padding: padding,
      glowIntensity: glow,
      settings: LiquidGlassSettings(
        glassColor: tint ?? const Color.fromRGBO(10, 18, 42, 0.32),
        blur: 14,
        thickness: 16,
      ),
      child: child,
    );
    if (shadow) {
      panel = DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          boxShadow: DexSurface.glossyShadow,
        ),
        child: panel,
      );
    }
    return panel;
  }
}
