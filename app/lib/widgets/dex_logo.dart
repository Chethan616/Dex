// DexLogo — the brand orb (assets/brand/dex_app_icon.png), the single
// source for the in-app brand mark. Transparent PNG, so it drops onto any
// surface (splash card, login, sidebar) without a backing plate.

import 'package:flutter/material.dart';

class DexLogo extends StatelessWidget {
  const DexLogo({super.key, this.size = 48});

  /// Edge length in logical pixels. The orb is square.
  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/brand/dex_app_icon.png',
      width: size,
      height: size,
      // The orb already carries its own soft glow + gloss; let it render at
      // native fidelity (filterQuality high so the downscale stays crisp).
      filterQuality: FilterQuality.high,
      isAntiAlias: true,
    );
  }
}
