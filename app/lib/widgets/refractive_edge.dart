// Apple-style "glass refracts the bg" edge treatment.
//
// Wraps any rounded-rect surface in a thin gradient ring that picks
// up light from the wallpaper's bottom-of-screen sky-blue glow at the
// top-left (the "lit" side) and falls into shadow at the bottom-right
// (the "shadowed" side). The effect reads as if the panel's edge
// catches and refracts the background fog -- the same trick Apple's
// NSVisualEffectView uses on macOS Materials surfaces.
//
// Usage: drop a RefractiveEdge AROUND any existing glossy surface --
// the wrapped surface keeps its decoration, this just adds the rim.
//
//   RefractiveEdge(
//     radius: DexRadius.rmd,
//     child: Container(
//       decoration: BoxDecoration(
//         gradient: DexSurface.glossyGradient(),
//         borderRadius: DexRadius.rmd,
//       ),
//       child: ...,
//     ),
//   )

import 'package:flutter/material.dart';

class RefractiveEdge extends StatelessWidget {
  const RefractiveEdge({
    super.key,
    required this.child,
    required this.radius,
    this.thickness = 1.0,
    this.intensity = 1.0,
  });

  /// The surface to wrap. Should already have its own fill / blur /
  /// child content; this widget only adds the rim around it.
  final Widget child;

  /// The OUTER border radius. The inner clip uses `radius - thickness`
  /// so the inner surface stays concentric with the rim.
  final BorderRadius radius;

  /// Rim width. Apple Materials use ~1px; spotlight + key overlays
  /// can push to 1.4-1.6 for a more present rim (see [intensity]).
  final double thickness;

  /// Multiplier on the rim's alpha. 1.0 = stock subtle treatment;
  /// 1.6 = stronger "this floats over the world" treatment used on
  /// the Spotlight overlay and Action Preview cards.
  final double intensity;

  @override
  Widget build(BuildContext context) {
    final i = intensity.clamp(0.0, 2.0);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        // Top-left → bottom-right gradient simulating a single light
        // source at upper-left. Stops:
        //   0% : bright white-alpha highlight ("lit edge")
        //   45%: faint sky-blue refraction (catches the bg glow)
        //   100%: thin shadow ("shadowed edge")
        // The white→sky-blue transition is the "glass refracting the
        // wallpaper" moment.
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            Color.fromRGBO(0xFF, 0xFF, 0xFF, 0.22 * i),
            Color.fromRGBO(0x6E, 0xA8, 0xFF, 0.14 * i),
            Color.fromRGBO(0x00, 0x00, 0x00, 0.20 * i.clamp(0.5, 1.0)),
          ],
          stops: const <double>[0.0, 0.45, 1.0],
        ),
      ),
      child: Padding(
        padding: EdgeInsets.all(thickness),
        child: ClipRRect(
          borderRadius: _shrinkRadius(radius, thickness),
          child: child,
        ),
      ),
    );
  }
}

/// Shrink each corner radius by [thickness] so the inner clip stays
/// concentric with the outer rim. Clamps at zero — radii smaller than
/// the thickness collapse to a sharp inner corner, which is correct.
BorderRadius _shrinkRadius(BorderRadius r, double thickness) {
  Radius shrink(Radius v) => Radius.elliptical(
        (v.x - thickness).clamp(0.0, double.infinity),
        (v.y - thickness).clamp(0.0, double.infinity),
      );
  return BorderRadius.only(
    topLeft: shrink(r.topLeft),
    topRight: shrink(r.topRight),
    bottomLeft: shrink(r.bottomLeft),
    bottomRight: shrink(r.bottomRight),
  );
}
