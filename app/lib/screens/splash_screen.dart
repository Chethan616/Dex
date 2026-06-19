// Splash screen — first impression + shader warm-up.
//
// On Windows the liquid-glass widgets render on Skia, and the package's
// Impeller prewarm is skipped there, so the first real frame that paints a
// GlassContainer / DexGlass / dropdown compiles its shader on the spot —
// the "laggy until you've used it 2-3 times" jank. This splash paints those
// exact surfaces (off-screen, via a Clip.none stack) for ~2.2s while showing
// a calm branded card, so by the time the cockpit appears the shaders are
// already warm and the first interaction is smooth.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';
import '../widgets/dex_glass.dart';
import '../widgets/dex_logo.dart';
import '../widgets/glossy_dropdown.dart';
import '../widgets/living_background.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: LivingBackground(
        child: Stack(
          // Clip.none so the off-screen warm strip below actually paints
          // (and thus compiles its shaders) instead of being clipped away.
          clipBehavior: Clip.none,
          children: [
            const Positioned(left: -3000, top: 0, child: _ShaderWarmStrip()),
            Center(
              child: DexGlass(
                radius: 24,
                padding: const EdgeInsets.symmetric(
                  horizontal: 40, vertical: 32,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const DexLogo(size: 72),
                    const SizedBox(height: DexSpace.md),
                    Text('Dex', style: DexType.title(color: DexColors.text)),
                    const SizedBox(height: DexSpace.lg),
                    const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: DexColors.accent,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Off-screen row that paints one of each heavy glass surface so Skia
/// compiles their shaders during the splash, not on first interaction.
class _ShaderWarmStrip extends StatelessWidget {
  const _ShaderWarmStrip();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const DexGlass(
          radius: 16,
          padding: EdgeInsets.all(16),
          child: SizedBox(width: 80, height: 40),
        ),
        const SizedBox(width: 8),
        GlassContainer(
          useOwnLayer: true,
          quality: GlassQuality.premium,
          shape: const LiquidRoundedSuperellipse(borderRadius: 16),
          settings: const LiquidGlassSettings(
            glassColor: Color.fromRGBO(255, 255, 255, 0.10),
            blur: 10,
            thickness: 16,
            glowIntensity: 0.5,
          ),
          padding: const EdgeInsets.all(16),
          child: const SizedBox(width: 60, height: 30),
        ),
        const SizedBox(width: 8),
        GlossyDropdown(
          value: 'warm',
          options: const ['warm'],
          onChanged: (_) {},
        ),
      ],
    );
  }
}
