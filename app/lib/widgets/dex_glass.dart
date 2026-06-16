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
//
// `rim: false` swaps the liquid surface for a PLAIN frosted panel (a bare
// BackdropFilter + a near-opaque tint + a hairline border) with NO liquid
// specular/edge highlight at all. Large surfaces that sit over the animated
// fog (the settings panel, the composer) use this — the moving specular rim
// re-samples the drifting backdrop every frame and reads as a "vibrating"
// edge light, so for those we drop the rim entirely.

import 'dart:ui';

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
    this.rim = true,
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

  /// Interaction glow intensity (0 = none). Only meaningful with [rim].
  final double glow;

  /// When false, render a plain frosted surface with NO liquid specular /
  /// edge rim — kills the "vibrating" edge light on big surfaces sitting
  /// over the animated fog.
  final bool rim;

  @override
  Widget build(BuildContext context) {
    Widget panel;
    if (rim) {
      panel = GlassContainer(
        useOwnLayer: true,
        shape: LiquidRoundedSuperellipse(borderRadius: radius),
        padding: padding,
        glowIntensity: glow,
        // Minimal quality = a plain BackdropFilter frost + specular rim, with
        // ZERO custom shader invocations. The standard/premium shader re-samples
        // the (animated) backdrop on every frame + on hover rebuilds, which made
        // the edge light shimmer/jitter as the cursor moved inside panels.
        // Minimal is a stable frosted panel — the right call for large static
        // surfaces. Interactive bits (chips/buttons) keep their own reactivity.
        quality: GlassQuality.minimal,
        settings: LiquidGlassSettings(
          glassColor: tint ?? const Color.fromRGBO(12, 20, 44, 0.55),
          blur: 18,
          thickness: 14,
        ),
        child: child,
      );
    } else {
      // Plain frosted panel — no liquid specular, so a drifting backdrop
      // can't make the edge "vibrate". A touch more opaque than the rim
      // variant so the fog behind doesn't bleed through and shimmer.
      final r = BorderRadius.circular(radius);
      panel = ClipRRect(
        borderRadius: r,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 22, sigmaY: 22),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: tint ?? const Color.fromRGBO(12, 20, 44, 0.74),
              borderRadius: r,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.06),
              ),
            ),
            child: child,
          ),
        ),
      );
    }
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
