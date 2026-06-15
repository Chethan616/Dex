// Rounded liquid-glass suggestion chip. GlassChip brings the frosted
// surface + press physics; we add a hover affordance on top: the hand
// cursor + a small overshoot "jiggle" scale so it's obvious it's a
// clickable button (matches the iMessage-clone chip feel).

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../theme/tokens.dart';

class SuggestionChip extends StatefulWidget {
  const SuggestionChip({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  State<SuggestionChip> createState() => _SuggestionChipState();
}

class _SuggestionChipState extends State<SuggestionChip> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: AnimatedScale(
        scale: reduce ? 1.0 : (_hover ? 1.06 : 1.0),
        // easeOutBack overshoots slightly on settle -> a little jiggle.
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOutBack,
        child: GlassChip(
          label: widget.label,
          onTap: widget.onTap,
          labelStyle: DexType.label(color: DexColors.text),
        ),
      ),
    );
  }
}
