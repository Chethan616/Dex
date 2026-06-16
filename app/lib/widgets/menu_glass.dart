// Shared glass settings for every dropdown / popmenu body so they all read
// as the same rich dark-navy frosted menu (the voice-settings Language
// dropdown look) regardless of what's behind them. Without a fixed tint a
// GlassMenu samples its backdrop and looks washed-out light over the bright
// home, but dark over the settings panels — this pins it dark everywhere.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

const Color kDexMenuTint = Color.fromRGBO(14, 24, 48, 0.82);
const Color kDexMenuAccentSurface = Color.fromRGBO(28, 56, 108, 0.74);
const Color kDexMenuAccentSurfaceHover = Color.fromRGBO(36, 72, 136, 0.88);
const Color kDexMenuAccentBorder = Color.fromRGBO(96, 165, 255, 0.36);
const Color kDexMenuAccentBorderHover = Color.fromRGBO(96, 165, 255, 0.58);

const LiquidGlassSettings kDexMenuGlass = LiquidGlassSettings(
  glassColor: kDexMenuTint,
  blur: 16,
  thickness: 12,
);

/// Translucent accent-navy glass for interactive chips / pills (suggestion
/// chips, the overlay ask pill) — lighter than the menu body so they read as
/// real liquid glass that the backdrop refracts through, paired with the
/// package's squash/stretch jelly on press.
const LiquidGlassSettings kDexChipGlass = LiquidGlassSettings(
  glassColor: Color.fromRGBO(28, 56, 108, 0.42),
  blur: 12,
  thickness: 16,
);
