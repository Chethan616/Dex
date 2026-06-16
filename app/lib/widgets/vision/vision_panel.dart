// Floating "share with Dex" panel. Picks a screen or app to stream to the
// agent. v1 renders the chrome only; real capture wiring lands later.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../dex_switch.dart';
import '../glass_badge_button.dart';

class VisionPanel extends StatefulWidget {
  const VisionPanel({super.key, required this.onClose});
  final VoidCallback onClose;

  @override
  State<VisionPanel> createState() => _VisionPanelState();
}

class _VisionPanelState extends State<VisionPanel> {
  bool _startWithVoice = true;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 380,
      child: DexGlass(
        radius: 14,
        padding: const EdgeInsets.all(DexSpace.lg),
        child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('Dex Vision',
                          style: DexType.heading(color: DexColors.text)),
                    ),
                    GlassBadgeButton(
                      icon: LucideIcons.x,
                      tooltip: 'Close',
                      onTap: widget.onClose,
                      size: 32,
                      iconColor: DexColors.textDim,
                    ),
                  ],
                ),
                const SizedBox(height: DexSpace.sm),
                Row(
                  children: [
                    Expanded(
                      child: Text('Start with voice',
                          style: DexType.label(color: DexColors.text)),
                    ),
                    DexSwitch(
                      value: _startWithVoice,
                      onChanged: (v) => setState(() => _startWithVoice = v),
                    ),
                  ],
                ),
                const SizedBox(height: DexSpace.md),
                Text('Share screen',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.sm),
                _Thumb(label: 'Screen 1', onTap: widget.onClose),
                const SizedBox(height: DexSpace.lg),
                Text('Share app',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.sm),
                _AppRow(name: 'Editor', onShare: widget.onClose),
                const SizedBox(height: DexSpace.xs),
                _AppRow(name: 'Browser', onShare: widget.onClose),
              ],
            ),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Liquid-glass screen preview tile. Minimal quality keeps the rim
    // stable; a faint monitor glyph reads as the share target.
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: GlassContainer(
          useOwnLayer: true,
          quality: GlassQuality.minimal,
          shape: const LiquidRoundedSuperellipse(borderRadius: 12),
          settings: const LiquidGlassSettings(
            glassColor: Color.fromRGBO(20, 34, 68, 0.38),
            blur: 14,
            thickness: 12,
          ),
          padding: const EdgeInsets.all(DexSpace.sm),
          child: SizedBox(
            height: 96,
            width: double.infinity,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(LucideIcons.monitor,
                    size: 26, color: DexColors.textDim),
                const SizedBox(height: DexSpace.sm),
                Text(label, style: DexType.label(color: DexColors.text)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AppRow extends StatelessWidget {
  const _AppRow({required this.name, required this.onShare});
  final String name;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      useOwnLayer: true,
      quality: GlassQuality.minimal,
      shape: const LiquidRoundedSuperellipse(borderRadius: 12),
      settings: const LiquidGlassSettings(
        glassColor: Color.fromRGBO(20, 34, 68, 0.32),
        blur: 12,
        thickness: 10,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.sm, vertical: DexSpace.sm,
      ),
      child: Row(
        children: [
          const Icon(LucideIcons.app_window,
              size: 16, color: DexColors.textDim),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Text(name, style: DexType.label(color: DexColors.text)),
          ),
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GlassChip(
              label: 'Share',
              onTap: onShare,
              labelStyle: DexType.label(color: DexColors.accent),
            ),
          ),
        ],
      ),
    );
  }
}
