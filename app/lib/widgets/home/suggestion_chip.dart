// Rounded pill chip used on the empty-home suggestion row. Hover scales
// it up a touch + lifts the surface; press scales it back down. Both
// animations use DexMotion.spring so the chip feels Apple-y -- a light
// overshoot on settle instead of a flat ease.

import 'package:flutter/material.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';

class SuggestionChip extends StatefulWidget {
  const SuggestionChip({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  State<SuggestionChip> createState() => _SuggestionChipState();
}

class _SuggestionChipState extends State<SuggestionChip> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final scale = reduce
        ? 1.0
        : _pressed
            ? 0.96
            : _hovered
                ? 1.04
                : 1.0;
    final surfaceAlpha = _hovered
        ? DexSurface.acrylicAlpha
        : DexSurface.acrylicAlphaQuiet;
    final borderColor = _hovered
        ? DexColors.accent.withValues(alpha: 0.55)
        : DexColors.border;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() {
        _hovered = false;
        _pressed = false;
      }),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _pressed = true),
        onTapUp: (_) => setState(() => _pressed = false),
        onTapCancel: () => setState(() => _pressed = false),
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: scale,
          duration: DexMotion.respecting(context, DexMotion.hover),
          curve: DexMotion.respectingCurve(context, DexMotion.spring),
          child: AnimatedContainer(
            duration: DexMotion.respecting(context, DexMotion.hover),
            curve: DexMotion.respectingCurve(context, DexMotion.gentle),
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.lg, vertical: DexSpace.sm,
            ),
            decoration: BoxDecoration(
              color: DexColors.surface2.withValues(alpha: surfaceAlpha),
              borderRadius: DexRadius.rpill,
              border: Border.all(color: borderColor),
            ),
            child: Text(widget.label, style: DexType.label(color: DexColors.text)),
          ),
        ),
      ),
    );
  }
}
