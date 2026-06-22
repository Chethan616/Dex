// Shared glass settings for every dropdown / popmenu body so they all read
// as the same rich dark-navy frosted menu (the voice-settings Language
// dropdown look) regardless of what's behind them. Without a fixed tint a
// GlassMenu samples its backdrop and looks washed-out light over the bright
// home, but dark over the settings panels — this pins it dark everywhere.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

/// Count of liquid-glass menus currently open. LivingBackground freezes its
/// fog repaint while this is > 0 so the menu's open-morph gets the full GPU
/// frame budget (no full-screen fog re-paint competing for it). The fog drift
/// is a 60s loop, so freezing it for the ~400ms a menu is open is invisible.
/// Wire every GlassMenu through [FogAwareGlassMenu] to keep this accurate.
final ValueNotifier<int> kGlassMenuOpenCount = ValueNotifier<int>(0);

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

/// A [GlassMenu] that bumps [kGlassMenuOpenCount] while it's open, so the
/// living-background fog freezes during the morph and the open animation
/// stays buttery. A drop-in replacement for GlassMenu — same look, same
/// premium morph, just balanced open/close accounting.
class FogAwareGlassMenu extends StatefulWidget {
  const FogAwareGlassMenu({
    super.key,
    required this.triggerBuilder,
    required this.items,
    this.menuWidth = 200,
    this.quality,
    this.settings,
  });

  final Widget Function(BuildContext context, VoidCallback toggle)
      triggerBuilder;
  final List<Widget> items;
  final double menuWidth;
  final GlassQuality? quality;
  final LiquidGlassSettings? settings;

  @override
  State<FogAwareGlassMenu> createState() => _FogAwareGlassMenuState();
}

class _FogAwareGlassMenuState extends State<FogAwareGlassMenu> {
  bool _open = false;

  void _setOpen(bool open) {
    if (open == _open) return;
    _open = open;
    kGlassMenuOpenCount.value += open ? 1 : -1;
  }

  @override
  void dispose() {
    if (_open) kGlassMenuOpenCount.value -= 1;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GlassMenu(
      menuWidth: widget.menuWidth,
      quality: widget.quality,
      settings: widget.settings,
      onClose: () => _setOpen(false),
      triggerBuilder: (ctx, toggle) => widget.triggerBuilder(ctx, () {
        _setOpen(!_open);
        toggle();
      }),
      items: widget.items,
    );
  }
}
